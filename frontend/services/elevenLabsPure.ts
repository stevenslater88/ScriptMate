/**
 * ElevenLabs pure playback helpers
 * ---------------------------------
 * RN-free primitives used by both the real elevenLabsService (which
 * wires them to expo-av / expo-file-system / fetch) and the Node
 * smoke test (which wires them to stubs). Keeping these split out is
 * what makes the required end-to-end mocked playback test possible
 * without bootstrapping React Native inside the Pytest gate.
 *
 * Nothing in this file may import from expo-*, react-native, or any
 * platform-only module.
 */

// ─── READER STYLE / VOICE SPEED → SETTINGS (pure) ─────────────────
// Duplicated verbatim into elevenLabsService so the Feb-2026 Node
// smoke test can prove emotion/speed reach the request body without
// booting React Native. Any change here must be mirrored there.
export type ReaderStyleLite = 'neutral' | 'emotional' | 'intense' | 'aggressive';

export interface ElevenLabsSettingsLite {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

export function readerStyleToElevenLabsSettingsPure(
  readerStyle: string | undefined,
  voiceSpeed: number | undefined,
): ElevenLabsSettingsLite {
  const s = (readerStyle || 'neutral').toLowerCase();
  let stability = 0.5;
  let style = 0.0;
  if (s === 'emotional') {
    stability = 0.35;
    style = 0.55;
  } else if (s === 'intense' || s === 'aggressive') {
    stability = 0.25;
    style = 0.85;
  }
  const rawSpeed = typeof voiceSpeed === 'number' && Number.isFinite(voiceSpeed)
    ? voiceSpeed
    : 1.0;
  const speed = Math.max(0.7, Math.min(1.2, rawSpeed));
  return {
    stability,
    similarity_boost: 0.75,
    style,
    use_speaker_boost: true,
    speed,
  };
}

// ─── API KEY VALIDATOR (pure) ─────────────────────────────────────
// Mirrors appConfig.isValidElevenLabsApiKey — kept pure so the smoke
// test can prove the classification without booting Expo Constants.
export function isValidElevenLabsApiKeyPure(key: unknown): boolean {
  if (typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith('sk_')) return false;
  if (trimmed.length < 20) return false;
  return true;
}

export function classifyElevenLabsKeyPure(key: unknown):
  | 'missing' | 'not-a-string' | 'wrong-prefix'
  | 'too-short' | 'looks-like-api-key-id' | 'valid' {
  if (key === undefined || key === null || key === '') return 'missing';
  if (typeof key !== 'string') return 'not-a-string';
  const trimmed = key.trim();
  if (!trimmed) return 'missing';
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return 'looks-like-api-key-id';
  if (!trimmed.startsWith('sk_')) return 'wrong-prefix';
  if (trimmed.length < 20) return 'too-short';
  return 'valid';
}


export interface CharacterVoiceAssignmentLite {
  characterName: string;
  voiceKey: string;
  voiceId: string;
}

export type Provider = 'elevenlabs' | 'expo-speech';

export interface VoiceResolution {
  character: string;
  assignmentPresent: boolean;
  voiceKey: string | null;
  voiceId: string | null;
}

/**
 * Resolve a line's character to a voice assignment. Tries the exact
 * key first, then the upper-cased key — matches the two forms the
 * rehearsal screen stores at load time.
 */
export function resolveVoiceForCharacter(
  assignments: Record<string, CharacterVoiceAssignmentLite>,
  character: string | null | undefined,
): VoiceResolution {
  if (!character) {
    return { character: '', assignmentPresent: false, voiceKey: null, voiceId: null };
  }
  const a = assignments[character] ?? assignments[character.toUpperCase()];
  if (!a) {
    return { character, assignmentPresent: false, voiceKey: null, voiceId: null };
  }
  return {
    character,
    assignmentPresent: true,
    voiceKey: a.voiceKey ?? null,
    voiceId: a.voiceId ?? null,
  };
}

/**
 * Provider-selection rule: ElevenLabs only when it's configured AND
 * we have both an assignment and a non-empty voiceId. Every other
 * case falls back to expo-speech so the rehearsal never stalls.
 */
export function selectProvider(
  elevenLabsConfigured: boolean,
  resolution: VoiceResolution,
): Provider {
  if (elevenLabsConfigured && resolution.assignmentPresent && !!resolution.voiceId) {
    return 'elevenlabs';
  }
  return 'expo-speech';
}

// ─── HERMES-SAFE BASE64 ENCODER ──────────────────────────────────────
// btoa is not stable across Expo/Hermes; String.fromCharCode(...bytes)
// blows the JS stack on large audio. Chunked encoder, zero deps.
const B64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let output = '';
  const len = bytes.length;
  const remainder = len % 3;
  const fullChunks = len - remainder;

