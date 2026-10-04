/**
 * SmartScriptParser V2 — On-device heuristic screenplay parser
 * Detects characters, dialogue, actions, parentheticals from raw text
 */

export type LineType = 'CHARACTER' | 'DIALOGUE' | 'ACTION' | 'PARENTHETICAL' | 'HEADING' | 'UNKNOWN';

export interface ParsedLine {
  id: string;
  type: LineType;
  characterName: string | null;
  text: string;
  confidence: number;
}

export interface DetectedCharacter {
  name: string;
  count: number;
  avgConfidence: number;
}

export interface ParseResult {
  parsedLines: ParsedLine[];
  detectedCharacters: DetectedCharacter[];
  warnings: string[];
  stats: {
    totalLines: number;
    dialogueLines: number;
    actionLines: number;
    unknownLines: number;
    parentheticalLines: number;
    headingLines: number;
  };
}

// --- Helpers ---

// Screenplay scene-heading / transition / structural-heading detector.
// The Nov-2025 regex only recognised bare sluglines (`INT.`, `EXT.`,
// `INT/EXT.`, `I/E.`) and silently promoted numbered headings
// (`1. INT. APARTMENT — NIGHT`), `SCENE N` headings, and transitions
// (`FADE IN:`, `CUT TO:`) to speaking characters on the Feb-2026
// physical S23 QA build.
//
// The Feb-2026 detector accepts:
//   • an optional numeric/alphanumeric scene number prefix
//     (`1.`, `10.`, `101A.`, `12 `) followed by whitespace before
//     the slug
//   • sluglines: INT / EXT / INT./EXT. / EXT./INT. / I/E / E/I
//   • block headings: SCENE / ACT / CHAPTER / PART / SECTION
//   • transitions: FADE IN / FADE OUT / FADE TO / CUT TO /
//     DISSOLVE (TO) / SMASH CUT / MATCH CUT / JUMP CUT / TIME CUT /
//     HARD CUT / QUICK CUT / IRIS IN / IRIS OUT / FREEZE FRAME
//   • editorial markers: BACK TO SCENE / TITLE CARD / THE END /
//     END OF / INTERCUT / MONTAGE / FLASHBACK / FLASHFORWARD /
//     PRELAP / SUPER(IMPOSE) / ANGLE ON / CLOSE ON / WIDE ON
//
// Anchored at the start of the (trimmed) line — a legitimate
// character name that happens to contain one of these words
// elsewhere is not disqualified. Matched case-insensitively so
// mixed-case scene headings (rare, but seen in some drafts) are
// caught too.
const HEADING_RE =
  // Case-sensitive by design: screenplay convention requires scene /
  // transition headings to be UPPERCASE. A case-insensitive match
  // would misclassify lowercase dialogue like "back to me." or
  // "iris in the eye" as a scene heading.
  /^(?:\d+[A-Z]?\.?\s+)?(?:INT\.?(?:\/EXT\.?)?|EXT\.?(?:\/INT\.?)?|I\.?\/E\.?|E\.?\/I\.?|SCENE\b|ACT\b|CHAPTER\b|PART\b|SECTION\b|FADE\s+(?:IN|OUT|TO)\b|CUT\s+TO\b|DISSOLVE(?:\s+TO)?\b|SMASH\s+CUT\b|MATCH\s+CUT\b|JUMP\s+CUT\b|TIME\s+CUT\b|HARD\s+CUT\b|QUICK\s+CUT\b|IRIS\s+(?:IN|OUT)\b|FREEZE\s+FRAME\b|BACK\s+TO\s+SCENE\b|TITLE\s+CARD\b|THE\s+END\b|END\s+OF\s+(?:SCENE|ACT|EPISODE|PART|SHOW|FILM|MOVIE|SCREENPLAY|STORY|PLAY|CHAPTER|TEASER|COLD\s+OPEN|PILOT)\b|END\s*[.:!]?\s*$|INTERCUT\b|MONTAGE\b|FLASH(?:BACK|-BACK|\s+BACK)\b|FLASHFORWARD\b|PRELAP\b|SUPERIMPOSE\b|ANGLE\s+ON\b|CLOSE\s+ON\b|WIDE\s+ON\b|POV\b)/;
const PAREN_RE = /^\s*\(.*\)?\s*$/;
const CAPS_RATIO_THRESHOLD = 0.7;
const MAX_CHARACTER_NAME_LEN = 35;

