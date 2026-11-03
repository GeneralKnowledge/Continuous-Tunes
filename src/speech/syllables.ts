/**
 * Syllabification by the maximal onset principle, with English phonotactics: a consonant cluster
 * between two vowels gives the following syllable the longest onset English allows
 * ("ex.tra", "ap.ple" → "æ.pəl" ⇒ ˈæ p ə l → æ | p ə l).
 */
import { isVowel, type Phone, type Stress } from './phonemes'

export interface Syllable {
  onset: Phone[]
  nucleus: Phone
  coda: Phone[]
  stress: Stress
}

const SINGLE_ONSET_BANNED = new Set(['ŋ'])

const LEGAL_ONSETS = new Set(
  [
    // stop / fricative + liquid
    'p r', 'p l', 'b r', 'b l', 't r', 'd r', 'k r', 'k l', 'g r', 'g l', 'f r', 'f l', 'θ r',
    'ʃ r', 'v r',
    // + w
    't w', 'd w', 'k w', 'g w', 's w', 'θ w',
    // + j (RP keeps yod after alveolars)
    'p j', 'b j', 't j', 'd j', 'k j', 'g j', 'f j', 'v j', 'm j', 'n j', 'h j', 's j', 'z j', 'l j', 'θ j',
    // s clusters
    's p', 's t', 's k', 's m', 's n', 's l', 's f',
    's p r', 's p l', 's t r', 's k r', 's k w', 's k l', 's p j', 's t j', 's k j',
  ].map((s) => s),
)

function isLegalOnset(cluster: readonly Phone[]): boolean {
  if (cluster.length === 0) return true
  if (cluster.length === 1) return !SINGLE_ONSET_BANNED.has(cluster[0]!.id)
  return LEGAL_ONSETS.has(cluster.map((p) => p.id).join(' '))
}

export function syllabify(pron: readonly Phone[]): Syllable[] {
  const nuclei = pron.flatMap((p, i) => (isVowel(p.id) ? [i] : []))
  if (nuclei.length === 0) {
    // No vowel (an interjection like "shh", or a rules failure): one syllable on a schwa-less
    // consonant string. Backends treat the first sonorant-ish phone as the nucleus.
    if (pron.length === 0) return []
    return [{ onset: [], nucleus: pron[0]!, coda: pron.slice(1), stress: 1 }]
  }
  const syllables: Syllable[] = []
  let onsetStart = 0
  for (let k = 0; k < nuclei.length; k++) {
    const n = nuclei[k]!
    const nextN = nuclei[k + 1]
    const onset = pron.slice(onsetStart, n)
    let codaEnd = pron.length
    if (nextN !== undefined) {
      const cluster = pron.slice(n + 1, nextN)
      let split = 0 // index within cluster where the next onset begins
      while (split < cluster.length && !isLegalOnset(cluster.slice(split))) split++
      codaEnd = n + 1 + split
      onsetStart = codaEnd
    }
    const nucleus = pron[n]!
    syllables.push({
      onset,
      nucleus,
      coda: pron.slice(n + 1, codaEnd),
      stress: nucleus.stress ?? 0,
    })
  }
  return syllables
}

export function syllablePhones(s: Syllable): Phone[] {
  return [...s.onset, s.nucleus, ...s.coda]
}