  for (let i = 0; i < fullChunks; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output +=
      B64_CHARS[(n >> 18) & 63] +
      B64_CHARS[(n >> 12) & 63] +
      B64_CHARS[(n >> 6) & 63] +
      B64_CHARS[n & 63];
  }
  if (remainder === 1) {
    const n = bytes[fullChunks];
    output += B64_CHARS[(n >> 2) & 63] + B64_CHARS[(n << 4) & 63] + '==';
  } else if (remainder === 2) {
    const n = (bytes[fullChunks] << 8) | bytes[fullChunks + 1];
    output +=
      B64_CHARS[(n >> 10) & 63] +
      B64_CHARS[(n >> 4) & 63] +
      B64_CHARS[(n << 2) & 63] +
      '=';
  }
  return output;
}

// ─── GENDER INFERENCE FROM SCRIPT (pure) ─────────────────────────────
// 2026-02 Physical QA Blocker 2: Characters were getting assigned
// voices via a gender-BLIND round-robin cycle in VoiceAssignment.tsx.
// A male character would routinely get a female voice (and vice
// versa). This pure helper reads the script dialogue + character
// name and returns a best-effort inferred gender using only local,
// deterministic regex rules — no LLM, no network, no dependencies.
//
// Signal priority (strongest first):
//   1. Honorific / role tokens in the CHARACTER NAME itself
//      ("MR. SMITH", "MRS. JONES", "WAITRESS", "KING ARTHUR").
//      Confidence 0.95.
//   2. Pronoun ratio in stage directions mentioning the character
//      by name (he/him/his vs she/her/hers). Confidence up to 0.85.
//   3. Pronoun ratio in OTHER characters' dialogue that mentions
//      this character by name within a narrow window.
//      Confidence up to 0.75.
//   4. First-name heuristic from a small, high-confidence allowlist.
//      Confidence 0.60.
//
// Returns 'unknown' when no signal clears a confidence threshold OR
// when signals conflict (strong male AND strong female). The caller
// must then fall back to its own default (e.g. a mixed-gender
// round-robin) so a broken classifier never blocks assignment.

export type InferredGender = 'male' | 'female' | 'unknown';

export interface GenderInferenceLine {
  character: string;
  text: string;
  is_stage_direction?: boolean;
}

export interface GenderInferenceResult {
  gender: InferredGender;
  confidence: number;
  signals: string[];
}

