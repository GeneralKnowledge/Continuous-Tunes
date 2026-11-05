/**
 * Text normalisation and segmentation: ordinary text → sentences → phrases → word tokens.
 *
 * Numbers, dates (British day/month order), times, money, percentages, ordinals, abbreviations,
 * initialisms and symbols become words. Punctuation becomes prosodic boundaries. `*word*` marks
 * emphasis. Nothing here knows about phonemes except the letter names used to spell initialisms.
 */
import { cardinal, clock, date, decimal, digits, MONTHS, money, ordinal, year } from './numbers'

export type SentenceType = 'statement' | 'question' | 'exclamation'
/** Strength of the boundary after a phrase: comma < colon/semicolon/dash < sentence end. */
export type Boundary = 'comma' | 'clause' | 'sentence'

export interface WordToken {
  /** Lower-case spelling used for lexicon lookup ("doctor", "b"). */
  text: string
  /** The source text this word came from ("Dr.", "BBC", "£5"). */
  source: string
  /** Pronunciation override in our IPA notation (letter names of an initialism). */
  pron?: string
  emphasis?: boolean
}

export interface PhraseText {
  words: WordToken[]
  boundary: Boundary
}

export interface SentenceText {
  text: string
  type: SentenceType
  phrases: PhraseText[]
}

/** Letter names, for spelling initialisms (BBC, UK). */
export const LETTER_NAMES: Record<string, string> = {
  a: 'ˈeɪ', b: 'b ˈiː', c: 's ˈiː', d: 'd ˈiː', e: 'ˈiː', f: 'ˈe f', g: 'dʒ ˈiː', h: 'ˈeɪ tʃ',
  i: 'ˈaɪ', j: 'dʒ ˈeɪ', k: 'k ˈeɪ', l: 'ˈe l', m: 'ˈe m', n: 'ˈe n', o: 'ˈəʊ', p: 'p ˈiː',
  q: 'k j ˈuː', r: 'ˈɑː', s: 'ˈe s', t: 't ˈiː', u: 'j ˈuː', v: 'v ˈiː',
  w: 'd ˈʌ b ə l j uː', x: 'ˈe k s', y: 'w ˈaɪ', z: 'z ˈe d',
}

const ABBREVIATIONS: Record<string, string> = {
  mr: 'mister', mrs: 'missus', ms: 'miz', dr: 'doctor', prof: 'professor', st: 'saint',
  rd: 'road', ave: 'avenue', mt: 'mount', no: 'number', vs: 'versus', etc: 'et cetera',
  approx: 'approximately', dept: 'department', jan: 'january', feb: 'february', mar: 'march',
  apr: 'april', jun: 'june', jul: 'july', aug: 'august', sep: 'september', sept: 'september',
  oct: 'october', nov: 'november', dec: 'december',
}
/** Abbreviations only expanded when written with a full stop (so "no" and "mar" stay words). */
const NEEDS_DOT = new Set(['no', 'st', 'rd', 'mt', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'ave', 'dept'])

const DOTTED: Record<string, string> = { 'e.g.': 'for example', 'i.e.': 'that is', 'a.m.': 'a m', 'p.m.': 'p m' }

const SYMBOLS: Record<string, string> = {
  '&': 'and', '%': 'percent', '+': 'plus', '=': 'equals', '@': 'at', '#': 'number', '/': 'slash',
  '°': 'degrees',
}

const UNITS: Record<string, [string, string]> = {
  km: ['kilometre', 'kilometres'], m: ['metre', 'metres'], cm: ['centimetre', 'centimetres'],
  mm: ['millimetre', 'millimetres'], kg: ['kilogram', 'kilograms'], g: ['gram', 'grams'],
  mph: ['mile per hour', 'miles per hour'], kph: ['kilometre per hour', 'kilometres per hour'],
  ms: ['millisecond', 'milliseconds'], hz: ['hertz', 'hertz'], khz: ['kilohertz', 'kilohertz'],
}

/** Always spelled, even when the lower-case form is a word ("US", "IT" stays a word). */
const INITIALISMS = new Set(['us', 'uk', 'eu', 'un', 'ai', 'tv', 'pc', 'bbc', 'nhs', 'usa', 'cd', 'dj', 'id'])

const WH_WORDS = new Set(['what', 'where', 'when', 'why', 'who', 'whom', 'whose', 'which', 'how'])

type Raw =
  | { kind: 'word'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'punct'; text: string }
  | { kind: 'star' }
  | { kind: 'expanded'; words: string; source: string }

/** A minus sign only where it cannot be a hyphen or a range dash ("COVID-19", "5-10"). */
const MINUS = String.raw`(?:(?<![\w)])-)?`

