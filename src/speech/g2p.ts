/**
 * Grapheme-to-phoneme fallback for words no lexicon knows.
 *
 * 1. Morphology: strip a regular suffix (plural/possessive s, -ed, -ing, -er, -ly, -ness, …) or split a
 *    compound into two known words, and build the pronunciation from the lexicon's entries.
 * 2. Letter-to-sound rules in the style of Elovitz, Johnson, McHugh & Shore (NRL Report 7948, 1976:
 *    "Automatic translation of English text to phonetics by means of letter-to-sound rules", a US
 *    Government work in the public domain). The rule set here is our own, much smaller, and writes
 *    British (non-rhotic) vowels. Lexical stress is then assigned by simple English heuristics.
 *
 * The output is a guess. It is flagged as `source: 'rules'` so diagnostics can show which words
 * were not in a dictionary.
 */
import type { Lexicon } from './lexicon'
import { isVowel, type Phone, type Pronunciation, type Stress } from './phonemes'

type Rule = readonly [left: string, match: string, right: string, out: string]

// Context symbols: ' ' word boundary, '#' one or more vowels, ':' zero or more consonants,
// '^' one consonant, '.' a voiced consonant, '+' a front vowel (E I Y), '%' a suffix
// (ING ELY ER ES ED, or E at the end), '&' a sibilant, '@' T S R D L Z N J TH CH SH.
const RULES: Record<string, readonly Rule[]> = {
  A: [
    [' ', 'A', ' ', 'ə'],
    ['', 'ARE', ' ', 'ɑː'],
    [' ', 'AR', 'O', 'ə r'],
    ['', 'AR', '#', 'eə r'],
    ['^', 'AS', '#', 'eɪ s'],
    ['', 'A', 'WA', 'ə'],
    ['', 'AW', '', 'ɔː'],
    [' :', 'ANY', '', 'e n i'],
    ['', 'AGAIN', '', 'ə g e n'],
    ['#:', 'ALLY', '', 'ə l i'],
    [' ', 'AL', '#', 'ə l'],
    ['#:', 'AG', 'E', 'ɪ dʒ'],
    ['', 'A', 'TION', 'eɪ'],
    ['', 'A', '^+:#', 'æ'],
    [' :', 'A', '^+ ', 'eɪ'],
    ['', 'A', '^%', 'eɪ'],
    [' ', 'ARR', '', 'ə r'],
    ['', 'ARR', '', 'æ r'],
    [' :', 'AR', ' ', 'ɑː'],
    ['', 'AR', ' ', 'ə'],
    ['', 'AR', '', 'ɑː'],
    ['', 'AIR', '', 'eə'],
    ['', 'AI', '', 'eɪ'],
    ['', 'AY', '', 'eɪ'],
    ['', 'AU', '', 'ɔː'],
    ['#:', 'AL', ' ', 'ə l'],
    ['#:', 'ALS', ' ', 'ə l z'],
    ['', 'ALK', '', 'ɔː k'],
    ['', 'AL', '^', 'ɔː l'],
    [' :', 'ABLE', '', 'eɪ b ə l'],
    ['', 'ABLE', '', 'ə b ə l'],
    ['', 'ANG', '+', 'eɪ n dʒ'],
    ['', 'A', '', 'æ'],
  ],
  B: [
    [' ', 'BE', '^#', 'b ɪ'],
    ['', 'BEING', '', 'b iː ɪ ŋ'],
    [' ', 'BOTH', ' ', 'b əʊ θ'],
    [' ', 'BUS', '#', 'b ɪ z'],
    ['', 'BUIL', '', 'b ɪ l'],
    ['', 'BB', '', 'b'],
    ['', 'B', '', 'b'],
  ],
  C: [
    [' ', 'CH', '^', 'k'],
    ['^E', 'CH', '', 'k'],
    ['', 'CH', '', 'tʃ'],
    [' S', 'CI', '#', 's aɪ'],
    ['', 'CI', 'A', 'ʃ'],
    ['', 'CI', 'O', 'ʃ'],
    ['', 'CI', 'EN', 'ʃ'],
    ['', 'C', '+', 's'],
    ['', 'CK', '', 'k'],
    ['', 'COM', '%', 'k ʌ m'],
    ['', 'CC', '+', 'k s'],
    ['', 'CC', '', 'k'],
    ['', 'C', '', 'k'],
  ],
  D: [
    ['#:', 'DED', ' ', 'd ɪ d'],
    ['.E', 'D', ' ', 'd'],
    ['#^:E', 'D', ' ', 't'],
    [' ', 'DE', '^#', 'd ɪ'],
    [' ', 'DO', ' ', 'd uː'],
    [' ', 'DOES', '', 'd ʌ z'],
    [' ', 'DOING', '', 'd uː ɪ ŋ'],
    [' ', 'DOW', '', 'd aʊ'],
    ['', 'DU', 'A', 'dʒ uː'],
    ['', 'DD', '', 'd'],
    ['', 'DG', 'E', 'dʒ'],
    ['', 'D', '', 'd'],
  ],
  E: [
    ['#:', 'E', ' ', ''],
    ["'", 'E', ' ', ''],
    [' :^', 'E', ' ', ''],
    [' :', 'E', ' ', 'iː'],
    ['#', 'ED', ' ', 'd'],
    ['#:', 'E', 'D ', ''],
    ['', 'EV', 'ER', 'e v'],
    ['#:', 'ER', ' ', 'ə'],
    ['#:', 'ERS', ' ', 'ə z'],
    ['', 'E', '^%', 'iː'],
    ['', 'ERI', '#', 'ɪə r i'],
    ['', 'ERI', '', 'e r ɪ'],
    ['#:', 'ER', '#', 'ə r'],
    ['', 'ER', '#', 'e r'],
    ['', 'ER', '', 'ɜː'],
    [' ', 'EVEN', '', 'iː v ə n'],
    ['#:', 'E', 'W', ''],
    ['@', 'EW', '', 'uː'],
    ['', 'EW', '', 'j uː'],
    ['', 'E', 'O', 'iː'],
    ['#:&', 'ES', ' ', 'ɪ z'],
    ['#:', 'E', 'S ', ''],
    ['#:', 'ELY', ' ', 'l i'],
    ['#:', 'EMENT', '', 'm ə n t'],
    ['', 'EFUL', '', 'f ʊ l'],
    ['', 'EE', '', 'iː'],
    ['', 'EARN', '', 'ɜː n'],
    [' ', 'EAR', '^', 'ɜː'],
    ['', 'EAD', '', 'e d'],
    ['#:', 'EA', ' ', 'iː ə'],
    ['', 'EA', 'SU', 'e'],
    ['', 'EAR', '', 'ɪə'],
    ['', 'EA', '', 'iː'],
    ['', 'EIGH', '', 'eɪ'],
    ['', 'EI', '', 'iː'],
    [' ', 'EYE', '', 'aɪ'],
    ['', 'EY', '', 'i'],
    ['', 'EU', '', 'j uː'],
    ['', 'E', '', 'e'],
  ],
  F: [
    ['', 'FUL', '', 'f ʊ l'],
    ['', 'FF', '', 'f'],
    ['', 'F', '', 'f'],
  ],
  G: [
    ['', 'GIV', '', 'g ɪ v'],
    [' ', 'G', 'I^', 'g'],
    ['', 'GE', 'T', 'g e'],
    ['SU', 'GGES', '', 'g dʒ e s'],
    ['', 'GG', '', 'g'],
    [' B#', 'G', '', 'g'],
    ['', 'GREAT', '', 'g r eɪ t'],
    [' ', 'GN', '', 'n'],
    ['', 'GN', ' ', 'n'],
    [' ', 'GH', '', 'g'],
    ['#', 'GH', '', ''],
    ['', 'G', '+', 'dʒ'],
    ['', 'G', '', 'g'],
  ],
  H: [
    [' ', 'HAV', '', 'h æ v'],
    [' ', 'HERE', '', 'h ɪə'],
    [' ', 'HOUR', '', 'aʊ ə'],
    ['', 'HOW', '', 'h aʊ'],
    ['', 'H', '#', 'h'],
    ['', 'H', '', ''],
  ],
  I: [
    [' ', 'IN', '', 'ɪ n'],
    [' ', 'I', ' ', 'aɪ'],
    ['', 'IN', 'D', 'aɪ n'],
    ['', 'IER', '', 'iː ə'],
    ['#:R', 'IED', '', 'i d'],
    ['', 'IED', ' ', 'aɪ d'],
    ['', 'IEN', '', 'iː ə n'],
    ['', 'IE', 'T', 'aɪ e'],
    [' :', 'I', '%', 'aɪ'],
    ['', 'I', '%', 'iː'],
    ['', 'IE', '', 'iː'],
    ['', 'I', '^+:#', 'ɪ'],
    ['', 'IR', '#', 'aɪ r'],
    ['', 'IZ', '%', 'aɪ z'],
    ['', 'IS', '%', 'aɪ z'],
    ['', 'I', 'D%', 'aɪ'],
    ['+^', 'I', '^+', 'ɪ'],
    ['', 'I', 'T%', 'aɪ'],
    ['#^:', 'I', '^+', 'ɪ'],
    ['', 'I', '^+', 'aɪ'],
    ['', 'IR', '', 'ɜː'],
    ['', 'IGH', '', 'aɪ'],
    ['', 'ILD', '', 'aɪ l d'],
    ['', 'IGN', ' ', 'aɪ n'],
    ['', 'IGN', '^', 'aɪ n'],
    ['', 'IGN', '%', 'aɪ n'],
    ['', 'IQUE', '', 'iː k'],
    ['', 'I', '', 'ɪ'],
  ],
  J: [['', 'J', '', 'dʒ']],
  K: [
    [' ', 'K', 'N', ''],
    ['', 'K', '', 'k'],
  ],
  L: [
    ['', 'LO', 'C#', 'l əʊ'],
    ['L', 'L', '', ''],
    ['#^:', 'L', '%', 'ə l'],
    ['', 'LEAD', '', 'l iː d'],
    ['', 'L', '', 'l'],
  ],
  M: [
    ['', 'MOV', '', 'm uː v'],
    ['', 'MM', '', 'm'],
    ['', 'M', '', 'm'],
  ],
  N: [
    ['E', 'NG', '+', 'n dʒ'],
    ['', 'NG', 'R', 'ŋ g'],
    ['', 'NG', '#', 'ŋ g'],
    ['', 'NGL', '%', 'ŋ g ə l'],
    ['', 'NG', '', 'ŋ'],
    ['', 'NK', '', 'ŋ k'],
    [' ', 'NOW', ' ', 'n aʊ'],
    ['', 'NN', '', 'n'],
    ['', 'N', '', 'n'],
  ],
  O: [
    ['', 'OF', ' ', 'ə v'],
    ['', 'OROUGH', '', 'ʌ r ə'],
    ['#:', 'OR', ' ', 'ə'],
    ['#:', 'ORS', ' ', 'ə z'],
    ['', 'OR', '', 'ɔː'],
    [' ', 'ONE', '', 'w ʌ n'],
    [' ', 'ONCE', '', 'w ʌ n s'],
    [' ', 'ONLY', '', 'əʊ n l i'],
    [' ', 'OVER', '', 'əʊ v ə'],
    ['', 'OW', '', 'əʊ'],
    ['', 'OV', '', 'ʌ v'],
    ['', 'O', '^%', 'əʊ'],
    ['', 'O', '^EN', 'əʊ'],
    ['', 'O', '^I#', 'əʊ'],
    ['', 'OL', 'D', 'əʊ l'],
    ['', 'OUGHT', '', 'ɔː t'],
    ['', 'OUGH', '', 'ʌ f'],
    [' ', 'OU', '', 'aʊ'],
    ['H', 'OU', 'S#', 'aʊ'],
    ['', 'OUS', '', 'ə s'],
    ['', 'OUR', '', 'ɔː'],
    ['', 'OULD', '', 'ʊ d'],
    ['^', 'OU', '^L', 'ʌ'],
    ['', 'OUP', '', 'uː p'],
    ['', 'OU', '', 'aʊ'],
    ['', 'OY', '', 'ɔɪ'],
    ['', 'OING', '', 'əʊ ɪ ŋ'],
    ['', 'OI', '', 'ɔɪ'],
    ['', 'OOR', '', 'ɔː'],
    ['', 'OOK', '', 'ʊ k'],
    ['', 'OOD', '', 'ʊ d'],
    ['', 'OO', '', 'uː'],
    ['', 'O', 'E', 'əʊ'],
    ['', 'O', ' ', 'əʊ'],
    ['', 'OA', '', 'əʊ'],
    ['', "ON'T", '', 'əʊ n t'],
    ['', 'OTHER', '', 'ʌ ð ə'],
    ['I', 'ON', '', 'ə n'],
    ['#:', 'ON', ' ', 'ə n'],
    ['#^', 'ON', '', 'ə n'],
    ['', 'O', 'ST ', 'əʊ'],
    ['', 'O', 'NG', 'ɒ'],
    [' :^', 'O', 'N', 'ʌ'],
    ['', 'OSS', ' ', 'ɒ s'],
    ['#^:', 'OM', '', 'ʌ m'],
    ['', 'O', '', 'ɒ'],
  ],
  P: [
    ['', 'PH', '', 'f'],
    ['', 'PEOP', '', 'p iː p'],
    ['', 'POW', '', 'p aʊ'],
    ['', 'PUT', ' ', 'p ʊ t'],
    ['', 'PP', '', 'p'],
    ['', 'P', '', 'p'],
  ],
  Q: [
    ['', 'QUAR', '', 'k w ɔː'],
    ['', 'QU', '', 'k w'],
    ['', 'Q', '', 'k'],
  ],
  R: [
    [' ', 'RE', '^#', 'r ɪ'],
    ['', 'RR', '', 'r'],
    ['', 'R', '', 'r'],
  ],
  S: [
    ['', 'SH', '', 'ʃ'],
    ['#', 'SION', '', 'ʒ ə n'],
    ['', 'SOME', '', 's ʌ m'],
    ['#', 'SUR', '#', 'ʒ ə r'],
    ['', 'SUR', '#', 'ʃ ʊə r'],
    ['#', 'SU', '#', 'ʒ uː'],
    ['#', 'SSU', '#', 'ʃ uː'],
    ['#', 'SED', ' ', 'z d'],
    ['#', 'S', '#', 'z'],
    ['', 'SAID', '', 's e d'],
    ['^', 'SION', '', 'ʃ ə n'],
    ['', 'S', 'S', ''],
    ['.', 'S', ' ', 'z'],
    ['#:.E', 'S', ' ', 'z'],
    ['#^:##', 'S', ' ', 'z'],
    ['#^:#', 'S', ' ', 's'],
    ['U', 'S', ' ', 's'],
    [' :#', 'S', ' ', 'z'],
    [' ', 'SCH', '', 's k'],
    ['', 'S', 'C+', ''],
    ['#', 'SM', '', 'z m'],
    ['', 'S', '', 's'],
  ],
  T: [
    [' ', 'THE', ' ', 'ð ə'],
    ['', 'TO', ' ', 't uː'],
    ['', 'THAT', ' ', 'ð æ t'],
    [' ', 'THIS', ' ', 'ð ɪ s'],
    [' ', 'THEY', '', 'ð eɪ'],
    [' ', 'THERE', '', 'ð eə'],
    ['', 'THER', '', 'ð ə'],
    ['', 'THEIR', '', 'ð eə'],
    [' ', 'THAN', ' ', 'ð æ n'],
    [' ', 'THEM', ' ', 'ð e m'],
    ['', 'THESE', ' ', 'ð iː z'],
    [' ', 'THEN', '', 'ð e n'],
    ['', 'THROUGH', '', 'θ r uː'],
    ['', 'THOSE', '', 'ð əʊ z'],
    ['', 'THOUGH', ' ', 'ð əʊ'],
    [' ', 'THUS', '', 'ð ʌ s'],
    ['', 'TH', '', 'θ'],
    ['#:', 'TED', ' ', 't ɪ d'],
    ['S', 'TI', '#N', 'tʃ'],
    ['', 'TI', 'O', 'ʃ'],
    ['', 'TI', 'A', 'ʃ'],
    ['', 'TIEN', '', 'ʃ ə n'],
    ['', 'TURE', '', 'tʃ ə'],
    ['', 'TUR', '#', 'tʃ ʊə r'],
    ['', 'TU', 'A', 'tʃ uː'],
    [' ', 'TWO', '', 't uː'],
    ['', 'TT', '', 't'],
    ['', 'T', '', 't'],
  ],
  U: [
    [' ', 'UN', 'I', 'j uː n'],
    [' ', 'UN', '', 'ʌ n'],
    [' ', 'UPON', '', 'ə p ɒ n'],
    ['@', 'UR', '#', 'ʊə r'],
    ['', 'UR', '#', 'j ʊə r'],
    ['', 'UR', '', 'ɜː'],
    ['', 'U', '^ ', 'ʌ'],
    ['', 'U', '^^', 'ʌ'],
    ['', 'UY', '', 'aɪ'],
    [' G', 'U', '#', ''],
    ['G', 'U', '%', ''],
    ['G', 'U', '#', 'w'],
    ['#N', 'U', '', 'j uː'],
    ['@', 'U', '', 'uː'],
    ['', 'U', '', 'j uː'],
  ],
  V: [
    ['', 'VIEW', '', 'v j uː'],
    ['', 'V', '', 'v'],
  ],
  W: [
    [' ', 'WERE', '', 'w ɜː'],
    ['', 'WA', 'S', 'w ɒ'],
    ['', 'WA', 'T', 'w ɒ'],
    ['', 'WHERE', '', 'w eə'],
    ['', 'WHAT', '', 'w ɒ t'],
    ['', 'WHOL', '', 'h əʊ l'],
    ['', 'WHO', '', 'h uː'],
    ['', 'WH', '', 'w'],
    ['', 'WAR', '', 'w ɔː'],
    ['', 'WOR', '^', 'w ɜː'],
    ['', 'WR', '', 'r'],
    ['', 'W', '', 'w'],
  ],
  X: [
    [' ', 'X', '', 'z'],
    ['', 'X', '', 'k s'],
  ],
  Y: [
    ['', 'YOUNG', '', 'j ʌ ŋ'],
    [' ', 'YOU', '', 'j uː'],
    [' ', 'YES', '', 'j e s'],
    [' ', 'Y', '', 'j'],
    ['#^:', 'Y', ' ', 'i'],
    ['#^:', 'Y', 'I', 'i'],
    [' :', 'Y', ' ', 'aɪ'],
    [' :', 'Y', '#', 'aɪ'],
    [' :', 'Y', '^+:#', 'ɪ'],
    [' :', 'Y', '^#', 'aɪ'],
    ['', 'Y', '', 'ɪ'],
  ],
  Z: [
    ['', 'ZZ', '', 'z'],
    ['', 'Z', '', 'z'],
  ],
  "'": [['', "'", '', '']],
}

