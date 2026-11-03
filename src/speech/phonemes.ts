/**
 * Phoneme inventory: Standard Southern British English (SSB, "RP"), written in IPA.
 *
 * This is the speech system's own phonetic alphabet. Lexicons (Britfone, CMUdict) and the
 * letter-to-sound rules are converted into it; synthesis backends read it. Nothing outside
 * the lexicon adapters knows ARPAbet or Britfone's spelling of a symbol.
 *
 * Features follow the usual articulatory description (IPA chart; Ladefoged & Johnson,
 * "A Course in Phonetics"), enough for syllabification, duration rules and backend targets.
 */

export type VowelHeight = 'close' | 'near-close' | 'close-mid' | 'mid' | 'open-mid' | 'open'
export type VowelBackness = 'front' | 'central' | 'back'
export type Place =
  | 'bilabial'
  | 'labiodental'
  | 'dental'
  | 'alveolar'
  | 'postalveolar'
  | 'palatal'
  | 'velar'
  | 'labial-velar'
  | 'glottal'
export type Manner = 'stop' | 'affricate' | 'fricative' | 'nasal' | 'approximant' | 'lateral'

export interface VowelInfo {
  kind: 'vowel'
  id: string
  height: VowelHeight
  backness: VowelBackness
  rounded: boolean
  long: boolean
  /** Diphthongs glide towards a second quality: the id of the monophthong it ends near. */
  glide?: string
  /** Reduced vowels (schwa, happY) never carry primary stress in the lexicons. */
  reduced?: boolean
  example: string
}

export interface ConsonantInfo {
  kind: 'consonant'
  id: string
  place: Place
  manner: Manner
  voiced: boolean
  example: string
}

export type PhonemeInfo = VowelInfo | ConsonantInfo

const v = (
  id: string,
  height: VowelHeight,
  backness: VowelBackness,
  rounded: boolean,
  long: boolean,
  example: string,
  extra: Partial<VowelInfo> = {},
): VowelInfo => ({ kind: 'vowel', id, height, backness, rounded, long, example, ...extra })

const c = (
  id: string,
  place: Place,
  manner: Manner,
  voiced: boolean,
  example: string,
): ConsonantInfo => ({ kind: 'consonant', id, place, manner, voiced, example })