// One alternation; earlier alternatives win
const TOKEN_RE = new RegExp(
  [
    String.raw`(?<iso>\d{4}-\d{2}-\d{2})`,
    String.raw`(?<dmy>\d{1,2}/\d{1,2}/\d{2,4})`,
    String.raw`(?<frac>(?<![\d/])\d{1,2}/\d{1,2}(?![\d/]))`,
    String.raw`(?<time>\d{1,2}:\d{2}(?:\s?(?:am|pm|a\.m\.|p\.m\.))?)`,
    String.raw`(?<ratio>\d{1,2}:\d(?!\d))`,
    String.raw`(?<money>[£$€]\d[\d,]*(?:\.\d+)?(?:\s?(?:m|bn|k|million|billion)\b)?)`,
    String.raw`(?<percent>${MINUS}\d[\d,]*(?:\.\d+)?%)`,
    String.raw`(?<decade>'?\d{1,3}0s\b)`,
    String.raw`(?<ord>\d+(?:st|nd|rd|th)\b)`,
    String.raw`(?<unit>\d+(?:\.\d+)?\s?(?:km|cm|mm|kg|mph|kph|khz|hz|ms|m|g)\b)`,
    String.raw`(?<num>${MINUS}\d+(?:,\d{3})*(?:\.\d+)?)`,
    String.raw`(?<dotted>(?:[A-Za-z]\.){2,})`,
    String.raw`(?<word>[A-Za-z]+(?:'[A-Za-z]+)*)`,
    String.raw`(?<star>\*)`,
    String.raw`(?<punct>\.\.\.|[.,!?;:()"—-])`,
    String.raw`(?<sym>[&%+=@#/°])`,
  ].join('|'),
  'g',
)

const VULGAR: Record<string, string> = {
  '½': 'a half', '⅓': 'a third', '⅔': 'two thirds', '¼': 'a quarter', '¾': 'three quarters',
  '⅕': 'a fifth', '⅛': 'an eighth', '⅜': 'three eighths', '⅝': 'five eighths', '⅞': 'seven eighths',
}

/** Any Unicode decimal digit (Arabic-Indic, Devanagari, full-width …) as an ASCII digit. */
function asciiDigits(text: string): string {
  return text.replace(/\P{ASCII}/gu, (ch) => {
    if (!/\p{Nd}/u.test(ch)) return ch
    // decimal digits come in runs of ten starting at zero (some runs follow one another)
    const cp = ch.codePointAt(0)!
    let start = cp
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--
    return String((cp - start) % 10)
  })
}

function cleanText(text: string): string {
  return asciiDigits(text)
    .replace(/(\d)\s?([½⅓⅔¼¾⅕⅛⅜⅝⅞])/g, (_, d: string, f: string) => `${d} and ${VULGAR[f]}`)
    .replace(/[½⅓⅔¼¾⅕⅛⅜⅝⅞]/g, (f) => ` ${VULGAR[f]} `)
    .replace(/²/g, ' squared ')
    .replace(/³/g, ' cubed ')
    .replace(/(\d)\s?[–―]\s?(?=\d)/g, '$1-')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–―]/g, '—')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "ninety" → "nineties", "six" → "sixes", "hundred" → "hundreds", "half" → "halves" */
function plural(word: string): string {
  if (word === 'half') return 'halves'
  if (word.endsWith('y')) return word.slice(0, -1) + 'ies'
  if (word.endsWith('x')) return word + 'es'
  return word + 's'
}