const VOWELS = 'AEIOUY'
const isV = (ch: string) => VOWELS.includes(ch)
const isC = (ch: string) => ch >= 'A' && ch <= 'Z' && !isV(ch)
const VOICED = 'BDVGJLMNRWZ'
const FRONT = 'EIY'
const SIBILANT = ['S', 'C', 'G', 'Z', 'X', 'J', 'CH', 'SH']
const NONPAL = ['T', 'S', 'R', 'D', 'L', 'Z', 'N', 'J', 'TH', 'CH', 'SH']
const SUFFIXES = ['ING', 'ELY', 'ER', 'ES', 'ED']

/** Match a right-context pattern starting at word[pos]. */
function matchRight(word: string, pos: number, pattern: string): boolean {
  let i = pos
  for (const p of pattern) {
    const ch = word[i] ?? ' '
    switch (p) {
      case ' ':
        if (ch >= 'A' && ch <= 'Z') return false
        i++
        break
      case '#':
        if (!isV(ch)) return false
        while (isV(word[i] ?? ' ')) i++
        break
      case ':':
        while (isC(word[i] ?? ' ')) i++
        break
      case '^':
        if (!isC(ch)) return false
        i++
        break
      case '.':
        if (!VOICED.includes(ch)) return false
        i++
        break
      case '+':
        if (!FRONT.includes(ch)) return false
        i++
        break
      case '%': {
        const rest = word.slice(i)
        const suf = SUFFIXES.find((s) => rest.startsWith(s))
        if (suf) i += suf.length
        else if (ch === 'E' && !/[A-Z]/.test(word[i + 1] ?? ' ')) i++
        else return false
        break
      }
      case '&': {
        const two = word.slice(i, i + 2)
        if (two === 'CH' || two === 'SH') i += 2
        else if (SIBILANT.includes(ch)) i++
        else return false
        break
      }
      case '@': {
        const two = word.slice(i, i + 2)
        if (NONPAL.includes(two)) i += 2
        else if (NONPAL.includes(ch)) i++
        else return false
        break
      }
      default:
        if (ch !== p) return false
        i++
    }
  }
  return true
}

