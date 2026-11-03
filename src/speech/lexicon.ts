/**
 * Pronunciation lexicons.
 *
 * - Britfone (MIT, Jose Llarena): ~16,000 British English (SSB/RP) words in IPA with primary and
 *   secondary stress. Used first, so common words get a native British pronunciation.
 * - CMU Pronouncing Dictionary (BSD-style, Carnegie Mellon; packaged by `cmu-pronouncing-dictionary`,
 *   ISC): ~134,000 American English words in ARPAbet. Used for words Britfone lacks, converted to
 *   British by `cmuToBritish` (non-rhotic r, centring diphthongs, LOT/THOUGHT, BATH, GOAT, yod).
 *
 * Both are converted into the inventory in `phonemes.ts`, so nothing downstream depends on either
 * dictionary's notation. A lexicon is plain data handed in by a loader (`lexicon-loader.ts` in the
 * browser, `scripts/speech/lexicon-node.ts` in Node), so tests and scripts can build their own.
 */
import { isVowel, type Phone, type Pronunciation, type Stress } from './phonemes'

export type LexiconSource = 'britfone' | 'cmudict' | 'custom'

export interface LexiconEntry {
  pron: Pronunciation
  source: LexiconSource
}

export interface Lexicon {
  /** Every known pronunciation of a word (lower case), preferred first; empty if unknown. */
  lookup(word: string): LexiconEntry[]
  has(word: string): boolean
  /** Number of headwords per source, for diagnostics. */
  stats(): Record<LexiconSource, number>
}

// ---------------------------------------------------------------------------------------------
// Britfone

/** Britfone's IPA spelling → ours (it writes STRUT as ɐ, DRESS as ɛ, r as ɹ). */
const BRITFONE_SYMBOLS: Record<string, string> = { ɐ: 'ʌ', ɛ: 'e', ɛə: 'eə', ɹ: 'r' }

export function parseBritfonePronunciation(ipa: string): Pronunciation {
  return ipa
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok): Phone => {
      let stress: Stress = 0
      let sym = tok
      if (sym.startsWith('ˈ')) {
        stress = 1
        sym = sym.slice(1)
      } else if (sym.startsWith('ˌ')) {
        stress = 2
        sym = sym.slice(1)
      }
      const id = BRITFONE_SYMBOLS[sym] ?? sym
      if (isVowel(id)) return { id, stress }
      return { id }
    })
}

/** Parse britfone.main.csv ("RALEIGH(2), ɹ ˈɔː l i"). Multi-word entries (with _) are skipped. */
export function parseBritfone(csv: string): Map<string, Pronunciation[]> {
  const out = new Map<string, Pronunciation[]>()
  for (const line of csv.split(/\r?\n/)) {
    const comma = line.indexOf(',')
    if (comma <= 0) continue
    const head = line.slice(0, comma).trim()
    if (head.includes('_')) continue
    const word = head.replace(/\(\d+\)$/, '').toLowerCase()
    const pron = parseBritfonePronunciation(line.slice(comma + 1))
    if (pron.length === 0) continue
    const list = out.get(word)
    if (list) list.push(pron)
    else out.set(word, [pron])
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// CMUdict (ARPAbet, General American) → SSB

const ARPA_CONSONANTS: Record<string, string> = {
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'g', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm',
  N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j',
  Z: 'z', ZH: 'ʒ',
}

const ARPA_VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
])

/** Vowel + non-prevocalic R → the British vowel that replaces both (r is not pronounced). */
const BEFORE_R: Record<string, string[]> = {
  IH: ['ɪə'], IY: ['ɪə'], EH: ['eə'], EY: ['eə'], AE: ['eə'], UH: ['ʊə'], UW: ['ʊə'],
  AO: ['ɔː'], OW: ['ɔː'], AA: ['ɑː'], AH: ['ɜː'], AY: ['aɪ', 'ə'], AW: ['aʊ', 'ə'],
  OY: ['ɔɪ', 'ə'],
}

const BATH_SS_WORDS = /^(pass|class|glass|grass|brass)/

interface ArpaTok {
  base: string
  stress?: Stress
}

function splitArpa(arpa: string): ArpaTok[] {
  return arpa
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const m = /^([A-Z]+)([012])?$/.exec(t)
      if (!m) throw new Error(`Bad ARPAbet token ${t}`)
      return m[2] !== undefined
        ? { base: m[1]!, stress: Number(m[2]) as Stress }
        : { base: m[1]! }
    })
}

const isArpaVowel = (t: ArpaTok | undefined) => !!t && ARPA_VOWELS.has(t.base)

/**
 * Convert a General American CMUdict pronunciation into Standard Southern British.
 * The spelling is used where ARPAbet merges sets that British keeps apart (AA = LOT and PALM,
 * AO = THOUGHT and CLOTH, AE = TRAP and BATH). These are heuristics: Britfone covers the common
 * words where the exceptions live.
 */
