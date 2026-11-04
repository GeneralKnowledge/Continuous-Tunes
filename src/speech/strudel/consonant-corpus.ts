/**
 * Minimal-pair corpus for consonant voicing and stop place (stage 4 of the Strudel voice).
 * Separate from the benchmark and VOICE_CORPUS, which stay unchanged so earlier results remain
 * comparable.
 *
 * Every pair differs in one consonant. Each word is spoken alone, in the carrier "Say X again."
 * and in a sentence where it occurs naturally, so a result can be read per contrast (p-b, s-z, …),
 * per position (initial, medial, final) and per context (alone, carrier, sentence).
 */
export type Contrast = 'p-b' | 't-d' | 'k-g' | 's-z' | 'f-v' | 'θ-ð' | 'tʃ-dʒ'
export type Position = 'initial' | 'medial' | 'final'

export interface MinimalPair {
  contrast: Contrast
  position: Position
  /** voiceless member first */
  words: readonly [string, string]
  sentences: readonly [string, string]
}

export const MINIMAL_PAIRS: readonly MinimalPair[] = [
  { contrast: 'p-b', position: 'initial', words: ['pat', 'bat'], sentences: ['She gave the dog a pat on the head.', 'He swung the bat and missed the ball.'] },
  { contrast: 'p-b', position: 'initial', words: ['pea', 'bee'], sentences: ['A single pea rolled off the plate.', 'A bee landed on the flower.'] },
  { contrast: 'p-b', position: 'final', words: ['cap', 'cab'], sentences: ['He wore a red cap to the match.', 'We took a cab to the station.'] },
  { contrast: 't-d', position: 'initial', words: ['tie', 'die'], sentences: ['He wore a blue tie to the wedding.', 'The plants will die without water.'] },
  { contrast: 't-d', position: 'initial', words: ['tin', 'din'], sentences: ['The beans came in a tin.', 'The din from the street kept us awake.'] },
  { contrast: 't-d', position: 'final', words: ['bat', 'bad'], sentences: ['The bat flew out of the cave.', 'It was a bad day for the team.'] },
  { contrast: 'k-g', position: 'initial', words: ['coat', 'goat'], sentences: ['She hung her coat on the door.', 'The goat ate the grass by the fence.'] },
  { contrast: 'k-g', position: 'initial', words: ['cap', 'gap'], sentences: ['Put the cap back on the pen.', 'Mind the gap between the train and the platform.'] },
  { contrast: 'k-g', position: 'final', words: ['back', 'bag'], sentences: ['He hurt his back lifting boxes.', 'She packed her bag for the trip.'] },
  { contrast: 's-z', position: 'initial', words: ['sue', 'zoo'], sentences: ['They decided to sue the company.', 'We saw the lions at the zoo.'] },
  { contrast: 's-z', position: 'initial', words: ['sip', 'zip'], sentences: ['Take a sip of the hot tea.', 'The zip on my jacket is broken.'] },
  { contrast: 's-z', position: 'initial', words: ['seal', 'zeal'], sentences: ['A seal swam close to the boat.', 'She worked with great zeal.'] },
  { contrast: 's-z', position: 'final', words: ['bus', 'buzz'], sentences: ['We missed the last bus home.', 'There was a buzz of excitement in the room.'] },
  { contrast: 's-z', position: 'final', words: ['ice', 'eyes'], sentences: ['The pond was covered in ice.', 'She closed her eyes and listened.'] },
  { contrast: 'f-v', position: 'initial', words: ['fan', 'van'], sentences: ['Turn on the fan, it is hot.', 'The van was parked outside.'] },
  { contrast: 'f-v', position: 'initial', words: ['fine', 'vine'], sentences: ['The weather is fine today.', 'A vine grew up the wall.'] },
  { contrast: 'f-v', position: 'final', words: ['safe', 'save'], sentences: ['The money is safe in the bank.', 'Try to save some money each month.'] },
  { contrast: 'θ-ð', position: 'initial', words: ['thigh', 'thy'], sentences: ['He hurt his thigh playing football.', 'Thy will be done.'] },
  { contrast: 'θ-ð', position: 'final', words: ['teeth', 'teethe'], sentences: ['Brush your teeth before bed.', 'Babies teethe at about six months.'] },
  { contrast: 'tʃ-dʒ', position: 'initial', words: ['cheap', 'jeep'], sentences: ['The tickets were cheap this year.', 'They drove the jeep across the field.'] },
  { contrast: 'tʃ-dʒ', position: 'initial', words: ['chin', 'gin'], sentences: ['He rested his chin on his hand.', 'She ordered a gin and tonic.'] },
]

export type PairContext = 'word' | 'carrier' | 'sentence'

export interface PairItem {
  id: string
  text: string
  /** the word being tested and its partner */
  target: string
  partner: string
  voiced: boolean
  contrast: Contrast
  position: Position
  context: PairContext
}

const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1)

/** Every word of every pair in each context. Ids are stable: <word>-<context>[-n]. */
export function pairItems(): PairItem[] {
  const out: PairItem[] = []
  const seen = new Map<string, number>()
  for (const p of MINIMAL_PAIRS) {
    p.words.forEach((w, k) => {
      const partner = p.words[1 - k]!
      const base = { target: w, partner, voiced: k === 1, contrast: p.contrast, position: p.position }
      const texts: [PairContext, string][] = [['word', `${cap(w)}.`], ['carrier', `Say ${w} again.`], ['sentence', p.sentences[k]!]]
      for (const [context, text] of texts) {
        const key = `${w}-${context}`
        const n = (seen.get(key) ?? 0) + 1
        seen.set(key, n)
        out.push({ id: n > 1 ? `${key}-${n}` : key, text, context, ...base })
      }
    })
  }
  return out
}