/** Match a left-context pattern ending just before word[pos], read right to left. */
function matchLeft(word: string, pos: number, pattern: string): boolean {
  let i = pos - 1
  for (let k = pattern.length - 1; k >= 0; k--) {
    const p = pattern[k]!
    const ch = word[i] ?? ' '
    switch (p) {
      case ' ':
        if (ch >= 'A' && ch <= 'Z') return false
        i--
        break
      case '#':
        if (!isV(ch)) return false
        while (isV(word[i] ?? ' ')) i--
        break
      case ':':
        while (isC(word[i] ?? ' ')) i--
        break
      case '^':
        if (!isC(ch)) return false
        i--
        break
      case '.':
        if (!VOICED.includes(ch)) return false
        i--
        break
      case '+':
        if (!FRONT.includes(ch)) return false
        i--
        break
      case '&': {
        const two = word.slice(i - 1, i + 1)
        if (two === 'CH' || two === 'SH') i -= 2
        else if (SIBILANT.includes(ch)) i--
        else return false
        break
      }
      case '@': {
        const two = word.slice(i - 1, i + 1)
        if (NONPAL.includes(two)) i -= 2
        else if (NONPAL.includes(ch)) i--
        else return false
        break
      }
      default:
        if (ch !== p) return false
        i--
    }
  }
  return true
}