export function cmuToBritish(word: string, arpa: string): Pronunciation {
  const toks = splitArpa(arpa)
  const w = word.toLowerCase()
  const out: Phone[] = []
  const lotSpelling = /o/.test(w) || /(w|qu)a/.test(w)
  const thoughtSpelling = !/o/.test(w) || /(au|aw|ough|oar|oor|our|or|ore|oa)/.test(w)

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!
    const next = toks[i + 1]
    const after = toks[i + 2]
    const stress = t.stress ?? 0

    if (!ARPA_VOWELS.has(t.base)) {
      if (t.base === 'R' && !isArpaVowel(next)) continue // non-rhotic: r only before a vowel
      const id = ARPA_CONSONANTS[t.base]
      if (!id) throw new Error(`Unknown ARPAbet consonant ${t.base}`)
      // Yod: RP keeps /j/ in tune, new, duke (CMU: T UW1 N)
      if (
        (id === 't' || id === 'd' || id === 'n') &&
        next?.base === 'UW' &&
        /(ew|eu|u[^aeiou]e|ue|u[^aeiou]i)/.test(w) &&
        !/oo|ou/.test(w)
      ) {
        out.push({ id }, { id: 'j' })
        continue
      }
      out.push({ id })
      continue
    }

    // Vowel followed by an R that is not itself followed by a vowel: centring diphthong / long vowel
    if (next?.base === 'R' && !isArpaVowel(after) && t.base !== 'ER') {
      const ids = BEFORE_R[t.base] ?? ['ɜː']
      ids.forEach((id, k) => out.push({ id, stress: k === 0 ? stress : 0 }))
      i++ // swallow R
      continue
    }

    let id: string
    switch (t.base) {
      case 'AA':
        id = lotSpelling ? 'ɒ' : 'ɑː'
        break
      case 'AO':
        id = next?.base === 'R' || thoughtSpelling ? 'ɔː' : 'ɒ'
        break
      case 'AE': {
        const n1 = next?.base
        const n2 = after?.base
        const bath =
          stress === 1 &&
          (((n1 === 'F' || n1 === 'TH') && !isArpaVowel(after)) ||
            (n1 === 'S' && (n2 === 'T' || n2 === 'K' || n2 === 'P')) ||
            (n1 === 'N' && (n2 === 'S' || n2 === 'CH')) ||
            (n1 === 'S' && BATH_SS_WORDS.test(w)))
        id = bath ? 'ɑː' : 'æ'
        break
      }
      case 'AH':
        id = stress === 0 ? 'ə' : 'ʌ'
        break
      case 'AW': id = 'aʊ'; break
      case 'AY': id = 'aɪ'; break
      case 'EH': id = 'e'; break
      case 'ER': id = stress === 0 ? 'ə' : 'ɜː'; break
      case 'EY': id = 'eɪ'; break
      case 'IH': id = 'ɪ'; break
      case 'IY':
        id = stress === 0 && (!next || isArpaVowel(next)) ? 'i' : 'iː'
        break
      case 'OW': id = 'əʊ'; break
      case 'OY': id = 'ɔɪ'; break
      case 'UH': id = 'ʊ'; break
      case 'UW': id = 'uː'; break
      default:
        throw new Error(`Unhandled ARPAbet vowel ${t.base}`)
    }
    out.push({ id, stress: id === 'ə' || id === 'i' ? 0 : stress })
    // ER before a vowel keeps its r ("referring")
    if (t.base === 'ER' && isArpaVowel(next)) out.push({ id: 'r' })
  }
  return out
}

/** CMUdict's own key format: "word", "word(2)", … */
function cmuVariants(dict: Readonly<Record<string, string>>, word: string): string[] {
  const out: string[] = []
  const first = dict[word]
  if (first === undefined) return out
  out.push(first)
  for (let n = 2; n < 10; n++) {
    const alt = dict[`${word}(${n})`]
    if (alt === undefined) break
    out.push(alt)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Combined lexicon

export interface LexiconData {
  /** britfone.main.csv text */
  britfone?: string
  /** the `dictionary` object exported by cmu-pronouncing-dictionary */
  cmu?: Readonly<Record<string, string>>
  /** Extra entries in our IPA notation ("ˈ" / "ˌ" before stressed vowels); win over both. */
  custom?: Record<string, Pronunciation[]>
}

export function createLexicon(data: LexiconData): Lexicon {
  const brit = data.britfone ? parseBritfone(data.britfone) : new Map<string, Pronunciation[]>()
  const cmu = data.cmu
  const custom = new Map(Object.entries(data.custom ?? {}))
  const cmuCache = new Map<string, LexiconEntry[]>()

  function fromCmu(word: string): LexiconEntry[] {
    if (!cmu) return []
    const hit = cmuCache.get(word)
    if (hit) return hit
    const entries: LexiconEntry[] = []
    const seen = new Set<string>()
    for (const arpa of cmuVariants(cmu, word)) {
      try {
        const pron = cmuToBritish(word, arpa)
        const key = pron.map((p) => p.id + (p.stress ?? '')).join(' ')
        if (seen.has(key)) continue // US variants often collapse in British
        seen.add(key)
        entries.push({ pron, source: 'cmudict' })
      } catch {
        // malformed entry: skip it
      }
    }
    cmuCache.set(word, entries)
    return entries
  }

  return {
    lookup(raw) {
      const word = raw.toLowerCase()
      const c = custom.get(word)
      if (c) return c.map((pron) => ({ pron, source: 'custom' as const }))
      const b = brit.get(word)
      if (b) return b.map((pron) => ({ pron, source: 'britfone' as const }))
      return fromCmu(word)
    },
    has(raw) {
      const word = raw.toLowerCase()
      return custom.has(word) || brit.has(word) || (!!cmu && cmu[word] !== undefined)
    },
    stats() {
      let cmuWords = 0
      if (cmu) for (const k in cmu) if (!k.endsWith(')')) cmuWords++
      return { britfone: brit.size, cmudict: cmuWords, custom: custom.size }
    },
  }
}

export const EMPTY_LEXICON: Lexicon = createLexicon({})

/** True when the pronunciation has a vowel with primary stress. */
export function hasPrimaryStress(pron: readonly Phone[]): boolean {
  return pron.some((p) => isVowel(p.id) && p.stress === 1)
}
