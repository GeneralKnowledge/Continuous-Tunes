/**
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
  /** High-pass corner of the frication noise, Hz: the front cavity passes little below its own
   *  resonance, so sibilants have almost no low-frequency noise (Stevens 1998, ch. 8) */
  fricHp: number
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
  fricHp?: number
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
  fricHp: p.fricHp ?? 0,
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

// Frication spectra (centre Hz, bandwidth Hz, gain), for a white (flat) noise source. Shapes after
// Jongman, Wayland & Wong (2000): /s/ peaks high (spectral mean ~6 kHz), /ʃ/ lower (~4 kHz) and
// louder, /f θ/ diffuse and ~10 dB weaker; burst spectra after Stevens (1998): /t/ high and
// diffuse-rising, /k/ compact at the following vowel's F2–F3, /p/ diffuse-falling.
const S_SPECTRUM: FricBand[] = [[5600, 1400, 0.9], [7600, 1800, 0.55], [3200, 600, 0.06]]
const SH_SPECTRUM: FricBand[] = [[2700, 700, 1.0], [4000, 1400, 0.9], [6000, 2000, 0.35]]
const TH_SPECTRUM: FricBand[] = [[6000, 3500, 0.32], [3000, 1600, 0.12], [8000, 2000, 0.12]]
const F_SPECTRUM: FricBand[] = [[5200, 4000, 0.3], [2000, 1500, 0.1], [8000, 2500, 0.1]]
const T_BURST: FricBand[] = [[4300, 1500, 1.0], [6200, 2000, 0.8], [2800, 800, 0.15]]
const K_BURST: FricBand[] = [[1900, 600, 1.6], [3000, 900, 0.45], [5000, 2000, 0.1]]
const P_BURST: FricBand[] = [[900, 900, 0.6], [2200, 1500, 0.25], [4000, 2500, 0.08]]

// Voiced obstruents (Stevens 1998): a weak, low-pass "voice bar" during stop closures; voiced
// fricatives keep real frication with lower voicing so they stay fricatives rather than becoming
// vowel-like murmurs (M1 had /v ð/ only 6 dB under vowels and heard as nasals or nothing).
export const CONSONANTS: Record<string, ConsonantTarget> = {
  p: C({ formants: LABIAL, slope: 0.75, transitionMs: 45, fric: P_BURST, bypass: 0.3, stop: { burstMs: 8, burstGain: 0.8 } }),
  b: C({ formants: LABIAL, slope: 0.75, transitionMs: 45, av: 0.15, fric: P_BURST, bypass: 0.25, stop: { burstMs: 8, burstGain: 0.9 } }),
  t: C({ formants: ALVEOLAR, slope: 0.4, transitionMs: 50, fric: T_BURST, bypass: 0.15, stop: { burstMs: 12, burstGain: 0.6 }, fricHp: 2000 }),
  d: C({ formants: ALVEOLAR, slope: 0.4, transitionMs: 50, av: 0.15, fric: T_BURST, bypass: 0.1, stop: { burstMs: 10, burstGain: 0.7 }, fricHp: 2000 }),
  k: C({ formants: VELAR, slope: 0.7, transitionMs: 55, fric: K_BURST, bypass: 0.05, stop: { burstMs: 20, burstGain: 0.8 }, fricHp: 900 }),
  g: C({ formants: VELAR, slope: 0.7, transitionMs: 55, av: 0.15, fric: K_BURST, bypass: 0.05, stop: { burstMs: 15, burstGain: 0.85 }, fricHp: 900 }),
  tʃ: C({ formants: POSTALV, slope: 0.5, transitionMs: 50, af: 1, fric: SH_SPECTRUM, stop: { burstMs: 60, burstGain: 1.0 }, fricHp: 1600 }),
  dʒ: C({ formants: POSTALV, slope: 0.5, transitionMs: 50, av: 0.2, af: 0.7, fric: SH_SPECTRUM, stop: { burstMs: 45, burstGain: 0.7 }, fricHp: 1600 }),
  f: C({ formants: LABIODENTAL, slope: 0.7, transitionMs: 40, af: 0.5, fric: F_SPECTRUM, bypass: 0.12, fricHp: 900 }),
  v: C({ formants: LABIODENTAL, slope: 0.7, transitionMs: 40, av: 0.22, af: 0.9, fric: F_SPECTRUM, bypass: 0.1, fricHp: 900 }),
  θ: C({ formants: DENTAL, slope: 0.6, transitionMs: 40, af: 0.5, fric: TH_SPECTRUM, bypass: 0.12, fricHp: 900 }),
  ð: C({ formants: DENTAL, slope: 0.6, transitionMs: 40, av: 0.22, af: 0.8, fric: TH_SPECTRUM, bypass: 0.08, fricHp: 900 }),
  s: C({ formants: ALVEOLAR, slope: 0.5, transitionMs: 40, af: 1, fric: S_SPECTRUM, fricHp: 3000 }),
  z: C({ formants: ALVEOLAR, slope: 0.5, transitionMs: 40, av: 0.22, af: 0.85, fric: S_SPECTRUM, fricHp: 3000 }),
  ʃ: C({ formants: POSTALV, slope: 0.55, transitionMs: 45, af: 1, fric: SH_SPECTRUM, fricHp: 1700 }),
  ʒ: C({ formants: POSTALV, slope: 0.55, transitionMs: 45, av: 0.22, af: 0.85, fric: SH_SPECTRUM, fricHp: 1700 }),
  h: C({ formants: SCHWA, slope: 1, transitionMs: 20, ah: 0.45, followsVowel: true }),
  m: C({ formants: F(480, 1270, 2130, 40, 150, 200), locus: LABIAL, slope: 0.75, transitionMs: 35, av: 0.5, nasalZero: 450 }),
  n: C({ formants: F(480, 1340, 2470, 40, 200, 200), locus: ALVEOLAR, slope: 0.45, transitionMs: 35, av: 0.45, nasalZero: 450 }),
  ŋ: C({ formants: F(480, 2000, 2300, 40, 200, 200), locus: VELAR, slope: 0.8, transitionMs: 40, av: 0.45, nasalZero: 450 }),
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