// ─── 2026-02 SCRIPT M8 — FRONTEND PARSER PARITY WITH BACKEND ──────────
// Mirrors `backend/server.py::_HEADER_KEYWORDS` and `_INLINE_CUE_RE`.
// Front-matter / cast-list labels authored by users in stage plays
// and Fountain-style drafts (TITLE, CHARACTERS, DRAMATIS PERSONAE,
// etc.) must NEVER be classified as speaking characters even though
// they are all-uppercase and short. Inline-cue dialogue of the form
// `NAME: text` must be split so the name becomes a character and
// the text becomes a dialogue line without the "NAME:" prefix.
//
// If these two mirrors ever drift from the backend, the frontend
// ScriptParser preview and the saved rehearsal will disagree —
// `backend/tests/test_frontend_backend_parser_parity_feb2026.py`
// locks the two parsers against the Jack/Sarah physical repro.
const HEADER_KEYWORDS: ReadonlySet<string> = new Set([
  'TITLE',
  'AUTHOR',
  'BY',
  'WRITTEN BY',
  'CHARACTERS',
  'CAST',
  'DRAMATIS PERSONAE',
  'SETTING',
  'TIME',
  'PLACE',
  'SYNOPSIS',
  'LOGLINE',
]);

const INLINE_CUE_RE = /^([A-Z][A-Z0-9 .'\-]{0,30}):\s+(.+)$/;

// ─── 2026-10 FRONTEND PARITY WITH BACKEND fallback_parse_script ────────
// PyPDF2 extraction of PDF scripts injects three distinct contamination
// classes into the raw text that both the frontend review parser and
// the backend persistence parser MUST normalise consistently, or the
// character set shown on the review screen will differ from the one
// saved to the rehearsal. Mirrors backend/server.py:
//   _INVISIBLE_TRAILERS       — invisible-whitespace trailers
//   _normalize_cue            — strip invisible-trailer characters
//   _LEADING_LINE_NUMBER_RE   — strip leading PDF line/page numbers
//   _strip_leading_line_number
//   _implicit_title_indices   — suppress implicit title/subtitle blocks
//
// Parity is locked by
// backend/tests/test_frontend_backend_parser_parity_feb2026.py
// and the ScriptM8 regression test file.
const INVISIBLE_TRAILERS_RE = /[\u00A0\u200B\u200C\u200D\uFEFF\s]+$|^[\u00A0\u200B\u200C\u200D\uFEFF\s]+/g;

function normalizeCue(s: string): string {
  // Strip invisible-whitespace trailers / leaders: NBSP, ZWSP/J/NJ, BOM,
  // and ordinary whitespace. Used both for terminator guards AND for
  // character-identity dedup.
  return s.replace(INVISIBLE_TRAILERS_RE, '');
}
export const _normalizeCueForTest = normalizeCue;

const LEADING_LINE_NUMBER_RE = /^\d+[\s.\-\u2013\u2014]+/;

function stripLeadingLineNumber(s: string): string {
  // Strip a leading page/line number from a character cue extracted by
  // PyPDF2 from numbered-dialogue theater PDFs:
  //
  //   "1 JACK"      -> "JACK"
  //   "2 EMILY"     -> "EMILY"
  //   "61 — JACK"   -> "JACK"   (em-dash U+2014)
  //   "192 - JACK"  -> "JACK"   (ASCII hyphen)
  //   "1. JACK"     -> "JACK"
  //   "3  BELLA"    -> "BELLA"  (multiple spaces)
  //
  // Pattern: one-or-more leading digits followed by at least ONE
  // separator from {space, dot, hyphen, en-dash U+2013, em-dash U+2014}.
  //
  // Conservative guards:
  //   - requires a separator so purely-numeric strings ("100"),
  //     digit-letter concatenations ("J4CK"), and trailing-number
  //     names ("SARAH 2") are NEVER modified
  //   - returns the input unchanged when stripping would produce an
  //     empty string
  const stripped = s.replace(LEADING_LINE_NUMBER_RE, '').trim();
  if (stripped.length === 0 || stripped === s) return s;
  return stripped;
}
export const _stripLeadingLineNumberForTest = stripLeadingLineNumber;

function isHeaderLine(trimmed: string): boolean {
  const upper = trimmed.toUpperCase();
  for (const kw of HEADER_KEYWORDS) {
    if (upper === kw || upper === kw + ':') return true;
    if (upper.startsWith(kw + ':') || upper.startsWith(kw + ' ')) return true;
  }
  return false;
}

function uid(): string {
  return Math.random().toString(36).substring(2, 10);
}

function capsRatio(s: string): number {
  const letters = s.replace(/[^a-zA-Z]/g, '');
  if (letters.length === 0) return 0;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length;
}

function isTitleCase(s: string): boolean {
  const words = s.trim().split(/\s+/);
  if (words.length === 0) return false;
  return words.every(w => w.length === 0 || /^[A-Z]/.test(w));
}

function isLikelyCharacterName(line: string): { likely: boolean; confidence: number } {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CHARACTER_NAME_LEN) {
    return { likely: false, confidence: 0 };
  }

  // Scene headings are not characters
  if (HEADING_RE.test(trimmed)) {
    return { likely: false, confidence: 0 };
  }

  // Parentheticals are not characters
  if (PAREN_RE.test(trimmed)) {
    return { likely: false, confidence: 0 };
  }

  // Strip common suffixes: (V.O.), (O.S.), (CONT'D), etc.
  const cleaned = trimmed.replace(/\s*\(.*\)\s*$/, '').trim();
  if (cleaned.length === 0) return { likely: false, confidence: 0 };

  // 2026-10 physical build 1.1.0 — hard word-count rejection to match
  // backend fallback_parse_script's `len(potential_char.split()) <= 3`
  // requirement. Without this, 4+ word uppercase prose like
  // `THE GREAT SNACK HEIST` or `SCRIPT M8 STRESS-TEST SCRIPT` passes
  // the heuristic (all-uppercase, no trailing punctuation, within
  // MAX_CHARACTER_NAME_LEN) and gets promoted to a speaking character.
  // Also strip leading PDF line/page numbers BEFORE the word count so
  // `61 — JACK` (3 tokens) counts as `JACK` (1 token).
  const wordCountSource = stripLeadingLineNumber(cleaned);
  if (wordCountSource.split(/\s+/).length > 3) {
    return { likely: false, confidence: 0 };
  }

  // 2026-10 physical build 1.1.0 regression — ScriptM8_The_Great_Snack_Heist.
  // Character cues never end with sentence-terminating punctuation.
  // `WHERE?`, `APPARENTLY.`, `OH!`, `JACK!`, `MUD.`, `FINE.`, `MAYBE.`,
  // `TWO.` are dialogue, not character names. The existing invalid-char
  // counter below accepts `?`/`!` as 1 invalid char and `.` as 0 (it is
  // in the safe set for `(V.O.)` suffixes, which are already stripped
  // above), so WITHOUT this guard those lines pass the predicate at
  // confidence 0.95 and get wrongly promoted to characters.
  // Hardened variant — normalise invisible trailers first (PyPDF2
  // injects U+00A0 NBSP / U+200B ZWSP after short uppercase dialogue)
  // so `WHERE?\u00A0` still triggers the terminator guard. The
  // `cleanedTail` form is locked by the frontend parity test.
  const cleanedTail = normalizeCue(cleaned);
  if (/[.!?]$/.test(cleanedTail)) {
    return { likely: false, confidence: 0 };
  }

  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(cleaned)) {
    return { likely: false, confidence: 0 };
  }

  // Mostly letters, spaces, periods, hyphens, apostrophes
  const validChars = cleaned.replace(/[a-zA-Z\s.\-']/g, '');
  if (validChars.length > 2) {
    return { likely: false, confidence: 0 };
  }

  const cr = capsRatio(cleaned);
  let confidence = 0;

  // ALL CAPS → high confidence
  if (cr >= CAPS_RATIO_THRESHOLD) {
    confidence = 0.75 + cr * 0.2;
  }
  // Title Case → medium confidence
  else if (isTitleCase(cleaned)) {
    confidence = 0.5;
  }
  // Mixed → low
  else {
    confidence = 0.2;
  }

  // Short names are more likely character names
  if (cleaned.split(/\s+/).length <= 3) {
    confidence = Math.min(1, confidence + 0.05);
  }

  return { likely: confidence >= 0.4, confidence };
}

function isParenthetical(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('(') && (trimmed.endsWith(')') || trimmed.length <= 50)) {
    return true;
  }
  return false;
}

function isHeading(line: string): boolean {
  return HEADING_RE.test(line.trim());
}

// --- Normalization ---

function normalizeText(raw: string): string[] {
  // Convert Windows/Mac newlines to \n
  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Trim trailing spaces per line
  text = text.split('\n').map(l => l.trimEnd()).join('\n');
  // Collapse 3+ blank lines to max 2
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.split('\n');
}

// --- Main Parser ---

export function parseScript(rawText: string, options?: { includeHeadings?: boolean }): ParseResult {
  const includeHeadings = options?.includeHeadings ?? false;
  const rawLines = normalizeText(rawText);
  const parsedLines: ParsedLine[] = [];
  const characterCounts: Record<string, { count: number; totalConf: number }> = {};
  const warnings: string[] = [];

  let currentCharacter: string | null = null;
  let currentCharConfidence = 0;
  let inDialogueBlock = false;

  // ─── 2026-02 PHYSICAL BUILD 1.0.66 — TITLE DUPLICATE SUPPRESSION ─
  // Mirrors `backend/server.py::fallback_parse_script`. PyPDF2
  // extracts the on-page document title TWICE: once as a standalone
  // large-text line at the top, and again as part of the author's
  // `TITLE: <value>` metadata. Without this hint, the leading
  // duplicate (uppercase, <=3 words, not a header-keyword prefix)
  // falls through to the character-cue heuristic and is wrongly
  // promoted to a speaking character.
  //
  // Structural rule (generic, NOT hard-coded to any title):
  //   If an explicit `TITLE: <value>` header exists AND a preceding
  //   standalone line equals that `<value>`, treat the preceding
  //   line as duplicated document-title extraction. INDEX-GATED:
  //   duplicates AFTER the TITLE header are preserved as legitimate
  //   character cues.
  let titleValueUpper = '';
  let titleHeaderIdx = -1;
  for (let k = 0; k < rawLines.length; k++) {
    const s = rawLines[k].trim();
    const u = s.toUpperCase();
    if (u.startsWith('TITLE:')) {
      titleValueUpper = s.slice('TITLE:'.length).trim().toUpperCase();
      titleHeaderIdx = k;
      break;
    }
  }

  // ─── 2026-10 PHYSICAL BUILD — IMPLICIT TITLE / SUBTITLE BLOCK ─────
  // Mirrors backend/server.py::_implicit_title_indices. When a PDF
  // has NO explicit `TITLE:` header, PyPDF2 extracts the centered
  // title (and any subtitle) as standalone uppercase cue-shaped
  // lines at the top (e.g. "THE GREAT SNACK HEIST" /
  // "SCRIPT M8 STRESS-TEST SCRIPT"). These pass the character-cue
  // heuristic and are wrongly promoted to speaking characters.
  //
  // Structural rule (conservative, NOT a broad uppercase heuristic):
  //   Trigger only when ALL of:
  //     - no explicit `TITLE:` header exists in the document
  //     - the first non-empty lines of the script contain >=2
  //       CONSECUTIVE cue-shaped uppercase lines (<=3 words each)
  //     - no scene heading, header keyword, or non-uppercase dialogue
  //       line has appeared between them
  //   A single leading uppercase line followed by non-uppercase
  //   dialogue is a REAL character cue and is NEVER suppressed.
  const implicitTitleIndices = new Set<number>();
  if (titleHeaderIdx < 0) {
    const run: number[] = [];
    const scanLimit = Math.min(20, rawLines.length);
    for (let k = 0; k < scanLimit; k++) {
      const s = rawLines[k].trim();
      if (s.length === 0) continue;
      if (HEADING_RE.test(s)) break;
      if (isHeaderLine(s)) break;
      const passesCueShape =
        s.length > 1 &&
        !s.startsWith('(') &&
        !s.startsWith('[') &&
        s === s.toUpperCase() &&
        /[A-Z]/.test(s) &&
        !/[.!?]$/.test(normalizeCue(s)) &&
        s.split(/\s+/).length <= 3;
      if (passesCueShape) {
        run.push(k);
        continue;
      }
      // Non-uppercase / non-cue line. If the previous uppercase line
      // looked like a cue, it is a REAL character cue (this line is
      // its dialogue). Drop it from the run so legitimate characters
      // are preserved.
      if (run.length > 0) run.pop();
      break;
    }
    // Only suppress when 2+ consecutive uppercase cue-shaped lines are
    // found at the very top with no dialogue separating them.
    if (run.length >= 2) {
      for (const idx of run) implicitTitleIndices.add(idx);
    }
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Empty line → reset dialogue block
    if (trimmed.length === 0) {
      inDialogueBlock = false;
      continue;
    }

    // Standalone duplicate of TITLE metadata value appearing BEFORE
    // the `TITLE: X` header line — suppress from character detection.
    if (
      titleValueUpper.length > 0 &&
      i < titleHeaderIdx &&
      trimmed.toUpperCase() === titleValueUpper
    ) {
      parsedLines.push({
        id: uid(),
        type: 'ACTION',
        characterName: null,
        text: trimmed,
        confidence: 0.9,
      });
      inDialogueBlock = false;
      currentCharacter = null;
      continue;
    }

    // Implicit title / subtitle block (no explicit TITLE: header) —
    // suppress from character detection, route to action path.
    if (implicitTitleIndices.has(i)) {
      parsedLines.push({
        id: uid(),
        type: 'ACTION',
        characterName: null,
        text: trimmed,
        confidence: 0.9,
      });
      inDialogueBlock = false;
      currentCharacter = null;
      continue;
    }

    // Scene heading
    if (isHeading(trimmed)) {
      parsedLines.push({
        id: uid(),
        type: includeHeadings ? 'HEADING' : 'ACTION',
        characterName: null,
        text: trimmed,
        confidence: 0.9,
      });
      inDialogueBlock = false;
      currentCharacter = null;
      continue;
    }

    // Parenthetical
    if (isParenthetical(trimmed)) {
      parsedLines.push({
        id: uid(),
        type: 'PARENTHETICAL',
        characterName: currentCharacter,
        text: trimmed,
        confidence: 0.85,
      });
      // Stay in dialogue block — parenthetical doesn't break it
      continue;
    }

    // ─── Front-matter header block (TITLE:, CHARACTERS:, etc.) ───
    // Must come BEFORE character-cue detection so uppercase labels
    // like `TITLE: THE CALL` do not get promoted to characters.
    if (isHeaderLine(trimmed)) {
      parsedLines.push({
        id: uid(),
        type: 'ACTION',
        characterName: null,
        text: trimmed,
        confidence: 0.9,
      });
      inDialogueBlock = false;
      currentCharacter = null;
      continue;
    }

    // ─── Inline-cue dialogue (`NAME: dialogue text`) ─────────────
    // Common in stage plays and Fountain drafts. The cue must
    // satisfy the standard character-cue constraints (uppercase,
    // <=3 words, >1 char, not a scene heading, not a header
    // keyword). The right-hand side becomes a single DIALOGUE line
    // attributed to that cue — the "NAME:" prefix is NOT retained.
    const inlineMatch = trimmed.match(INLINE_CUE_RE);
    if (inlineMatch) {
      const cueRaw = inlineMatch[1].trim();
      const dialogueText = inlineMatch[2].trim();
      const cueUpper = cueRaw.toUpperCase();
      const cueWords = cueRaw.split(/\s+/).length;
      if (
        cueRaw.length > 1 &&
        cueWords <= 3 &&
        cueRaw === cueUpper &&
        !HEADER_KEYWORDS.has(cueUpper) &&
        !HEADING_RE.test(cueRaw) &&
        dialogueText.length > 0
      ) {
        // Normalize cue name the same way the two-line path does:
        //   1. strip leading PDF page/line number (`1 JACK` → `JACK`)
        //   2. strip trailing parenthetical extension (`(V.O.)`, etc.)
        //   3. strip invisible-whitespace trailers (NBSP, ZWSP, BOM)
        //   4. uppercase for case-insensitive identity dedup
        const normalized = normalizeCue(
          stripLeadingLineNumber(cueRaw)
            .replace(/\s*\(.*\)\s*$/, '')
            .trim()
        ).toUpperCase();
        if (normalized.length === 0) {
          // Normalization emptied the cue — treat line as action.
          parsedLines.push({
            id: uid(),
            type: 'ACTION',
            characterName: null,
            text: trimmed,
            confidence: 0.4,
          });
          continue;
        }
        currentCharacter = normalized;
        currentCharConfidence = 0.95;
        inDialogueBlock = true;

        if (!characterCounts[normalized]) {
          characterCounts[normalized] = { count: 0, totalConf: 0 };
        }
        characterCounts[normalized].count++;
        characterCounts[normalized].totalConf += 0.95;

        parsedLines.push({
          id: uid(),
          type: 'CHARACTER',
          characterName: normalized,
          text: normalized,
          confidence: 0.95,
        });
        parsedLines.push({
          id: uid(),
          type: 'DIALOGUE',
          characterName: normalized,
          text: dialogueText,
          confidence: 0.9,
        });
        continue;
      }
    }

    // Character name detection
    const { likely, confidence } = isLikelyCharacterName(trimmed);

    if (likely) {
      // Look ahead: next non-empty line should be dialogue-ish
      let hasFollowingDialogue = false;
      for (let j = i + 1; j < rawLines.length && j <= i + 3; j++) {
        const nextTrimmed = rawLines[j].trim();
        if (nextTrimmed.length === 0) continue;
        // Next line should NOT be another character name with high caps
        const nextCheck = isLikelyCharacterName(nextTrimmed);
        if (!nextCheck.likely || nextCheck.confidence < confidence) {
          hasFollowingDialogue = true;
        }
        break;
      }

      const adjustedConf = hasFollowingDialogue
        ? Math.min(1, confidence + 0.15)
        : Math.max(0.2, confidence - 0.2);

      if (adjustedConf >= 0.4) {
        // Normalize character name:
        //   1. strip leading PDF page/line number (`1 JACK`, `61 — JACK`
        //      → `JACK`) — PyPDF2 injects these from theater scripts
        //      with embedded line numbers. Without this, "1 JACK" and
        //      "5 JACK" dedupe as two separate characters.
        //   2. strip trailing parenthetical extension (`(V.O.)`, etc.)
        //   3. strip trailing colon so `JACK:` and `JACK` cannot be
        //      stored as separate characters (physical build 1.0.65
        //      regression — mirrors the backend's `.replace(':', '')`).
        //   4. strip invisible-whitespace trailers (NBSP, ZWSP, BOM)
        //      so `JACK\u00A0` and `JACK` dedupe to one identity.
        //   5. uppercase for case-insensitive identity dedup.
        const normalized = normalizeCue(
          stripLeadingLineNumber(trimmed)
            .replace(/\s*\(.*\)\s*$/, '')
            .replace(/:\s*$/, '')
            .trim()
        ).toUpperCase();

        if (normalized.length === 0) {
          // Normalization emptied the cue — treat as action.
          parsedLines.push({
            id: uid(),
            type: 'ACTION',
            characterName: null,
            text: trimmed,
            confidence: 0.4,
          });
          continue;
        }

        currentCharacter = normalized;
        currentCharConfidence = adjustedConf;
        inDialogueBlock = true;

        if (!characterCounts[normalized]) {
          characterCounts[normalized] = { count: 0, totalConf: 0 };
        }
        characterCounts[normalized].count++;
        characterCounts[normalized].totalConf += adjustedConf;

        parsedLines.push({
          id: uid(),
          type: 'CHARACTER',
          characterName: normalized,
          text: trimmed,
          confidence: adjustedConf,
        });
        continue;
      }
    }

    // Dialogue: if we're in a dialogue block under a character
    if (inDialogueBlock && currentCharacter) {
      parsedLines.push({
        id: uid(),
        type: 'DIALOGUE',
        characterName: currentCharacter,
        text: trimmed,
        confidence: currentCharConfidence * 0.95,
      });
      continue;
    }

    // Action / Unknown
    const hasNarrative = /[.!?,;:]/.test(trimmed) && trimmed.length > 15;
    parsedLines.push({
      id: uid(),
      type: hasNarrative ? 'ACTION' : 'UNKNOWN',
      characterName: null,
      text: trimmed,
      confidence: hasNarrative ? 0.6 : 0.3,
    });
  }

  // Build character list
  const detectedCharacters: DetectedCharacter[] = Object.entries(characterCounts)
    .map(([name, data]) => ({
      name,
      count: data.count,
      avgConfidence: data.totalConf / data.count,
    }))
    .sort((a, b) => b.count - a.count);

  // Boost confidence for characters that appear multiple times
  for (const pl of parsedLines) {
    if (pl.characterName && characterCounts[pl.characterName]) {
      const appearances = characterCounts[pl.characterName].count;
      if (appearances >= 3) {
        pl.confidence = Math.min(1, pl.confidence + 0.1);
      }
    }
  }

  // Warnings
  if (detectedCharacters.length === 0) {
    warnings.push('No character names detected. The script may need manual formatting.');
  } else if (detectedCharacters.every(c => c.avgConfidence < 0.5)) {
    warnings.push('Low confidence character detection. Formatting may be inconsistent.');
  }
  if (detectedCharacters.length === 1) {
    warnings.push('Only one character detected. This may be a monologue or the format needs adjustment.');
  }

  // Stats
  const stats = {
    totalLines: parsedLines.length,
    dialogueLines: parsedLines.filter(l => l.type === 'DIALOGUE').length,
    actionLines: parsedLines.filter(l => l.type === 'ACTION').length,
    unknownLines: parsedLines.filter(l => l.type === 'UNKNOWN').length,
    parentheticalLines: parsedLines.filter(l => l.type === 'PARENTHETICAL').length,
    headingLines: parsedLines.filter(l => l.type === 'HEADING').length,
  };

  return { parsedLines, detectedCharacters, warnings, stats };
}

// --- Test Vectors (dev only) ---

export function runParserTests(): { name: string; pass: boolean; detail: string }[] {
  const results: { name: string; pass: boolean; detail: string }[] = [];

  // Test 1: Standard caps format
  const t1 = parseScript(`JACK\nWe can't stay here.\n\nSARAH\nThen we move.`);
  results.push({
    name: 'Standard caps format',
    pass: t1.detectedCharacters.length === 2 && t1.stats.dialogueLines === 2,
    detail: `chars=${t1.detectedCharacters.length}, dialogue=${t1.stats.dialogueLines}`,
  });

  // Test 2: Parentheticals
  const t2 = parseScript(`SARAH\n(quietly)\nDon't look back.`);
  results.push({
    name: 'Parenthetical detection',
    pass: t2.stats.parentheticalLines === 1 && t2.stats.dialogueLines === 1,
    detail: `parens=${t2.stats.parentheticalLines}, dialogue=${t2.stats.dialogueLines}`,
  });

  // Test 3: Multi-line dialogue
  const t3 = parseScript(`MIKE\nFirst line of dialogue.\nSecond line continues.\nThird line too.`);
  results.push({
    name: 'Multi-line dialogue',
    pass: t3.stats.dialogueLines === 3,
    detail: `dialogue=${t3.stats.dialogueLines}`,
  });

  // Test 4: Action blocks
  const t4 = parseScript(`The room shakes. Dust falls from the ceiling.\n\nJACK\nWhat was that?`);
  results.push({
    name: 'Action block detection',
    pass: t4.stats.actionLines >= 1 && t4.detectedCharacters.length === 1,
    detail: `actions=${t4.stats.actionLines}, chars=${t4.detectedCharacters.length}`,
  });

  // Test 5: Scene headings
  const t5 = parseScript(`INT. APARTMENT - NIGHT\n\nJACK\nHello.`, { includeHeadings: true });
  results.push({
    name: 'Scene heading detection',
    pass: t5.stats.headingLines === 1,
    detail: `headings=${t5.stats.headingLines}`,
  });

  // Test 6: Front-matter header block must not become characters
  const t6 = parseScript(
    `TITLE: THE CALL\nCHARACTERS:\nJACK\nSARAH\n\nJACK: Are you ready?\nSARAH: I've been ready.`
  );
  const t6names = t6.detectedCharacters.map(c => c.name).sort();
  results.push({
    name: 'Front-matter block (TITLE:/CHARACTERS:) is not a character',
    pass:
      t6names.length === 2 &&
      t6names[0] === 'JACK' &&
      t6names[1] === 'SARAH',
    detail: `chars=[${t6names.join(',')}]`,
  });

  // Test 7: Inline-cue dialogue splits correctly, no NAME: prefix
  const t7 = parseScript(
    `JACK: Are you ready?\nSARAH: I've been ready for ten minutes.\nJACK: Then let's do this.`
  );
  const t7dialogue = t7.parsedLines.filter(l => l.type === 'DIALOGUE');
  results.push({
    name: 'Inline-cue dialogue splits with alternating characters',
    pass:
      t7dialogue.length === 3 &&
      t7dialogue[0].characterName === 'JACK' &&
      t7dialogue[0].text === 'Are you ready?' &&
      t7dialogue[1].characterName === 'SARAH' &&
      t7dialogue[2].characterName === 'JACK' &&
      !t7dialogue.some(l => l.text.includes(':') && /^[A-Z]+:/.test(l.text)),
    detail: `d=${t7dialogue.length} first="${t7dialogue[0]?.text}"`,
  });

  return results;
}
