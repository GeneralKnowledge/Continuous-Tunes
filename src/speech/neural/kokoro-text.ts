/**
 * Text → Kokoro input tokens, from our own front end (src/speech/linguistic.ts): its text
 * normalisation (numbers, money, dates, abbreviations), sentence types and phrase boundaries.
 * Each word is looked up in Kokoro's British English lexicon (misaki notation, from the sherpa-onnx
 * kokoro-multi-lang-v1_0 release); a word it lacks takes our own pronunciation, mapped from our
 * phone set to misaki's symbols. No eSpeak is needed.
 */
import type { Utterance } from '../linguistic'
import type { Phone } from '../phonemes'

/** our phone ids → misaki (British) symbols */
const MISAKI: Record<string, string> = {
  iː: 'iː', ɪ: 'ɪ', e: 'ɛ', æ: 'a', ʌ: 'ʌ', ɑː: 'ɑː', ɒ: 'ɒ', ɔː: 'ɔː', ʊ: 'ʊ', uː: 'uː', ɜː: 'ɜː', ə: 'ə', i: 'i',
  eɪ: 'A', aɪ: 'I', ɔɪ: 'Y', əʊ: 'Q', aʊ: 'W', ɪə: 'ɪə', eə: 'ɛː', ʊə: 'ʊə',
  p: 'p', b: 'b', t: 't', d: 'd', k: 'k', g: 'ɡ', tʃ: 'ʧ', dʒ: 'ʤ', f: 'f', v: 'v', θ: 'θ', ð: 'ð', s: 's', z: 'z',
  ʃ: 'ʃ', ʒ: 'ʒ', h: 'h', m: 'm', n: 'n', ŋ: 'ŋ', l: 'l', r: 'ɹ', w: 'w', j: 'j',
}

export function misakiFromPhones(phones: readonly Phone[]): string {
  return phones.map((p) => (p.stress === 1 ? 'ˈ' : p.stress === 2 ? 'ˌ' : '') + (MISAKI[p.id] ?? '')).join('')
}

export interface KokoroVocab {
  /** symbol → token id (tokens.txt) */
  tokens: Map<string, number>
  /** lower-case word → misaki symbols, without spaces */
  lexicon: Map<string, string>
}

/** Parse tokens.txt ("symbol id" per line; the space symbol's line starts with a space). */
export function parseTokens(text: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const line of text.split('\n')) {
    if (!line) continue
    const i = line.lastIndexOf(' ')
    m.set(i === 0 ? ' ' : line.slice(0, i), Number(line.slice(i + 1)))
  }
  return m
}

/** Parse lexicon-gb-en.txt ("word s y m b o l s" per line); the first entry of a word wins. */
export function parseLexicon(text: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of text.split('\n')) {
    const sp = line.indexOf(' ')
    if (sp <= 0) continue
    const w = line.slice(0, sp)
    if (!m.has(w)) m.set(w, line.slice(sp + 1).replace(/ /g, ''))
  }
  return m
}

const END: Record<string, string> = { statement: '.', question: '?', exclamation: '!' }

/** The misaki phoneme string for an utterance, punctuated by its phrase boundaries. */
export function kokoroPhonemes(utt: Utterance, lexicon: Map<string, string>): string {
  const out: string[] = []
  for (const s of utt.sentences) {
    s.phrases.forEach((ph, pi) => {
      const words = ph.words.map((w) => lexicon.get(w.text.toLowerCase()) ?? misakiFromPhones(w.phones)).filter(Boolean)
      if (!words.length) return
      const last = pi === s.phrases.length - 1
      const mark = last ? (END[s.type] ?? '.') : ph.boundary === 'clause' ? ';' : ','
      out.push(words.join(' ') + mark)
    })
  }
  return out.join(' ')
}

/** Token ids for a phoneme string; symbols outside the vocabulary are dropped. */
export function kokoroTokens(phonemes: string, tokens: Map<string, number>): number[] {
  const ids: number[] = []
  for (const ch of phonemes) {
    const id = tokens.get(ch)
    if (id !== undefined) ids.push(id)
  }
  return ids
}
