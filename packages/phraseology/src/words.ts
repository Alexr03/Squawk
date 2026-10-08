// Shared vocabulary: digits, the spelling alphabet, transcript tokenising and fuzzy matching.

/*
 * Written number forms (decision). CAP 413 gives pronunciation guides (WUN, TREE, FOW-er, FIFE, AIT,
 * NIN-er) but writes transcripts in plain words. The radio log follows that: digits are plain English
 * words, except 9, which is always written "niner" (the one CAP 413 form that is a word in its own
 * right, and how frequencies are read on the radio: "one one niner decimal seven three zero").
 * Numbers are spoken digit by digit, except whole thousands/hundreds in altitudes ("four thousand
 * feet", "flight level one hundred"), per CAP 413. The voice parser accepts every variant.
 */
export const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
// CAP 413 spelling alphabet as written in UK transcripts ("Alpha", "Juliet"); the parser also takes Alfa/Juliett.
export const PHONETIC = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo',
  'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray',
  'Yankee', 'Zulu'];

/** Spell a designator: digits as words, letters phonetically, '.' as "decimal". "4RG" -> "four Romeo Golf". */
export const spell = (s: string | number) => [...String(s).toUpperCase()]
  .map(c => /\d/.test(c) ? DIGITS[+c] : c === '.' ? 'decimal' : /[A-Z]/.test(c) ? PHONETIC[c.charCodeAt(0) - 65] : '')
  .filter(Boolean).join(' ');

// ---------------------------------------------------------------- transcript -> tokens

const NUM: Record<string, string> = {
  zero: '0', oh: '0', nought: '0', one: '1', two: '2', too: '2', three: '3', tree: '3', four: '4', fower: '4',
  five: '5', fife: '5', six: '6', seven: '7', eight: '8', ait: '8', nine: '9', niner: '9', ten: '10', eleven: '11',
  twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90',
};
const LETTER: Record<string, string> = {};
PHONETIC.forEach((w, i) => { LETTER[w.toLowerCase().replace('-', '')] = String.fromCharCode(65 + i); });
Object.assign(LETTER, { alfa: 'A', juliett: 'J', whisky: 'W' });

/** Multi-word phrases collapsed to one token before parsing (order matters). */
const PHRASES: [RegExp, string][] = [
  [/\bx ray\b/g, 'xray'], [/\bfox trot\b/g, 'foxtrot'], [/\bi l s\b/g, 'ils'], [/\bq n h\b/g, 'qnh'], [/\bf l\b/g, 'fl'],
  [/\bflight level\b/g, 'fl'], [/\btake off\b/g, 'takeoff'], [/\bline up\b/g, 'lineup'], [/\bgo a?round\b/g, 'goaround'],
  [/\bgoing a?round\b/g, 'goaround'], [/\bhold(ing)? short\b/g, 'holdshort'], [/\bi say again\b/g, 'isayagain'],
  [/\bsay again\b/g, 'sayagain'], [/\bfollow (the )?greens?\b/g, 'greens'],
  [/\bpush (and|back and|back &) start\b|\bpush back\b|\bpushback\b|\bpush start\b/g, 'push'],
  [/\bresume (own )?nav(igation)?\b/g, 'resumenav'], [/\bresume (normal )?speed\b|\bno speed restrictions?\b/g, 'resumespeed'],
  [/\bholding point\b/g, 'hp'], [/\bgive way\b/g, 'giveway'], [/\b(route|proceed|routing) direct( to)?\b|\bdirect to\b/g, 'direct'],
  [/\b(go|come) down\b/g, 'godown'], [/\bgo up\b/g, 'goup'], [/\bpoint\b/g, 'decimal'],
];

/**
 * Normalise a transcript into tokens: lower case, number words -> digit strings ("twenty one" -> "21",
 * "niner" -> "9"), "119.73" -> "119 decimal 73", "27R"/"FL80" split into "27 r"/"fl 80", phrases joined.
 */
export function tokens(s: string): string[] {
  let t = s.toLowerCase()
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d)\.(\d)/g, '$1 decimal $2')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ').trim();
  for (const [re, w] of PHRASES) t = t.replace(re, w);
  const out: string[] = [];
  let tens = false; // previous token was a spoken "twenty".."ninety"
  for (const w of t.split(' ').filter(Boolean)) {
    const n = NUM[w] ?? w;
    if (tens && NUM[w] && /^[1-9]$/.test(n)) { out[out.length - 1] = out[out.length - 1][0] + n; tens = false; continue; }
    tens = !!NUM[w] && /^[2-9]0$/.test(n);
    out.push(n);
  }
  return out;
}

export const isDigits = (t: string | undefined) => !!t && /^\d+$/.test(t);
/** Letter for a spelling-alphabet word or single letter token, else undefined. */
export const letter = (t: string | undefined) => !t ? undefined : t.length === 1 && /[a-z]/.test(t) ? t.toUpperCase() : LETTER[t];

/** Levenshtein similarity 0..1. */
export function similar(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const next = [i];
    for (let j = 1; j <= n; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return 1 - row[n] / Math.max(m, n);
}

export const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