// Honorific / role tokens that pin gender almost always.
// Match is case-insensitive, word-boundary enforced, and the token
// may optionally end with a '.' (so "MR." / "MR" both match).
const MALE_HONORIFICS = [
  'MR', 'MISTER', 'SIR', 'LORD', 'KING', 'PRINCE', 'DUKE', 'EARL',
  'BARON', 'COUNT', 'FATHER', 'DAD', 'DADDY', 'PAPA', 'POP',
  'GRANDPA', 'GRANDFATHER', 'GRANDAD', 'GRANDPAPA',
  'BROTHER', 'SON', 'HUSBAND', 'BOYFRIEND', 'GROOM',
  'UNCLE', 'NEPHEW', 'WIDOWER', 'GENTLEMAN', 'BOY',
  'MAN', 'GUY', 'BLOKE', 'DUDE',
  'WAITER', 'COWBOY', 'FISHERMAN', 'POLICEMAN',
  'FIREMAN', 'MAILMAN', 'HANDYMAN', 'SALESMAN',
  'ACTOR', 'MONK', 'PRIEST', 'FRIAR', 'RABBI',
];
const FEMALE_HONORIFICS = [
  'MRS', 'MISSUS', 'MS', 'MISS', 'MADAM', 'MADAME', 'MA\'AM',
  'LADY', 'DAME', 'QUEEN', 'PRINCESS', 'DUCHESS', 'COUNTESS',
  'BARONESS', 'EMPRESS',
  'MOTHER', 'MOM', 'MOMMY', 'MUMMY', 'MUM', 'MAMA', 'MA',
  'GRANDMA', 'GRANDMOTHER', 'GRANNY', 'NANA', 'NANNA',
  'SISTER', 'DAUGHTER', 'WIFE', 'GIRLFRIEND', 'BRIDE',
  'AUNT', 'AUNTIE', 'AUNTY', 'NIECE', 'WIDOW',
  'GIRL', 'WOMAN', 'GAL', 'LASS',
  'WAITRESS', 'COWGIRL', 'POLICEWOMAN', 'FIREWOMAN',
  'STEWARDESS', 'ACTRESS', 'NUN',
];

// Very conservative first-name allowlist. Only common unambiguous
// English/Western names — anything mixed-gender ("Jordan", "Taylor",
// "Alex", "Jamie") is deliberately excluded.
const MALE_FIRST_NAMES = new Set([
  'JOHN', 'JAMES', 'ROBERT', 'MICHAEL', 'WILLIAM', 'DAVID',
  'RICHARD', 'JOSEPH', 'THOMAS', 'CHARLES', 'CHRISTOPHER',
  'DANIEL', 'MATTHEW', 'ANTHONY', 'DONALD', 'MARK', 'PAUL',
  'STEVEN', 'ANDREW', 'KENNETH', 'GEORGE', 'EDWARD', 'BRIAN',
  'RONALD', 'KEVIN', 'JASON', 'JEFFREY', 'RYAN', 'GARY',
  'NICHOLAS', 'ERIC', 'STEPHEN', 'JONATHAN', 'LARRY', 'JUSTIN',
  'SCOTT', 'FRANK', 'BRANDON', 'BENJAMIN', 'GREGORY', 'SAMUEL',
  'RAYMOND', 'PATRICK', 'JACK', 'DENNIS', 'JERRY', 'TYLER',
  'AARON', 'HENRY', 'DOUGLAS', 'PETER', 'ADAM', 'NATHAN',
  'ZACHARY', 'WALTER', 'HAROLD', 'KYLE', 'CARL', 'ARTHUR',
  'GERALD', 'ROGER', 'KEITH', 'LAWRENCE', 'JEREMY', 'TERRY',
  'SEAN', 'CHRISTIAN', 'ETHAN', 'LUCAS', 'NOAH', 'MASON',
  'LIAM', 'OLIVER', 'ELIJAH', 'LOGAN', 'CALEB', 'HARRY',
  'TOM', 'TIM', 'DANNY', 'TONY', 'MIKE', 'BOB', 'BILL',
  'JIMMY', 'JOHNNY', 'JOEY', 'STEVE', 'DAVE', 'RICK',
  'JEFF', 'CHRIS', 'JAKE', 'BEN', 'MATT', 'ALEXANDER',
  'HARRISON', 'LEONARD', 'MARCUS', 'VINCENT', 'VICTOR',
  'OSCAR', 'LEO', 'MAX', 'FELIX', 'HUGO', 'IVAN',
]);
const FEMALE_FIRST_NAMES = new Set([
  'MARY', 'PATRICIA', 'JENNIFER', 'LINDA', 'ELIZABETH', 'BARBARA',
  'SUSAN', 'JESSICA', 'SARAH', 'KAREN', 'LISA', 'NANCY',
  'BETTY', 'HELEN', 'SANDRA', 'DONNA', 'CAROL', 'RUTH',
  'SHARON', 'MICHELLE', 'LAURA', 'EMILY', 'KIMBERLY', 'DEBORAH',
  'DOROTHY', 'AMY', 'ANGELA', 'ASHLEY', 'BRENDA', 'EMMA',
  'OLIVIA', 'CYNTHIA', 'MARIE', 'JANET', 'CATHERINE', 'FRANCES',
  'CHRISTINE', 'SAMANTHA', 'DEBRA', 'RACHEL', 'CAROLYN', 'JANET',
  'VIRGINIA', 'MARIA', 'HEATHER', 'DIANE', 'JULIE', 'JOYCE',
  'VICTORIA', 'KELLY', 'CHRISTINA', 'LAUREN', 'JOAN', 'EVELYN',
  'JUDITH', 'MEGAN', 'CHERYL', 'ANDREA', 'HANNAH', 'JACQUELINE',
  'MARTHA', 'GLORIA', 'TERESA', 'SARA', 'JANICE', 'JULIA',
  'MARILYN', 'KATHRYN', 'FRANCES', 'KATHLEEN', 'PAMELA', 'NICOLE',
  'ABIGAIL', 'MADISON', 'CHARLOTTE', 'SOFIA', 'SOPHIA', 'AVA',
  'ISABELLA', 'MIA', 'ELLA', 'GRACE', 'CHLOE', 'ZOE',
  'LILY', 'HAZEL', 'LUCY', 'AMELIA', 'ANNA', 'ANNE',
  'KATE', 'KATIE', 'JEN', 'JENNY', 'JESS', 'LIZ',
  'MOLLY', 'BETH', 'JANE', 'JILL', 'PAM', 'SUE',
  'TINA', 'VICKY', 'WENDY', 'MEG', 'ABBY', 'PENELOPE',
  'ROSE', 'VIOLET', 'DAISY', 'IRIS', 'RUBY', 'PEARL',
  'MARGARET', 'ALICE', 'CLAIRE', 'ELAINE', 'ESTHER', 'FIONA',
]);

