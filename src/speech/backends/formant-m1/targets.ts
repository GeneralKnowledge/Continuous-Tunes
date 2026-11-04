/**
 * FROZEN: the M1 formant backend as merged in PR #14. Do not edit; it exists so every later change
 * can be A/B-compared against the baseline with identical plans and voices.
 *
 * Acoustic targets for the formant backend, per phoneme, for an adult male vocal tract
 * (formantScale 1.0). Other voices scale the frequencies.
 *
 * Sources: vowel formants of Standard Southern British from Deterding (1997, "The formants of
 * monophthong vowels in Standard Southern British English pronunciation", JIPA 27) with F3 and
 * bandwidths after Klatt (1980, "Software for a cascade/parallel formant synthesizer", JASA 67);
 * consonant targets, nasal pole/zero values and the parallel amplitudes for frication follow
 * Klatt's 1980 tables in spirit; F2 loci follow the locus-equation literature (Sussman et al. 1991).
 * The numbers are our own approximations and are meant to be tuned (and later evolved).
 */

/** Formant frequencies and bandwidths, Hz */
export interface Formants {
  f1: number
  f2: number
  f3: number
  b1: number
  b2: number
  b3: number
}

/** One band of the parallel (frication) branch: centre, bandwidth, linear gain */
export type FricBand = readonly [hz: number, bw: number, gain: number]

export interface VowelTarget {
  kind: 'vowel'
  formants: Formants
  /** Second target for diphthongs, reached near the end of the vowel */
  glideTo?: Formants
}

export interface ConsonantTarget {
  kind: 'consonant'
  /** Formants during the consonant itself (murmur of nasals, liquids, glides; closure of stops) */
  formants: Formants
  /** Locus: where formant transitions into and out of a neighbouring vowel start */
  locus: Formants
  /** Locus-equation slope: 0 = transitions start at the locus, 1 = at the vowel's own values */
  slope: number
  /** Transition time this consonant imposes on a neighbouring vowel, ms (scaled by the voice) */
  transitionMs: number
  /** Voicing amplitude during the consonant, 0–1 */
  av: number
  /** Aspiration amplitude through the vocal tract (h), 0–1 */
  ah: number
  /** Frication amplitude, 0–1, with its spectral shape */
  af: number
  fric: readonly FricBand[]
  /** Flat (bypass) part of the frication, 0–1 */
  bypass: number
  /** Nasal zero frequency (the nasal pole sits at 270 Hz; zero = 270 means no nasal coupling) */
  nasalZero?: number
  /** Stops and affricates: closure then burst; burst shape uses fric/bypass */
  stop?: { burstMs: number; burstGain: number }
  /** h takes its formants from the following vowel */
  followsVowel?: boolean
}

export type PhoneTarget = VowelTarget | ConsonantTarget

const F = (f1: number, f2: number, f3: number, b1 = 70, b2 = 100, b3 = 150): Formants => ({ f1, f2, f3, b1, b2, b3 })

const V = (f: Formants, glideTo?: Formants): VowelTarget =>
  glideTo ? { kind: 'vowel', formants: f, glideTo } : { kind: 'vowel', formants: f }

export const SCHWA = F(500, 1450, 2500, 80, 100, 150)