function expandNumberish(groups: Record<string, string | undefined>): string | null {
  if (groups.iso) {
    const [y, m, d] = groups.iso.split('-').map(Number) as [number, number, number]
    return date(d, m, y)
  }
  if (groups.dmy) {
    const [d, m, yRaw] = groups.dmy.split('/') as [string, string, string]
    const y = Number(yRaw.length === 2 ? `20${yRaw}` : yRaw)
    return date(Number(d), Number(m), y)
  }
  if (groups.frac) {
    const [a, b] = groups.frac.split('/').map(Number) as [number, number]
    if (a >= 1 && b >= 2 && a < b && b <= 16) {
      const unit = b === 2 ? 'half' : b === 4 ? 'quarter' : ordinal(b)
      return `${cardinal(a)} ${a === 1 ? unit : plural(unit)}`
    }
    return `${cardinal(a)} ${a === 24 && b === 7 ? '' : 'slash '}${cardinal(b)}`
  }
  if (groups.ratio) {
    const [a, b] = groups.ratio.split(':').map(Number) as [number, number]
    return `${cardinal(a)} to ${cardinal(b)}`
  }
  if (groups.decade) {
    const d = groups.decade.replace(/\D/g, '')
    const n = Number(d)
    const words = d.length === 4 ? year(n) : cardinal(n)
    return words.replace(/[a-z]+$/, plural)
  }
  if (groups.time) {
    const m = /^(\d{1,2}):(\d{2})\s?(am|pm|a\.m\.|p\.m\.)?$/.exec(groups.time)!
    const t = clock(Number(m[1]), Number(m[2]))
    const suffix = m[3] ? (m[3].startsWith('a') ? ' a m' : ' p m') : ''
    return (m[3] && m[2] === '00' ? cardinal(Number(m[1])) : t) + suffix
  }
  if (groups.money) {
    const m = /^([£$€])([\d,]+(?:\.\d+)?)\s?(m|bn|k|million|billion)?$/.exec(groups.money)!
    const scale = m[3]
    if (scale) {
      const name = scale === 'k' ? 'thousand' : scale === 'm' || scale === 'million' ? 'million' : 'billion'
      const unit = m[1] === '£' ? 'pounds' : m[1] === '$' ? 'dollars' : 'euros'
      return `${decimal(m[2]!)} ${name} ${unit}`
    }
    return money(m[1]!, m[2]!)
  }
  if (groups.percent) return `${decimal(groups.percent.slice(0, -1))} percent`
  if (groups.ord) return ordinal(Number(groups.ord.replace(/\D/g, '')))
  if (groups.unit) {
    const m = /^(\d+(?:\.\d+)?)\s?([a-z]+)$/i.exec(groups.unit)!
    const [one, many] = UNITS[m[2]!.toLowerCase()]!
    return `${decimal(m[1]!)} ${m[1] === '1' ? one : many}`
  }
  return null
}

function tokenize(text: string): Raw[] {
  const out: Raw[] = []
  for (const match of text.matchAll(TOKEN_RE)) {
    const g = match.groups ?? {}
    const expanded = expandNumberish(g)
    if (expanded !== null) out.push({ kind: 'expanded', words: expanded, source: match[0] })
    else if (g.num) out.push({ kind: 'number', text: g.num })
    else if (g.dotted) {
      const lower = g.dotted.toLowerCase()
      const words = DOTTED[lower] ?? lower.replace(/\./g, ' ').trim()
      out.push({ kind: 'expanded', words, source: g.dotted })
    } else if (g.word) out.push({ kind: 'word', text: g.word })
    else if (g.star) out.push({ kind: 'star' })
    else if (g.punct) out.push({ kind: 'punct', text: g.punct })
    else if (g.sym) out.push({ kind: 'expanded', words: SYMBOLS[g.sym]!, source: g.sym })
  }
  return out
}

const isNumeric = (r: Raw | undefined) =>
  r?.kind === 'number' || (r?.kind === 'expanded' && /\d/.test(r.source) && !/[/:]/.test(r.source))
const isDash = (r: Raw | undefined) => r?.kind === 'punct' && r.text === '-'

/** Read a bare number in context: years, dates with a month word, digit strings. */
function readNumber(text: string, prev: Raw | undefined, next: Raw | undefined): string {
  const clean = text.replace(/,/g, '')
  const isMonth = (r: Raw | undefined) => r?.kind === 'word' && MONTHS.includes(r.text.toLowerCase())
  const n = Number(clean)
  if (/^\d{1,2}$/.test(clean) && isMonth(next) && n >= 1 && n <= 31) return `the ${ordinal(n)} of`
  if (/^\d{1,2}$/.test(clean) && isMonth(prev) && n >= 1 && n <= 31) return `the ${ordinal(n)}`
  if (/^\d{4}$/.test(clean) && !text.includes(',') && n >= 1100 && n < 2100) return year(n)
  if (/^0\d+$/.test(clean) || (/^\d{7,}$/.test(clean) && !text.includes(','))) return digits(clean)
  if (clean.includes('.') || clean.startsWith('-')) return decimal(clean)
  return cardinal(n)
}

function wordsFor(text: string, source: string, emphasis: boolean): WordToken[] {
  return text
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => ({ text: w.toLowerCase(), source, ...(emphasis ? { emphasis } : {}) }))
}

export interface NormalizeOptions {
  /** True if the word is in a lexicon; used to decide whether capitals are an initialism. */
  isKnownWord?: (word: string) => boolean
}

