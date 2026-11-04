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
  /** Accentable but left unaccented: a phrase-final adverb such as "again" after another
   *  accented word, so the nucleus falls on the new information ("say BEAD again"). */
  deaccent?: boolean
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

/**
 * Words that, phrase-finally after another accented word, normally take no nuclear accent in
 * British English (O'Connor & Arnold 1973; Wells 2006, "English Intonation", §3.4 on final
 * adverbs and "again"): the nucleus moves to the last content word before them.
 */
export const POST_NUCLEAR = new Set(
  'again too either though anyway then yet already please instead'.split(' '),
)

// Context words for noun/verb homographs ("a record" vs "to record")
const NOUN_CONTEXT = new Set('a an the this that these those my your his her its our their some any no every each another one very'.split(' '))
const VERB_CONTEXT = new Set("to will would shall should can could may might must i you we they don't won't can't not please let's".split(' '))
const PERFECT_CONTEXT = new Set('have has had having was were been be being is are am'.split(' '))

/** Homographs that differ in a segment, not stress: [phone in the noun/adjective form, in the verb form]. */
const SEGMENT_HOMOGRAPHS: Record<string, readonly [noun: string, verb: string]> = {
  live: ['aɪ', 'ɪ'],
  wind: ['ɪ', 'aɪ'],
  close: ['s', 'z'],
  use: ['s', 'z'],
  excuse: ['s', 'z'],
  abuse: ['s', 'z'],
}

const primaryIndex = (p: Pronunciation) => p.filter(isVowelPhone).findIndex((ph) => ph.stress === 1)
const isVowelPhone = (ph: Phone) => isVowel(ph.id)

/**
 * Pick between a homograph's pronunciations from the word before it: after a determiner the noun
 * (or adjective) form, after "to", a modal or a subject pronoun the verb form, and for "read" the
 * past form after have/be. Returns null when the context says nothing.
 */
export function chooseHomograph(word: string, entries: Pronunciation[], prev: string | undefined): Pronunciation | null {
  if (!prev || entries.length < 2) return null
  if (word === 'read') {
    if (!PERFECT_CONTEXT.has(prev)) return null
    return entries.find((p) => p.some((ph) => ph.id === 'e')) ?? null
  }
  const noun = NOUN_CONTEXT.has(prev)
  const verb = VERB_CONTEXT.has(prev)
  if (!noun && !verb) return null
  const seg = SEGMENT_HOMOGRAPHS[word]
  if (seg) {
    const want = noun ? seg[0] : seg[1]
    return entries.find((p) => p.some((ph) => ph.id === want)) ?? null
  }
  // noun/verb stress pairs (record, present, object, permit, …): nouns stress the first syllable
  const idx = entries.map(primaryIndex)
  if (new Set(idx).size < 2 || idx.some((i) => i < 0)) return null
  const pick = noun ? Math.min(...idx) : Math.max(...idx)
  return entries[idx.indexOf(pick)] ?? null
}

// Non-rhotic linking /r/: a word spelt with a final r(e) whose pronunciation ends in one of these
// vowels gets its /r/ back before a vowel-initial word in the same phrase ("far away", "here it is").
const LINKING_VOWELS = new Set(['ɑː', 'ɔː', 'ɜː', 'ə', 'ɪə', 'eə', 'ʊə'])
const R_SPELLING = /r(e|es)?$/

function withLinkingR(word: string, pron: Pronunciation, next: Pronunciation | undefined): Pronunciation {
  const last = pron[pron.length - 1]
  const first = next?.[0]
  if (!last || !first || !R_SPELLING.test(word) || !LINKING_VOWELS.has(last.id) || !isVowel(first.id)) return pron
  return [...pron, { id: 'r' }]
}

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
  /** Connected-speech rules (M5): homograph choice from context, linking /r/, deaccenting of
   *  final adverbs. Off reproduces the M1/M2 front end exactly. Default on. */
  connectedSpeech?: boolean
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
  const connected = opts.connectedSpeech ?? true
  /** Phrase-level rules that need the neighbouring words' final pronunciations. */
  const connect = (words: UttWord[]): UttWord[] => {
    if (!connected) return words
    const out = words.map((w, i) => {
      const phones = withLinkingR(w.text, w.phones, words[i + 1]?.phones)
      return phones === w.phones ? w : { ...w, phones, syllables: syllabify(phones) }
    })
    const last = out[out.length - 1]
    const accentable = (w: UttWord) => !w.isFunction || w.emphasis
    if (last && !last.emphasis && POST_NUCLEAR.has(last.text) && out.slice(0, -1).some(accentable)) {
      out[out.length - 1] = { ...last, deaccent: true }
    }
    return out
  }
  return {
    text,
    sentences: sentences.map((s) => ({
      text: s.text,
      type: s.type,
      whQuestion: s.type === 'question' && isWhQuestion(s),
      phrases: s.phrases.map((ph) => ({
        boundary: ph.boundary,
        words: connect(ph.words.map((tok, wi): UttWord => {
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
          const homograph = connected && !isFunction ? chooseHomograph(tok.text, entries, ph.words[wi - 1]?.text) : null
          const chosen = ensureStress(
            homograph ?? choosePronunciation(tok, entries, ph.words[wi + 1], isFunction, phraseFinal),
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
        })),
      })),
    })),
  }
}

/** Every word in reading order. */
export function utteranceWords(utt: Utterance): UttWord[] {
  return utt.sentences.flatMap((s) => s.phrases.flatMap((p) => p.words))
}