export const PHONEMES: readonly PhonemeInfo[] = [
  // Monophthongs (Wells' lexical sets in the examples)
  v('iː', 'close', 'front', false, true, 'fleece'),
  v('ɪ', 'near-close', 'front', false, false, 'kit'),
  v('e', 'open-mid', 'front', false, false, 'dress'),
  v('æ', 'open', 'front', false, false, 'trap'),
  v('ʌ', 'open-mid', 'central', false, false, 'strut'),
  v('ɑː', 'open', 'back', false, true, 'bath, palm, start'),
  v('ɒ', 'open', 'back', true, false, 'lot'),
  v('ɔː', 'open-mid', 'back', true, true, 'thought, north, force'),
  v('ʊ', 'near-close', 'back', true, false, 'foot'),
  v('uː', 'close', 'back', true, true, 'goose'),
  v('ɜː', 'mid', 'central', false, true, 'nurse'),
  v('ə', 'mid', 'central', false, false, 'commA, lettER', { reduced: true }),
  v('i', 'close', 'front', false, false, 'happY', { reduced: true }),
  // Diphthongs
  v('eɪ', 'close-mid', 'front', false, true, 'face', { glide: 'ɪ' }),
  v('aɪ', 'open', 'central', false, true, 'price', { glide: 'ɪ' }),
  v('ɔɪ', 'open-mid', 'back', true, true, 'choice', { glide: 'ɪ' }),
  v('əʊ', 'mid', 'central', false, true, 'goat', { glide: 'ʊ' }),
  v('aʊ', 'open', 'central', false, true, 'mouth', { glide: 'ʊ' }),
  v('ɪə', 'near-close', 'front', false, true, 'near', { glide: 'ə' }),
  v('eə', 'open-mid', 'front', false, true, 'square', { glide: 'ə' }),
  v('ʊə', 'near-close', 'back', true, true, 'cure', { glide: 'ə' }),
  // Consonants
  c('p', 'bilabial', 'stop', false, 'pin'),
  c('b', 'bilabial', 'stop', true, 'bin'),
  c('t', 'alveolar', 'stop', false, 'tin'),
  c('d', 'alveolar', 'stop', true, 'din'),
  c('k', 'velar', 'stop', false, 'kin'),
  c('g', 'velar', 'stop', true, 'give'),
  c('tʃ', 'postalveolar', 'affricate', false, 'chin'),
  c('dʒ', 'postalveolar', 'affricate', true, 'gin'),
  c('f', 'labiodental', 'fricative', false, 'fin'),
  c('v', 'labiodental', 'fricative', true, 'vim'),
  c('θ', 'dental', 'fricative', false, 'thin'),
  c('ð', 'dental', 'fricative', true, 'this'),
  c('s', 'alveolar', 'fricative', false, 'sip'),
  c('z', 'alveolar', 'fricative', true, 'zip'),
  c('ʃ', 'postalveolar', 'fricative', false, 'ship'),
  c('ʒ', 'postalveolar', 'fricative', true, 'measure'),
  c('h', 'glottal', 'fricative', false, 'hat'),
  c('m', 'bilabial', 'nasal', true, 'map'),
  c('n', 'alveolar', 'nasal', true, 'nap'),
  c('ŋ', 'velar', 'nasal', true, 'sing'),
  c('l', 'alveolar', 'lateral', true, 'leg'),
  c('r', 'alveolar', 'approximant', true, 'red'),
  c('w', 'labial-velar', 'approximant', true, 'wet'),
  c('j', 'palatal', 'approximant', true, 'yet'),
]

const BY_ID = new Map(PHONEMES.map((p) => [p.id, p]))

export const PHONEME_IDS: readonly string[] = PHONEMES.map((p) => p.id)

export function phonemeInfo(id: string): PhonemeInfo {
  const info = BY_ID.get(id)
  if (!info) throw new Error(`Unknown phoneme: ${id}`)
  return info
}

export function isPhoneme(id: string): boolean {
  return BY_ID.has(id)
}

export function isVowel(id: string): boolean {
  return BY_ID.get(id)?.kind === 'vowel'
}

export function isConsonant(id: string): boolean {
  return BY_ID.get(id)?.kind === 'consonant'
}

export function isVoiced(id: string): boolean {
  const p = BY_ID.get(id)
  return p ? p.kind === 'vowel' || p.voiced : false
}

export function mannerOf(id: string): Manner | 'vowel' {
  const p = phonemeInfo(id)
  return p.kind === 'vowel' ? 'vowel' : p.manner
}

/** 0 = unstressed, 1 = primary, 2 = secondary (CMUdict's numbering). */
export type Stress = 0 | 1 | 2

/** A phoneme in a pronunciation. Stress is only meaningful on vowels. */
export interface Phone {
  id: string
  stress?: Stress
}

/** One pronunciation as a flat phone list. */
export type Pronunciation = Phone[]

/** "h ə l ˈəʊ" style rendering, stress marks before the vowel (Britfone's convention). */
export function formatPronunciation(pron: readonly Phone[]): string {
  return pron
    .map((p) => (p.stress === 1 ? 'ˈ' : p.stress === 2 ? 'ˌ' : '') + p.id)
    .join(' ')
}

/** Parse the format written by formatPronunciation. Throws on unknown symbols. */
export function parsePronunciation(text: string): Pronunciation {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      let stress: Stress | undefined
      let id = tok
      if (id.startsWith('ˈ')) {
        stress = 1
        id = id.slice(1)
      } else if (id.startsWith('ˌ')) {
        stress = 2
        id = id.slice(1)
      }
      if (!isPhoneme(id)) throw new Error(`Unknown phoneme "${id}" in "${text}"`)
      if (isVowel(id)) return { id, stress: stress ?? 0 }
      return { id }
    })
}
