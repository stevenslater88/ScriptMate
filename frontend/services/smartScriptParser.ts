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

const HEADING_RE = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i;
const PAREN_RE = /^\s*\(.*\)?\s*$/;
const CAPS_RATIO_THRESHOLD = 0.7;
const MAX_CHARACTER_NAME_LEN = 35;

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

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Empty line → reset dialogue block
    if (trimmed.length === 0) {
      inDialogueBlock = false;
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
        // Normalize character name: strip (V.O.) etc for grouping
        const normalized = trimmed.replace(/\s*\(.*\)\s*$/, '').trim().toUpperCase();

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

  return results;
}