function spellOrWord(
  word: string,
  emphasis: boolean,
  opts: NormalizeOptions,
): WordToken[] {
  const lower = word.toLowerCase()
  const allCaps = word.length >= 2 && word.length <= 5 && word === word.toUpperCase()
  const known = opts.isKnownWord?.(lower) ?? true
  const spell =
    allCaps && lower !== 'ok' && (INITIALISMS.has(lower) || !/[aeiouy]/.test(lower) || !known)
  if (spell) {
    return [...lower].map((ch) => ({
      text: ch,
      source: word,
      pron: LETTER_NAMES[ch]!,
      ...(emphasis ? { emphasis } : {}),
    }))
  }
  if (lower === 'ok') return wordsFor('okay', word, emphasis)
  return [{ text: lower, source: word, ...(emphasis ? { emphasis } : {}) }]
}

/** Split text into sentences, phrases and normalised word tokens. */
export function normalizeText(input: string, opts: NormalizeOptions = {}): SentenceText[] {
  const raws = tokenize(cleanText(input))
  const sentences: SentenceText[] = []
  let phrases: PhraseText[] = []
  let words: WordToken[] = []
  let sourceParts: string[] = []
  let emphasis = false

  const closePhrase = (boundary: Boundary) => {
    if (words.length) phrases.push({ words, boundary })
    else if (phrases.length && boundary !== 'comma') {
      // punctuation with no words after it strengthens the previous boundary
      const last = phrases[phrases.length - 1]!
      if (boundary === 'sentence' || last.boundary === 'comma') last.boundary = boundary
    }
    words = []
  }
  const closeSentence = (type: SentenceType) => {
    closePhrase('sentence')
    if (phrases.length) {
      phrases[phrases.length - 1]!.boundary = 'sentence'
      sentences.push({ text: sourceParts.join(' '), type, phrases })
    }
    phrases = []
    sourceParts = []
  }

  for (let i = 0; i < raws.length; i++) {
    const r = raws[i]!
    switch (r.kind) {
      case 'star':
        emphasis = !emphasis
        break
      case 'expanded':
        sourceParts.push(r.source)
        words.push(...wordsFor(r.words, r.source, emphasis))
        break
      case 'number': {
        sourceParts.push(r.text)
        // a group in a dashed chain (phone and reference numbers) is read digit by digit
        const chain = (isDash(raws[i - 1]) && (isDash(raws[i + 1]) || isDash(raws[i - 3]))) || (isDash(raws[i + 1]) && isDash(raws[i + 3]))
        const said = chain && /^\d+$/.test(r.text) ? digits(r.text) : readNumber(r.text, raws[i - 1], raws[i + 1])
        words.push(...wordsFor(said, r.text, emphasis))
        break
      }
      case 'word': {
        sourceParts.push(r.text)
        const lower = r.text.toLowerCase()
        const next = raws[i + 1]
        const dotted = next?.kind === 'punct' && next.text === '.'
        const abbr = ABBREVIATIONS[lower]
        const capital = r.text[0] !== r.text[0]!.toLowerCase()
        if (abbr && (NEEDS_DOT.has(lower) ? dotted && capital : true)) {
          // "St. Paul" (saint) vs "Baker St." (street): after a capitalised word, street
          const prev = raws[i - 1]
          const expansion =
            lower === 'st' && prev?.kind === 'word' && /^[A-Z]/.test(prev.text) ? 'street' : abbr
          words.push(...wordsFor(expansion, r.text, emphasis))
          if (dotted) i++ // the full stop belongs to the abbreviation
          break
        }
        words.push(...spellOrWord(r.text, emphasis, opts))
        break
      }
      case 'punct':
        switch (r.text) {
          case ',':
            closePhrase('comma')
            break
          case ';':
          case ':':
          case '—':
          case '(':
          case ')':
            closePhrase('clause')
            break
          case '-':
            // "5-10", "£5-10", "1990-1995": a dash between two numbers reads "to"; not in
            // chains such as phone numbers ("020-7946-0958")
            if (isNumeric(raws[i - 1]) && isNumeric(raws[i + 1]) && !isDash(raws[i - 2]) && !isDash(raws[i + 2])) {
              words.push(...wordsFor('to', '-', emphasis))
            }
            break
          case '"':
            break
          case '?':
            closeSentence('question')
            break
          case '!':
            closeSentence('exclamation')
            break
          default: // . and ...
            closeSentence('statement')
        }
        break
    }
  }
  closeSentence('statement')
  return sentences
}

/** Yes/no questions rise at the end; wh-questions fall like statements. */
export function isWhQuestion(sentence: SentenceText): boolean {
  const first = sentence.phrases[0]?.words[0]?.text
  return !!first && WH_WORDS.has(first)
}
