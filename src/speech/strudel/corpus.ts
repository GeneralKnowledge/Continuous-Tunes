/**
 * The Strudel voice's fixed evaluation corpus. Complements the sentence benchmark (../benchmark.ts)
 * with the building blocks of speech, so a change can be traced to vowels, single consonants,
 * transitions, words, phrases, sentence types or stress.
 *
 * Every item is a real English phrase, so an independent recogniser can score it. Vowels and
 * consonants sit in a carrier ("Say ... again"), as in classic intelligibility tests (hVd words:
 * Peterson & Barney 1952; Hillenbrand et al. 1995). Never edit an item in place: add a new id,
 * so earlier results stay comparable.
 */
export type VoiceCorpusCategory =
  | 'vowel'
  | 'consonant'
  | 'transition'
  | 'long-word'
  | 'phrase'
  | 'sentence'
  | 'question'
  | 'stress'

export interface VoiceCorpusItem {
  id: string
  category: VoiceCorpusCategory
  text: string
  /** the word under test, for carrier items */
  target?: string
}

const carrier = (category: VoiceCorpusCategory, prefix: string, words: string[]): VoiceCorpusItem[] =>
  words.map((w) => ({ id: `${prefix}-${w.replace(/[^a-z]/g, '')}`, category, text: `Say ${w} again.`, target: w }))

export const VOICE_CORPUS: readonly VoiceCorpusItem[] = [
  // monophthongs and diphthongs in h_d words
  ...carrier('vowel', 'v', ['heed', 'hid', 'head', 'had', 'hod', 'hawed', 'hood', "who'd", 'hud', 'heard', 'hayed', 'hide', 'hoed', 'how', 'hoist']),
  // every consonant once, word-initial, mostly before the same vowel
  ...carrier('consonant', 'c', ['pie', 'buy', 'tie', 'dye', 'kite', 'guy', 'fight', 'vine', 'thigh', 'thy', 'sigh', 'zoo', 'shy', 'chai', 'jive', 'high', 'my', 'night', 'lie', 'rye', 'why', 'yacht', 'sing', 'beige']),
  // hard transitions and clusters
  ...[
    'strengths', 'sixths', 'squirrel', 'rural', 'February', 'world', 'anemone', 'specific', 'statistics', 'thoroughly',
    'brewery', 'library', 'clothes', 'twelfth', 'asked',
  ].map((w): VoiceCorpusItem => ({ id: `t-${w.toLowerCase()}`, category: 'transition', text: `Say ${w} again.`, target: w })),
  ...['unbelievable', 'particularly', 'responsibility', 'temperature', 'extraordinary', 'communication', 'vulnerability', 'environmental'].map(
    (w): VoiceCorpusItem => ({ id: `l-${w}`, category: 'long-word', text: `Say ${w} again.`, target: w }),
  ),
  { id: 'p-apple', category: 'phrase', text: 'A big red apple.' },
  { id: 'p-night', category: 'phrase', text: 'In the middle of the night.' },
  { id: 'p-shells', category: 'phrase', text: 'She sells sea shells by the sea shore.' },
  { id: 'p-yellow', category: 'phrase', text: 'Red lorry, yellow lorry.' },
  { id: 'p-thanks', category: 'phrase', text: 'Thanks very much.' },
  { id: 'p-window', category: 'phrase', text: 'Open the window, please.' },
  { id: 's-weather', category: 'sentence', text: 'The weather has been lovely this week.' },
  { id: 's-train', category: 'sentence', text: 'The last train leaves at seven fifteen.' },
  { id: 's-music', category: 'sentence', text: 'Strudel is playing the music and speaking at the same time.' },
  { id: 's-kitchen', category: 'sentence', text: 'Put the kettle on and find some biscuits in the kitchen.' },
  { id: 'q-coming-s', category: 'question', text: 'You are coming tomorrow.' },
  { id: 'q-coming-q', category: 'question', text: 'You are coming tomorrow?' },
  { id: 'q-where', category: 'question', text: 'Where did you leave the keys?' },
  { id: 'q-ready', category: 'question', text: 'Are you ready to go?' },
  { id: 'r-record', category: 'stress', text: 'I want to record a new record.' },
  { id: 'r-present', category: 'stress', text: 'Please present the present to her.' },
  { id: 'r-object', category: 'stress', text: 'I object to that strange object.' },
  { id: 'r-emph', category: 'stress', text: 'I said the red one, not the blue one.' },
]

/** The first demo set: difficult words and phrases, one continuous voice. */
export const DEMO_IDS = ['t-strengths', 't-squirrel', 't-rural', 'l-particularly', 'p-shells', 'p-yellow', 's-music', 'q-coming-q', 'r-record'] as const