function _splitNameTokens(characterName: string): string[] {
  return characterName
    .toUpperCase()
    .replace(/[^A-Z'\s.]/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/\.+$/, '').trim())
    .filter(t => t.length > 0);
}

function _honorificSignalFromName(
  tokens: string[],
): { gender: InferredGender; signal: string | null } {
  // We scan every token (so "DET. MR. SMITH" still finds "MR").
  for (const tok of tokens) {
    if (MALE_HONORIFICS.includes(tok)) return { gender: 'male', signal: `honorific:${tok}` };
    if (FEMALE_HONORIFICS.includes(tok)) return { gender: 'female', signal: `honorific:${tok}` };
  }
  return { gender: 'unknown', signal: null };
}

function _firstNameSignal(
  tokens: string[],
): { gender: InferredGender; signal: string | null } {
  // Pick the first alphabetic token that isn't a known honorific
  // (we'd already have returned on an honorific hit).
  for (const tok of tokens) {
    // Skip pure-honorific tokens so "MRS. SMITH" doesn't try "SMITH".
    if (MALE_HONORIFICS.includes(tok) || FEMALE_HONORIFICS.includes(tok)) continue;
    if (MALE_FIRST_NAMES.has(tok)) return { gender: 'male', signal: `first-name:${tok}` };
    if (FEMALE_FIRST_NAMES.has(tok)) return { gender: 'female', signal: `first-name:${tok}` };
  }
  return { gender: 'unknown', signal: null };
}

// Count male vs female pronouns in a string.
function _countPronouns(text: string): { male: number; female: number } {
  const t = ` ${text} `;
  const male = (t.match(/\b(he|him|his|himself)\b/gi) || []).length;
  const female = (t.match(/\b(she|her|hers|herself)\b/gi) || []).length;
  return { male, female };
}

// Escape a character name for use in a RegExp.
function _escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the best inferred gender for a character based on local,
 * deterministic analysis of the character's name and dialogue lines.
 * Never calls an LLM, network, or any platform API.
 *
 * The function is intentionally conservative — when signals conflict
 * or no signal clears the confidence floor, it returns 'unknown' so
 * the caller can fall back to its default (mixed-gender rotation).
 */
export function inferGenderFromScriptPure(
  characterName: string,
  lines: GenderInferenceLine[],
): GenderInferenceResult {
  const signals: string[] = [];
  const name = (characterName || '').trim();
  if (!name) {
    return { gender: 'unknown', confidence: 0, signals: ['empty-name'] };
  }
  const tokens = _splitNameTokens(name);

  // 1. Honorific in name — strongest, bail immediately.
  const hon = _honorificSignalFromName(tokens);
  if (hon.gender !== 'unknown' && hon.signal) {
    signals.push(hon.signal);
    return { gender: hon.gender, confidence: 0.95, signals };
  }

  // 2. Pronoun ratio in stage directions that reference the character.
  //    Stage directions are strongest because they are narration ABOUT
  //    the character rather than something the character says.
  const sdPronouns = { male: 0, female: 0 };
  const dialoguePronouns = { male: 0, female: 0 };
  const nameRe = new RegExp(`\\b${_escapeRegex(name)}\\b`, 'i');
  const upperName = name.toUpperCase();
  const firstToken = tokens[0];

  for (const line of lines) {
    if (!line || typeof line.text !== 'string') continue;
    const isSd = !!line.is_stage_direction;
    const isOwnLine =
      !isSd &&
      typeof line.character === 'string' &&
      (line.character.toUpperCase() === upperName ||
        (firstToken && line.character.toUpperCase() === firstToken));

    // Stage directions: scan whenever the character is mentioned.
    if (isSd) {
      if (nameRe.test(line.text) || (firstToken && new RegExp(`\\b${_escapeRegex(firstToken)}\\b`, 'i').test(line.text))) {
        const c = _countPronouns(line.text);
        sdPronouns.male += c.male;
        sdPronouns.female += c.female;
      }
      continue;
    }

    // Other characters' dialogue: only count pronouns from a sentence
    // that mentions this character by name — or the immediately
    // following sentence, since pronouns often appear in the sentence
    // AFTER the name ("Where is Casey? He said he'd be here.").
    if (!isOwnLine) {
      const sentences = line.text.split(/(?<=[.!?])\s+/);
      const firstTokenRe = firstToken ? new RegExp(`\\b${_escapeRegex(firstToken)}\\b`, 'i') : null;
      let mentionedInPrev = false;
      for (const sent of sentences) {
        const mentionedHere =
          nameRe.test(sent) ||
          (firstTokenRe !== null && firstTokenRe.test(sent));
        if (mentionedHere || mentionedInPrev) {
          const c = _countPronouns(sent);
          dialoguePronouns.male += c.male;
          dialoguePronouns.female += c.female;
        }
        mentionedInPrev = mentionedHere;
      }
    }
  }

  // Evaluate stage-direction evidence first.
  if (sdPronouns.male + sdPronouns.female >= 2) {
    if (sdPronouns.male >= 2 && sdPronouns.male >= sdPronouns.female * 3) {
      signals.push(`stage-dir-pronouns:m=${sdPronouns.male},f=${sdPronouns.female}`);
      return { gender: 'male', confidence: 0.85, signals };
    }
    if (sdPronouns.female >= 2 && sdPronouns.female >= sdPronouns.male * 3) {
      signals.push(`stage-dir-pronouns:m=${sdPronouns.male},f=${sdPronouns.female}`);
      return { gender: 'female', confidence: 0.85, signals };
    }
  }

  // Then other-character dialogue pronoun evidence.
  if (dialoguePronouns.male + dialoguePronouns.female >= 3) {
    if (dialoguePronouns.male >= 3 && dialoguePronouns.male >= dialoguePronouns.female * 3) {
      signals.push(`dialogue-pronouns:m=${dialoguePronouns.male},f=${dialoguePronouns.female}`);
      return { gender: 'male', confidence: 0.75, signals };
    }
    if (dialoguePronouns.female >= 3 && dialoguePronouns.female >= dialoguePronouns.male * 3) {
      signals.push(`dialogue-pronouns:m=${dialoguePronouns.male},f=${dialoguePronouns.female}`);
      return { gender: 'female', confidence: 0.75, signals };
    }
  }

  // 4. First-name allowlist (last-resort heuristic).
  const fn = _firstNameSignal(tokens);
  if (fn.gender !== 'unknown' && fn.signal) {
    signals.push(fn.signal);
    return { gender: fn.gender, confidence: 0.6, signals };
  }

  signals.push('no-signal');
  return { gender: 'unknown', confidence: 0, signals };
}

// ─── CACHE KEY ───────────────────────────────────────────────────────
export function makeAudioCacheKey(voiceId: string, text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return `${voiceId}:${text.length}:${h}`;
}

// ─── PLAYBACK SEAM (E2E MOCKABLE) ────────────────────────────────────
// The exact function the smoke test exercises. It does everything the
// real rehearsal screen does — voice resolution, provider selection,
// ElevenLabs fetch, byte capture, base64 encoding, file write, audio
// load, play, completion — but every side-effecting dependency is
// injected. In production (elevenLabsService.playSpeech) the adapters
// are wired to fetch / expo-file-system / expo-av. In the smoke test
// they are wired to deterministic stubs.

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
}

export interface PlaybackAdapters {
  /** Fetch ElevenLabs audio for a voiceId. */
  fetchAudio: (voiceId: string, text: string) => Promise<HttpResponseLike>;
  /** Persist base64 bytes to a file:// URI. Returns the URI. */
  writeAudioFile: (voiceId: string, base64: string) => Promise<string>;
  /** Load + play the audio file. Resolves to a "sound handle". */
  loadAndPlay: (
    fileUri: string,
    onFinish: () => void,
    onError: (err: string) => void,
  ) => Promise<{ handle: unknown; started: boolean }>;
  /** Emitted for every diagnostic breadcrumb — see file header list. */
  emit?: (event: string, payload: Record<string, unknown>) => void;
}

export interface PlaybackResult {
  provider: Provider;
  succeeded: boolean;
  fileUri: string | null;
  byteLength: number;
  fellBackToExpoSpeech: boolean;
  errorStage: string | null;
}

/**
 * Executes the FULL ElevenLabs → file → load → play pipeline for a
 * single character line, or falls back to expo-speech. The caller is
 * responsible for wiring `onFinish` to the "advance-to-next-line"
 * behaviour — the pure function only reports success/failure.
 */
export async function playCharacterLinePure(
  text: string,
  character: string | null | undefined,
  assignments: Record<string, CharacterVoiceAssignmentLite>,
  elevenLabsConfigured: boolean,
  adapters: PlaybackAdapters,
  onFinish: () => void,
): Promise<PlaybackResult> {
  const emit = adapters.emit ?? (() => {});
  const resolution = resolveVoiceForCharacter(assignments, character);
  emit('VOICE_RESOLUTION', {
    character: resolution.character || '(unknown)',
    assignmentPresent: resolution.assignmentPresent,
    voiceKey: resolution.voiceKey,
    voiceIdPresent: !!resolution.voiceId,
  });

  const provider = selectProvider(elevenLabsConfigured, resolution);
  emit('VOICE_PROVIDER_SELECTED', {
    character: resolution.character || '(unknown)',
    provider,
    elevenLabsConfigured,
  });

  const result: PlaybackResult = {
    provider,
    succeeded: false,
    fileUri: null,
    byteLength: 0,
    fellBackToExpoSpeech: false,
    errorStage: null,
  };

  if (provider !== 'elevenlabs' || !resolution.voiceId) {
    // No ElevenLabs path — caller must invoke expo-speech.
    result.fellBackToExpoSpeech = true;
    emit('FALLBACK_TO_EXPO_SPEECH', {
      character: resolution.character || '(unknown)',
      reason: !elevenLabsConfigured
        ? 'not-configured'
        : (resolution.assignmentPresent ? 'no-voiceId' : 'no-assignment'),
    });
    return result;
  }

  const voiceId = resolution.voiceId;
  emit('ELEVENLABS_REQUEST_START', { voiceId, textLength: text.length });

  let response: HttpResponseLike;
  try {
    response = await adapters.fetchAudio(voiceId, text);
  } catch (e: any) {
    emit('ELEVENLABS_RESPONSE', {
      voiceId, success: false, httpStatus: 0,
      error: e?.message || String(e), stage: 'network',
    });
    emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'network' });
    result.fellBackToExpoSpeech = true;
    result.errorStage = 'network';
    return result;
  }

  if (!response.ok) {
    let bodyPreview = '';
    if (response.text) {
      try { bodyPreview = (await response.text()).substring(0, 200); }
      catch { /* ignore */ }
    }
    emit('ELEVENLABS_RESPONSE', {
      voiceId, success: false, httpStatus: response.status,
      bodyPreview, stage: 'http-status',
    });
    emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: `http-${response.status}` });
    result.fellBackToExpoSpeech = true;
    result.errorStage = `http-${response.status}`;
    return result;
  }

  let bytes: Uint8Array;
  try {
    const buf = await response.arrayBuffer();
    bytes = new Uint8Array(buf);
  } catch (e: any) {
    emit('ELEVENLABS_RESPONSE', {
      voiceId, success: false, httpStatus: response.status,
      error: e?.message || String(e), stage: 'arraybuffer',
    });
    emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'arraybuffer' });
    result.fellBackToExpoSpeech = true;
    result.errorStage = 'arraybuffer';
    return result;
  }

  if (bytes.length === 0) {
    emit('ELEVENLABS_RESPONSE', {
      voiceId, success: false, httpStatus: response.status,
      byteLength: 0, stage: 'empty-body',
    });
    emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'empty-body' });
    result.fellBackToExpoSpeech = true;
    result.errorStage = 'empty-body';
    return result;
  }
  result.byteLength = bytes.length;
  emit('ELEVENLABS_RESPONSE', {
    voiceId, success: true, httpStatus: response.status, byteLength: bytes.length,
  });

  const base64 = uint8ArrayToBase64(bytes);
  let fileUri: string;
  try {
    fileUri = await adapters.writeAudioFile(voiceId, base64);
  } catch (e: any) {
    emit('ELEVENLABS_AUDIO_READY', {
      voiceId, success: false, error: e?.message || String(e), stage: 'write-file',
    });
    emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'write-file' });
    result.fellBackToExpoSpeech = true;
    result.errorStage = 'write-file';
    return result;
  }
  result.fileUri = fileUri;
  emit('ELEVENLABS_AUDIO_READY', {
    voiceId, success: true, byteLength: bytes.length,
  });

  emit('AUDIO_LOAD_START', { voiceId, fileUri });
  let started: boolean;
  try {
    const played = await adapters.loadAndPlay(
      fileUri,
      () => { emit('AUDIO_PLAYBACK_COMPLETE', { voiceId }); onFinish(); },
      (err) => {
        emit('AUDIO_PLAYBACK_ERROR', { voiceId, stage: 'runtime', error: err });
      },
    );
    started = played.started;
  } catch (e: any) {
    emit('AUDIO_PLAYBACK_ERROR', {
      voiceId, stage: 'load', error: e?.message || String(e),
    });
    emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'audio-load' });
    result.fellBackToExpoSpeech = true;
    result.errorStage = 'audio-load';
    return result;
  }

  emit('AUDIO_LOAD_SUCCESS', { voiceId, fileUri });
  emit('AUDIO_PLAY_START', { voiceId });
  if (started) {
    emit('AUDIO_PLAYING', { voiceId });
  }
  result.succeeded = started;
  if (!started) {
    emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'audio-not-started' });
    result.fellBackToExpoSpeech = true;
    result.errorStage = 'audio-not-started';
  }
  return result;
}
