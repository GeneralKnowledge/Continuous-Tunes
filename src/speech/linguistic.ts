/**
 * Linguistic front end: text → Utterance (sentences, phrases, words, syllables, phones, stress).
 *
 * The Utterance is the structured speech representation the prosody engine reads. It records where
 * each pronunciation came from, and every alternative the lexicon had, so diagnostics can show the
 * choice and later work (M3, contextual pronunciation) can revisit it.
 */
import { morphologicalPronunciation, rulesPronunciation } from './g2p'
import { EMPTY_LEXICON, hasPrimaryStress, type Lexicon, type LexiconSource } from './lexicon'
import { isWhQuestion, normalizeText, type Boundary, type SentenceType, type WordToken } from './normalize'
import { isVowel, parsePronunciation, type Phone, type Pronunciation, type Stress } from './phonemes'
import { syllabify, type Syllable } from './syllables'

export type PronunciationSource = LexiconSource | 'morphology' | 'rules' | 'letters'

export interface UttWord {
  text: string
  source: string
  phones: Phone[]
  syllables: Syllable[]
  /** Function words (the, of, and, …) are not accented by the prosody engine. */
  isFunction: boolean
  emphasis: boolean
  pronSource: PronunciationSource
  /** All pronunciations that were available (the chosen one is phones). */
  alternatives: Pronunciation[]
}

export interface UttPhrase {
  words: UttWord[]
  boundary: Boundary
}

export interface UttSentence {
  text: string
  type: SentenceType
  /** wh-questions ("where is it?") fall at the end; yes/no questions rise */
  whQuestion: boolean
  phrases: UttPhrase[]
}

export interface Utterance {
  text: string
  sentences: UttSentence[]
}

export const FUNCTION_WORDS = new Set(
  (
    'a an the this that these those my your his her its our their me him us them i you he she it we they ' +
    'of to in on at by for with from into onto upon about as than and or but nor so if then ' +
    'is am are was were be been being do does did have has had can could will would shall should may might must ' +
    "there not no 's 'll 've 're 'd"
  ).split(' '),
)

const VOWEL_START = /^[aeiou]/

/** Weak forms for function words; strong (stressed) when emphasised or phrase-final. */
function choosePronunciation(
  token: WordToken,
  entries: Pronunciation[],
  next: WordToken | undefined,
  isFunction: boolean,
  phraseFinal: boolean,
): Pronunciation {
  if (entries.length === 1) return entries[0]!
  const strong = token.emphasis || phraseFinal
  if (token.text === 'the' && !strong) {
    const nextStartsWithVowel = !!next && (VOWEL_START.test(next.text) || (next.pron !== undefined && isVowel(parsePronunciation(next.pron)[0]?.id ?? '')))
    const want = nextStartsWithVowel ? 'i' : 'ə'
    const pick = entries.find((p) => p[p.length - 1]?.id === want)
    if (pick) return pick
  }
  if (isFunction) {
    const weak = entries.find((p) => !hasPrimaryStress(p))
    const stressed = entries.find((p) => hasPrimaryStress(p))
    if (strong && stressed) return stressed
    if (!strong && weak) return weak
  }
  return entries[0]!
}

/**
 * Content words with no stress mark (lexicons differ on monosyllables and contractions) get
 * primary stress on their first full vowel.
 */
function ensureStress(pron: Pronunciation, isFunction: boolean): Pronunciation {
  if (hasPrimaryStress(pron) || isFunction) return pron
  let target = pron.findIndex((p) => isVowel(p.id) && p.id !== 'ə' && p.id !== 'i')
  if (target < 0) target = pron.findIndex((p) => isVowel(p.id))
  if (target < 0) return pron
  return pron.map((p, i) => (i === target ? { ...p, stress: 1 as Stress } : p))
}

export interface AnalyzeOptions {
  lexicon?: Lexicon
}

export function pronounceWord(
  word: string,
  lexicon: Lexicon,
): { entries: Pronunciation[]; source: PronunciationSource } {
  const hits = lexicon.lookup(word)
  if (hits.length) return { entries: hits.map((h) => h.pron), source: hits[0]!.source }
  const morph = morphologicalPronunciation(word, lexicon)
  if (morph) return { entries: [morph], source: 'morphology' }
  return { entries: [rulesPronunciation(word)], source: 'rules' }
}

export function analyzeText(text: string, opts: AnalyzeOptions = {}): Utterance {
  const lexicon = opts.lexicon ?? EMPTY_LEXICON
  const sentences = normalizeText(text, { isKnownWord: (w) => lexicon.has(w) })
  return {
    text,
    sentences: sentences.map((s) => ({
      text: s.text,
      type: s.type,
      whQuestion: s.type === 'question' && isWhQuestion(s),
      phrases: s.phrases.map((ph) => ({
        boundary: ph.boundary,
        words: ph.words.map((tok, wi): UttWord => {
          const isFunction = FUNCTION_WORDS.has(tok.text)
          let entries: Pronunciation[]
          let source: PronunciationSource
          if (tok.pron !== undefined) {
            entries = [parsePronunciation(tok.pron)]
            source = 'letters'
          } else {
            ;({ entries, source } = pronounceWord(tok.text, lexicon))
          }
          const phraseFinal = wi === ph.words.length - 1
          const chosen = ensureStress(
            choosePronunciation(tok, entries, ph.words[wi + 1], isFunction, phraseFinal),
            isFunction && !tok.emphasis,
          )
          return {
            text: tok.text,
            source: tok.source,
            phones: chosen,
            syllables: syllabify(chosen),
            isFunction,
            emphasis: !!tok.emphasis,
            pronSource: source,
            alternatives: entries,
          }
        }),
      })),
    })),
  }
}

/** Every word in reading order. */
export function utteranceWords(utt: Utterance): UttWord[] {
  return utt.sentences.flatMap((s) => s.phrases.flatMap((p) => p.words))
}