export const VOWELS: Record<string, VowelTarget> = {
  iː: V(F(280, 2250, 2950, 50, 90, 150)),
  ɪ: V(F(370, 1950, 2600, 60, 90, 150)),
  e: V(F(500, 1800, 2550, 70, 100, 150)),
  æ: V(F(690, 1550, 2450, 90, 100, 150)),
  ʌ: V(F(640, 1200, 2400, 80, 90, 150)),
  ɑː: V(F(660, 1080, 2500, 90, 90, 150)),
  ɒ: V(F(560, 900, 2500, 80, 90, 150)),
  ɔː: V(F(420, 760, 2500, 70, 80, 150)),
  ʊ: V(F(380, 1150, 2350, 60, 90, 150)),
  uː: V(F(300, 1350, 2300, 60, 90, 150)),
  ɜː: V(F(510, 1380, 2450, 70, 90, 150)),
  ə: V(SCHWA),
  i: V(F(300, 2150, 2800, 55, 90, 150)),
  eɪ: V(F(480, 1900, 2550, 70, 100, 150), F(350, 2150, 2700, 60, 90, 150)),
  aɪ: V(F(700, 1300, 2500, 90, 90, 150), F(380, 2000, 2600, 60, 90, 150)),
  ɔɪ: V(F(450, 800, 2450, 70, 80, 150), F(380, 1900, 2600, 60, 90, 150)),
  əʊ: V(F(500, 1350, 2400, 75, 90, 150), F(420, 1100, 2350, 60, 80, 150)),
  aʊ: V(F(770, 1350, 2450, 100, 90, 150), F(420, 950, 2350, 60, 80, 150)),
  ɪə: V(F(380, 1950, 2600, 60, 90, 150), F(500, 1450, 2500, 80, 100, 150)),
  eə: V(F(520, 1750, 2500, 70, 100, 150), F(540, 1550, 2500, 80, 100, 150)),
  ʊə: V(F(380, 1100, 2350, 60, 90, 150), F(500, 1400, 2450, 80, 100, 150)),
}

interface CParts {
  formants: Formants
  locus?: Formants
  slope?: number
  transitionMs?: number
  av?: number
  ah?: number
  af?: number
  fric?: readonly FricBand[]
  bypass?: number
  nasalZero?: number
  stop?: { burstMs: number; burstGain: number }
  followsVowel?: boolean
}

const C = (p: CParts): ConsonantTarget => ({
  kind: 'consonant',
  formants: p.formants,
  locus: p.locus ?? p.formants,
  slope: p.slope ?? 0.5,
  transitionMs: p.transitionMs ?? 50,
  av: p.av ?? 0,
  ah: p.ah ?? 0,
  af: p.af ?? 0,
  fric: p.fric ?? [],
  bypass: p.bypass ?? 0,
  ...(p.nasalZero !== undefined ? { nasalZero: p.nasalZero } : {}),
  ...(p.stop ? { stop: p.stop } : {}),
  ...(p.followsVowel ? { followsVowel: true } : {}),
})

// Places of articulation: loci and spectra shared by stops, fricatives and nasals
const LABIAL = F(220, 900, 2100, 60, 300, 400)
const ALVEOLAR = F(220, 1750, 2650, 60, 300, 400)
const VELAR = F(220, 2050, 2150, 60, 300, 400)
const DENTAL = F(240, 1450, 2700, 60, 300, 400)
const POSTALV = F(240, 2000, 2450, 60, 300, 400)
const LABIODENTAL = F(240, 1100, 2150, 60, 300, 400)

// Frication spectra (centre Hz, bandwidth Hz, gain)
const S_SPECTRUM: FricBand[] = [[5200, 900, 0.55], [7200, 1400, 0.4], [3000, 500, 0.04]]
const SH_SPECTRUM: FricBand[] = [[2600, 450, 1.4], [3600, 700, 0.8], [5500, 1500, 0.3]]
const TH_SPECTRUM: FricBand[] = [[6500, 2500, 0.18], [3500, 1500, 0.06]]
const F_SPECTRUM: FricBand[] = [[7000, 3000, 0.12], [1500, 900, 0.05]]
const T_BURST: FricBand[] = [[4200, 1000, 0.8], [6000, 1800, 0.5]]
const K_BURST: FricBand[] = [[1900, 300, 1.6], [3000, 600, 0.3]]
const P_BURST: FricBand[] = [[900, 700, 0.4], [2500, 1500, 0.1]]