/** Letter-to-sound rules only: phoneme ids, no stress. Letters without a rule are skipped. */
export function letterToSound(word: string): string[] {
  const w = word.toUpperCase().replace(/[^A-Z']/g, '')
  const out: string[] = []
  let pos = 0
  while (pos < w.length) {
    const rules = RULES[w[pos]!]
    let matched = false
    if (rules) {
      for (const [left, match, right, phones] of rules) {
        if (!w.startsWith(match, pos)) continue
        if (!matchLeft(w, pos, left) || !matchRight(w, pos + match.length, right)) continue
        if (phones) out.push(...phones.split(' '))
        pos += match.length
        matched = true
        break
      }
    }
    if (!matched) pos++
  }
  // Non-rhotic clean-up: r only before a vowel
  return out.filter((id, i) => id !== 'r' || isVowel(out[i + 1] ?? ''))
}

const STRESS_BEFORE = /(tion|sion|cian|ic|ical|ity|ify|ian|ious|eous|ial|ually)$/
const UNSTRESSED_PREFIX = /^(a|be|de|re|con|com|ex|pre|pro|in|un|en|em)(?=[a-z]{3,})/

/** Assign primary stress by simple English heuristics; reduced vowels stay unstressed. */
export function assignStress(word: string, ids: readonly string[]): Pronunciation {
  const vowelIdx = ids.flatMap((id, i) => (isVowel(id) ? [i] : []))
  let primary = -1
  if (vowelIdx.length === 1) primary = vowelIdx[0]!
  else if (vowelIdx.length > 1) {
    const lw = word.toLowerCase()
    const full = vowelIdx.filter((i) => ids[i] !== 'ə' && ids[i] !== 'i')
    if (STRESS_BEFORE.test(lw) && vowelIdx.length >= 2) {
      // the syllable before the suffix's vowel: penultimate for -tion/-ic, antepenultimate for -ity
      const back = /(ity|ical|ify|ually)$/.test(lw) ? 3 : 2
      primary = vowelIdx[Math.max(0, vowelIdx.length - back)]!
    } else if (UNSTRESSED_PREFIX.test(lw) && vowelIdx.length >= 2) {
      primary = vowelIdx[1]!
    } else {
      primary = full[0] ?? vowelIdx[0]!
    }
  }
  return ids.map((id, i): Phone => {
    if (!isVowel(id)) return { id }
    const stress: Stress = i === primary ? 1 : 0
    return { id, stress }
  })
}

export function rulesPronunciation(word: string): Pronunciation {
  return assignStress(word, letterToSound(word))
}

// ---------------------------------------------------------------------------------------------
// Morphological fallback

const SIBILANT_IDS = new Set(['s', 'z', 'ʃ', 'ʒ', 'tʃ', 'dʒ'])
const VOICELESS_IDS = new Set(['p', 't', 'k', 'f', 'θ', 's', 'ʃ', 'tʃ', 'h'])

/** -s / -'s: /ɪz/ after sibilants, /s/ after voiceless, /z/ elsewhere. */
export function addPlural(base: Pronunciation): Pronunciation {
  const last = base[base.length - 1]?.id ?? ''
  if (SIBILANT_IDS.has(last)) return [...base, { id: 'ɪ', stress: 0 }, { id: 'z' }]
  return [...base, { id: VOICELESS_IDS.has(last) ? 's' : 'z' }]
}

/** -ed: /ɪd/ after t and d, /t/ after voiceless, /d/ elsewhere. */
export function addPast(base: Pronunciation): Pronunciation {
  const last = base[base.length - 1]?.id ?? ''
  if (last === 't' || last === 'd') return [...base, { id: 'ɪ', stress: 0 }, { id: 'd' }]
  return [...base, { id: VOICELESS_IDS.has(last) ? 't' : 'd' }]
}

const SUFFIX_PHONES: [suffix: string, phones: string][] = [
  ['ness', 'n ə s'],
  ['less', 'l ə s'],
  ['ment', 'm ə n t'],
  ['ful', 'f ʊ l'],
  ['able', 'ə b ə l'],
  ['ly', 'l i'],
  ['est', 'ɪ s t'],
  ['er', 'ə'],
  ['ing', 'ɪ ŋ'],
  ['ish', 'ɪ ʃ'],
]

function phonesOf(text: string): Pronunciation {
  return text.split(' ').map((id) => (isVowel(id) ? { id, stress: 0 as Stress } : { id }))
}

/** Candidate spellings of a stem after removing a suffix (make → making, stop → stopped, happy → happily). */
function stems(stem: string): string[] {
  const out = [stem]
  if (/([b-df-hj-np-tv-z])\1$/.test(stem)) out.push(stem.slice(0, -1))
  out.push(stem + 'e')
  if (stem.endsWith('i')) out.push(stem.slice(0, -1) + 'y')
  return out
}

/**
 * Pronounce an unknown word from known parts: regular inflections, derivational suffixes, or a
 * compound of two dictionary words. Returns null when nothing fits.
 */
export function morphologicalPronunciation(word: string, lexicon: Lexicon): Pronunciation | null {
  const w = word.toLowerCase()
  const first = (s: string) => lexicon.lookup(s)[0]?.pron

  if (w.endsWith("'s") && w.length > 2) {
    const base = first(w.slice(0, -2))
    if (base) return addPlural(base)
  }
  if (w.endsWith('s') && w.length > 3) {
    for (const stem of [w.slice(0, -1), w.endsWith('es') ? w.slice(0, -2) : '', w.endsWith('ies') ? w.slice(0, -3) + 'y' : '']) {
      const base = stem && first(stem)
      if (base) return addPlural(base)
    }
  }
  if (w.endsWith('ed') && w.length > 4) {
    for (const stem of stems(w.slice(0, -2))) {
      const base = first(stem)
      if (base) return addPast(base)
    }
  }
  for (const [suffix, phones] of SUFFIX_PHONES) {
    if (!w.endsWith(suffix) || w.length < suffix.length + 3) continue
    for (const stem of stems(w.slice(0, -suffix.length))) {
      const base = first(stem)
      if (base) return [...base, ...phonesOf(phones)]
    }
  }
  // Compound: longest known first part, known remainder (both at least three letters)
  for (let cut = w.length - 3; cut >= 3; cut--) {
    const a = first(w.slice(0, cut))
    const b = a && first(w.slice(cut))
    if (a && b) {
      // compounds stress the first element; the second keeps only secondary stress
      return [...a, ...b.map((p) => (p.stress === 1 ? { ...p, stress: 2 as Stress } : p))]
    }
  }
  return null
}
