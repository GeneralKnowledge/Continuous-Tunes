/**
 * The speech benchmark: a fixed set of sentences, rendered the same way every time, so changes to
 * the front end, prosody or a backend can be compared run against run.
 *
 * Categories follow the brief: conversation, short and long sentences, consonant clusters,
 * minimal pairs in a carrier phrase (as in the Modified Rhyme Test, House et al. 1965), questions
 * against statements, numbers/dates/punctuation, unfamiliar words, emphasis, and speaking rates.
 */

export type BenchmarkCategory =
  | 'conversation'
  | 'short'
  | 'long'
  | 'clusters'
  | 'minimal-pairs'
  | 'questions'
  | 'numbers'
  | 'unfamiliar'
  | 'emphasis'

export interface BenchmarkItem {
  id: string
  category: BenchmarkCategory
  text: string
  /** speaking-rate multiplier for this item (default 1) */
  rate?: number
}

const MINIMAL_PAIRS: [string, string][] = [
  ['bat', 'pat'], ['bad', 'pad'], ['ship', 'sip'], ['thin', 'fin'], ['bead', 'bid'], ['full', 'fool'],
  ['cot', 'caught'], ['van', 'fan'], ['rice', 'lice'], ['sing', 'sin'], ['cheap', 'jeep'],
  ['goat', 'coat'], ['dime', 'time'], ['zoo', 'sue'], ['men', 'man'], ['hot', 'hat'],
]

export const BENCHMARK: readonly BenchmarkItem[] = [
  { id: 'conv-01', category: 'conversation', text: 'Good morning, how are you today?' },
  { id: 'conv-02', category: 'conversation', text: "I'll meet you at the station after work." },
  { id: 'conv-03', category: 'conversation', text: 'Could you pass me the salt, please?' },
  { id: 'conv-04', category: 'conversation', text: 'The weather has been lovely this week.' },
  { id: 'conv-05', category: 'conversation', text: 'Thank you very much for your help.' },
  { id: 'short-01', category: 'short', text: 'Yes.' },
  { id: 'short-02', category: 'short', text: 'No, thanks.' },
  { id: 'short-03', category: 'short', text: 'Hello there.' },
  { id: 'short-04', category: 'short', text: 'Come in.' },
  {
    id: 'long-01',
    category: 'long',
    text: 'The North Wind and the Sun were disputing which was the stronger, when a traveller came along wrapped in a warm cloak.',
  },
  {
    id: 'long-02',
    category: 'long',
    text: 'When the train finally arrived, we found our seats, put the bags on the rack, and watched the countryside roll past the window.',
  },
  { id: 'clusters-01', category: 'clusters', text: 'She sells seashells by the seashore.' },
  { id: 'clusters-02', category: 'clusters', text: 'The splendid squirrels scrambled through the street.' },
  { id: 'clusters-03', category: 'clusters', text: 'His sixth attempt at the twelfth text was the strongest.' },
  { id: 'clusters-04', category: 'clusters', text: 'Fresh bread and crisp apples are on the table.' },
  ...MINIMAL_PAIRS.flatMap(([a, b], i) => [
    { id: `pair-${String(i + 1).padStart(2, '0')}a`, category: 'minimal-pairs' as const, text: `Now say ${a} again.` },
    { id: `pair-${String(i + 1).padStart(2, '0')}b`, category: 'minimal-pairs' as const, text: `Now say ${b} again.` },
  ]),
  { id: 'q-01', category: 'questions', text: "You're coming tomorrow." },
  { id: 'q-02', category: 'questions', text: "You're coming tomorrow?" },
  { id: 'q-03', category: 'questions', text: 'Where did you put the keys?' },
  { id: 'q-04', category: 'questions', text: 'Is it raining outside?' },
  { id: 'q-05', category: 'questions', text: 'It is raining outside.' },
  { id: 'num-01', category: 'numbers', text: 'The meeting is on 3/11/2026 at 10:30.' },
  { id: 'num-02', category: 'numbers', text: 'It costs £5.50, which is 25% less than last year.' },
  { id: 'num-03', category: 'numbers', text: 'In 1984 there were 1,250 people in the village.' },
  { id: 'num-04', category: 'numbers', text: 'Turn left at the 2nd junction; then drive 3 km north.' },
  { id: 'unfamiliar-01', category: 'unfamiliar', text: 'The glimmerous blorpington zibbeted across the moor.' },
  { id: 'unfamiliar-02', category: 'unfamiliar', text: 'Loughborough and Leicester are both in the Midlands.' },
  { id: 'emph-01', category: 'emphasis', text: 'I said the *red* car, not the blue one.' },
  { id: 'emph-02', category: 'emphasis', text: '*I* never said she stole the money.' },
  { id: 'rate-slow', category: 'conversation', text: 'Please speak a little more slowly.', rate: 0.75 },
  { id: 'rate-fast', category: 'conversation', text: 'Please speak a little more quickly.', rate: 1.4 },
]