export const CONSONANTS: Record<string, ConsonantTarget> = {
  p: C({ formants: LABIAL, slope: 0.75, transitionMs: 45, fric: P_BURST, bypass: 0.25, stop: { burstMs: 8, burstGain: 0.55 } }),
  b: C({ formants: LABIAL, slope: 0.75, transitionMs: 45, av: 0.12, fric: P_BURST, bypass: 0.2, stop: { burstMs: 6, burstGain: 0.35 } }),
  t: C({ formants: ALVEOLAR, slope: 0.4, transitionMs: 50, fric: T_BURST, bypass: 0.1, stop: { burstMs: 12, burstGain: 0.75 } }),
  d: C({ formants: ALVEOLAR, slope: 0.4, transitionMs: 50, av: 0.12, fric: T_BURST, bypass: 0.08, stop: { burstMs: 9, burstGain: 0.5 } }),
  k: C({ formants: VELAR, slope: 0.7, transitionMs: 55, fric: K_BURST, bypass: 0.05, stop: { burstMs: 25, burstGain: 1.2 } }),
  g: C({ formants: VELAR, slope: 0.7, transitionMs: 55, av: 0.12, fric: K_BURST, bypass: 0.05, stop: { burstMs: 16, burstGain: 0.7 } }),
  tʃ: C({ formants: POSTALV, slope: 0.5, transitionMs: 50, af: 0.8, fric: SH_SPECTRUM, stop: { burstMs: 55, burstGain: 0.85 } }),
  dʒ: C({ formants: POSTALV, slope: 0.5, transitionMs: 50, av: 0.25, af: 0.5, fric: SH_SPECTRUM, stop: { burstMs: 45, burstGain: 0.6 } }),
  f: C({ formants: LABIODENTAL, slope: 0.7, transitionMs: 40, af: 0.7, fric: F_SPECTRUM, bypass: 0.12 }),
  v: C({ formants: LABIODENTAL, slope: 0.7, transitionMs: 40, av: 0.45, af: 0.4, fric: F_SPECTRUM, bypass: 0.08 }),
  θ: C({ formants: DENTAL, slope: 0.6, transitionMs: 40, af: 0.7, fric: TH_SPECTRUM, bypass: 0.1 }),
  ð: C({ formants: DENTAL, slope: 0.6, transitionMs: 40, av: 0.5, af: 0.35, fric: TH_SPECTRUM, bypass: 0.05 }),
  s: C({ formants: ALVEOLAR, slope: 0.5, transitionMs: 40, af: 1, fric: S_SPECTRUM }),
  z: C({ formants: ALVEOLAR, slope: 0.5, transitionMs: 40, av: 0.4, af: 0.6, fric: S_SPECTRUM }),
  ʃ: C({ formants: POSTALV, slope: 0.55, transitionMs: 45, af: 1, fric: SH_SPECTRUM }),
  ʒ: C({ formants: POSTALV, slope: 0.55, transitionMs: 45, av: 0.4, af: 0.6, fric: SH_SPECTRUM }),
  h: C({ formants: SCHWA, slope: 1, transitionMs: 20, ah: 0.55, followsVowel: true }),
  m: C({ formants: F(480, 1270, 2130, 40, 200, 200), locus: LABIAL, slope: 0.75, transitionMs: 35, av: 0.5, nasalZero: 750 }),
  n: C({ formants: F(480, 1340, 2470, 40, 300, 300), locus: ALVEOLAR, slope: 0.45, transitionMs: 35, av: 0.45, nasalZero: 1450 }),
  ŋ: C({ formants: F(480, 2000, 2300, 40, 300, 300), locus: VELAR, slope: 0.8, transitionMs: 40, av: 0.45, nasalZero: 2500 }),
  l: C({ formants: F(360, 1050, 2800, 60, 120, 200), slope: 0.35, transitionMs: 55, av: 0.75 }),
  r: C({ formants: F(330, 1100, 1550, 70, 100, 120), slope: 0.3, transitionMs: 65, av: 0.75 }),
  w: C({ formants: F(290, 650, 2150, 50, 80, 150), slope: 0.25, transitionMs: 75, av: 0.75 }),
  j: C({ formants: F(260, 2100, 3000, 50, 100, 200), slope: 0.25, transitionMs: 70, av: 0.75 }),
}

export function targetFor(phone: string): PhoneTarget {
  const t = VOWELS[phone] ?? CONSONANTS[phone]
  if (!t) throw new Error(`No formant target for ${phone}`)
  return t
}
