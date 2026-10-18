// Pure rehearsal line-matching helpers (no React Native imports, so they run under Node tests).

const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'can not'],
  [/\bcannot\b/g, 'can not'],
  [/\bshan't\b/g, 'shall not'],
  [/\blet's\b/g, 'let us'],
  [/\b(it|that|what|he|she|there|here|who|where|how)'s\b/g, '$1 is'],
  [/n't\b/g, ' not'],
  [/'re\b/g, ' are'],
  [/'m\b/g, ' am'],
  [/'ll\b/g, ' will'],
  [/'ve\b/g, ' have'],
  [/'d\b/g, ' would'],
];

// Recogniser spellings that are unambiguous (e.g. "wont"/"well"/"its" are real words, so excluded).
const WORD_EQUIVALENTS: Record<string, string> = {
  dont: 'do not', didnt: 'did not', doesnt: 'does not', isnt: 'is not', arent: 'are not',
  wasnt: 'was not', werent: 'were not', cant: 'can not', couldnt: 'could not',
  wouldnt: 'would not', shouldnt: 'should not', havent: 'have not', hasnt: 'has not',
  hadnt: 'had not', im: 'i am', youre: 'you are', theyre: 'they are', ive: 'i have',
  youve: 'you have', weve: 'we have', theyve: 'they have', thats: 'that is', whats: 'what is',
  ok: 'okay', mr: 'mister', mrs: 'missus', dr: 'doctor',
};

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const numberToWords = (n: number): string =>
  n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');

const canonicalWord = (w: string): string => {
  if (/^\d{1,2}$/.test(w)) return numberToWords(parseInt(w, 10));
  return WORD_EQUIVALENTS[w] ?? w;
};

// Lowercase, expand contractions, and turn punctuation (incl. dashes/ellipses) into word breaks.
export const normalizeText = (text: string): string => {
  let t = (text || '').toLowerCase().replace(/[\u2018\u2019\u02bc`]/g, "'");
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  t = t.replace(/'/g, '').replace(/[^\w\s]|_/g, ' ');
  return t.split(/\s+/).filter(Boolean).map(canonicalWord).join(' ');
};

export const levenshteinDistance = (str1: string, str2: string): number => {
  const m = str1.length;
  const n = str2.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prevRow = Array(n + 1).fill(0).map((_, i) => i);
  let currRow = Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(prevRow[j] + 1, currRow[j - 1] + 1, prevRow[j - 1] + cost);
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[n];
};

// Weighted word-overlap / character / key-word similarity in [0, 1]. Formula unchanged.
export const calculateSimilarity = (spoken: string, expected: string): number => {
  const s1 = normalizeText(spoken);
  const s2 = normalizeText(expected);
  if (s1 === s2) return s1.length > 0 ? 1 : 0;
  if (s1.length === 0 || s2.length === 0) return 0;

  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  let wordMatchCount = 0;
  const usedIndices = new Set<number>();
  for (const word1 of words1) {
    let bestMatch = -1;
    let bestScore = 0;
    for (let i = 0; i < words2.length; i++) {
      if (usedIndices.has(i)) continue;
      const word2 = words2[i];
      if (word1 === word2) {
        bestMatch = i;
        bestScore = 1;
        break;
      }
      if (word1.length > 3 && word2.length > 3) {
        const dist = levenshteinDistance(word1, word2);
        const similarity = 1 - dist / Math.max(word1.length, word2.length);
        if (similarity > 0.7 && similarity > bestScore) {
          bestMatch = i;
          bestScore = similarity;
        }
      }
    }
    if (bestMatch >= 0) {
      wordMatchCount += bestScore;
      usedIndices.add(bestMatch);
    }
  }
  const wordOverlapScore = wordMatchCount / Math.max(words1.length, words2.length);
  const charScore = 1 - levenshteinDistance(s1, s2) / Math.max(s1.length, s2.length);
  const sequenceScore = words2.filter(w => w.length > 2 && s1.includes(w)).length / words2.length;
  return wordOverlapScore * 0.5 + charScore * 0.3 + sequenceScore * 0.2;
};

// Text heard earlier in this line (finalised recogniser sessions) plus the current session.
export const combineTranscripts = (committed: string, current: string): string =>
  `${committed || ''} ${current || ''}`.replace(/\s+/g, ' ').trim();

// Score a line heard across one or more mic sessions. Never worse than scoring the current
// session alone, so an actor restarting the line from the top isn't penalised for the retry.
export const scoreLineAttempt = (committed: string, current: string, expected: string) => {
  const combined = combineTranscripts(committed, current);
  const combinedScore = calculateSimilarity(combined, expected);
  const currentScore = calculateSimilarity(current, expected);
  const useCombined = combinedScore >= currentScore;
  return {
    transcript: useCombined ? combined : (current || '').trim(),
    similarity: useCombined ? combinedScore : currentScore,
  };
};


// Average Speech Match over completed (not skipped/missed) user lines that have a recognised
// score > 0. Lines without a score are excluded, never counted as 0% or 100%. One score per line.
export const summarizeSpeechMatch = (
  performances: { lineIndex: number; speechAccuracy?: number }[],
  missedLineIndexes: number[],
): { speechMatch: number | null; scoredLines: number } => {
  const missed = new Set(missedLineIndexes || []);
  const byLine = new Map<number, number>();
  for (const p of performances || []) {
    if (!p || missed.has(p.lineIndex)) continue;
    const a = p.speechAccuracy;
    if (typeof a === 'number' && Number.isFinite(a) && a > 0) byLine.set(p.lineIndex, Math.min(1, a));
  }
  const scores = [...byLine.values()];
  if (scores.length === 0) return { speechMatch: null, scoredLines: 0 };
  return {
    speechMatch: Math.round((scores.reduce((s, a) => s + a, 0) / scores.length) * 100),
    scoredLines: scores.length,
  };
};
