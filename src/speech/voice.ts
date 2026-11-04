/**
 * Speech voice configuration: the speech "genome".
 *
 * Kept apart from the music genome (src/music/genome.ts) on purpose: speech evolution (M4) will
 * mutate these, never music state. Every field has a range chosen so that values inside it still
 * give intelligible speech with the formant backend; `validateVoice` clamps to those ranges and
 * enforces the relationships between fields (a short vocal tract with a very low pitch, a pitch
 * range that would push the voice above ~450 Hz, …).
 */
import { FITTED_PITCH } from './prosody-fitted'

export interface VoicePitch {
  /** Speaking pitch at the start of a phrase, Hz */
  baseHz: number
  /** Size of pitch accents, semitones above the baseline */
  accentSemitones: number
  /** Fall of the baseline across a phrase, semitones per second */
  declination: number
  /** Final rise of a yes/no question, semitones */
  questionRise: number
  /** Final fall of a statement, semitones below the baseline */
  finalFall: number
}

export interface VoiceTiming {
  /** 1 = normal; 2 = twice as fast */
  rate: number
  /** Scales pauses at commas and sentence ends */
  pauseScale: number
  /** Extra lengthening of stressed syllables (1 = Klatt's rules as published) */
  stressLengthening: number
}

export interface VoiceSource {
  /** Aspiration noise mixed into voicing, 0–1 */
  breathiness: number
  /** Cycle-to-cycle pitch perturbation, fraction of the period */
  jitter: number
  /** Cycle-to-cycle amplitude perturbation, fraction */
  shimmer: number
  /** Open quotient of the KLGLOTT88 pulse (0.4 pressed – 0.8 lax); used by the formant-m1 backend */
  openQuotient: number
  /** Extra low-pass on the source: 0 bright – 1 soft */
  spectralTilt: number
  /** LF voice quality Rd (Fant 1995): ~0.6 pressed, ~1.0 modal, ~1.8 lax, 2.5 breathy */
  rd: number
  /** Slow f0 drift (Klatt's flutter), 0–1 */
  flutter: number
  /** Recorded excitation: 0 = LF model only … 1 = natural glottal pulses only (formant backend;
   *  needs a pulse set loaded with setExcitationPulses, otherwise ignored) */
  excitation: number
}

export interface VoiceTract {
  /** Formant frequency scale: ~1.0 adult male, ~1.15 adult female, higher for children */
  formantScale: number
  /** Bandwidth scale: wider is duller and more damped */
  bandwidthScale: number
  /** Nasal coupling carried into vowels next to nasals, 0–1 */
  nasality: number
}

export interface VoiceArticulation {
  /** Gain of frication and bursts relative to the published targets */
  consonantStrength: number
  /** Formant transition time into and out of consonants, ms */
  transitionMs: number
  /** Vowel undershoot towards schwa in short unstressed vowels, 0–1 */
  coarticulation: number
  /** Length of aspiration after voiceless stops before a stressed vowel, ms */
  aspirationMs: number
}

export interface SpeechVoice {
  version: 1
  id: string
  name: string
  /** Synthesis backend id (see backends/index.ts) */
  backend: string
  /** 'm1' keeps the M1/M2 front end (no connected-speech rules) so the frozen baseline voice
   *  reproduces its audio bit for bit; omitted = current front end */
  frontend?: 'm1'
  /** 'fitted': durations and tune fitted to recorded speech (prosody-fitted.ts); omitted = Klatt's
   *  rules and the hand-set tune */
  prosody?: 'fitted'
  pitch: VoicePitch
  timing: VoiceTiming
  source: VoiceSource
  tract: VoiceTract
  articulation: VoiceArticulation
}

type Range = readonly [min: number, max: number]

export const VOICE_RANGES = {
  pitch: {
    baseHz: [60, 320],
    accentSemitones: [0, 10],
    declination: [0, 3],
    questionRise: [0, 12],
    finalFall: [0, 8],
  },
  timing: { rate: [0.5, 2], pauseScale: [0.3, 2.5], stressLengthening: [0.7, 1.5] },
  source: {
    breathiness: [0, 0.8],
    jitter: [0, 0.03],
    shimmer: [0, 0.15],
    openQuotient: [0.4, 0.8],
    spectralTilt: [0, 1],
    rd: [0.5, 2.5],
    flutter: [0, 1],
    excitation: [0, 1],
  },
  tract: { formantScale: [0.85, 1.3], bandwidthScale: [0.6, 1.8], nasality: [0, 1] },
  articulation: {
    consonantStrength: [0.4, 1.6],
    transitionMs: [20, 90],
    coarticulation: [0, 1],
    aspirationMs: [0, 90],
  },
} as const satisfies Record<string, Record<string, Range>>

export const DEFAULT_VOICE: SpeechVoice = {
  version: 1,
  id: 'alder',
  name: 'Alder (low)',
  backend: 'formant',
  prosody: 'fitted',
  pitch: { baseHz: 118, questionRise: 6, ...FITTED_PITCH },
  timing: { rate: 1, pauseScale: 1, stressLengthening: 1 },
  source: { breathiness: 0.08, jitter: 0.006, shimmer: 0.03, openQuotient: 0.55, spectralTilt: 0, rd: 0.9, flutter: 0.3, excitation: 0 },
  tract: { formantScale: 1, bandwidthScale: 1, nasality: 0.4 },
  articulation: { consonantStrength: 1, transitionMs: 50, coarticulation: 0.4, aspirationMs: 55 },
}

/**
 * Alder exactly as it was in M1 (PR #14), for the frozen `formant-m1` backend: rendering this voice
 * with that backend reproduces the M1 baseline bit for bit.
 */
export const M1_VOICE: SpeechVoice = {
  version: 1,
  id: 'alder-m1',
  name: 'Alder (M1 baseline)',
  backend: 'formant-m1',
  frontend: 'm1',
  pitch: { baseHz: 118, accentSemitones: 4, declination: 1.2, questionRise: 6, finalFall: 4 },
  timing: DEFAULT_VOICE.timing,
  source: { ...DEFAULT_VOICE.source, spectralTilt: 0.25 },
  tract: DEFAULT_VOICE.tract,
  articulation: DEFAULT_VOICE.articulation,
}

/**
 * Alder with the hand-set prosody it had before the fit (Klatt's duration rules, 4-semitone
 * accents), for A/B comparisons. Alder itself uses prosody fitted to recorded speech
 * (prosody-fitted.ts) since stage 3 of the Strudel voice.
 */
export const KLATT_PROSODY_VOICE: SpeechVoice = {
  ...M1_VOICE,
  id: 'alder-klatt',
  name: 'Alder (hand-set prosody)',
  backend: DEFAULT_VOICE.backend,
  frontend: undefined,
  source: DEFAULT_VOICE.source,
}

const preset = (base: SpeechVoice, patch: {
  id: string
  name: string
  pitch?: Partial<VoicePitch>
  timing?: Partial<VoiceTiming>
  source?: Partial<VoiceSource>
  tract?: Partial<VoiceTract>
  articulation?: Partial<VoiceArticulation>
}): SpeechVoice => ({
  ...base,
  id: patch.id,
  name: patch.name,
  pitch: { ...base.pitch, ...patch.pitch },
  timing: { ...base.timing, ...patch.timing },
  source: { ...base.source, ...patch.source },
  tract: { ...base.tract, ...patch.tract },
  articulation: { ...base.articulation, ...patch.articulation },
})

export const VOICE_PRESETS: readonly SpeechVoice[] = [
  DEFAULT_VOICE,
  preset(DEFAULT_VOICE, {
    id: 'birch',
    name: 'Birch (middle)',
    pitch: { baseHz: 165, accentSemitones: (5 / 4) * FITTED_PITCH.accentSemitones },
    tract: { formantScale: 1.1 },
    source: { openQuotient: 0.6, breathiness: 0.15, rd: 1.3 },
  }),
  preset(DEFAULT_VOICE, {
    id: 'cedar',
    name: 'Cedar (high, breathy)',
    pitch: { baseHz: 215, accentSemitones: (5.5 / 4) * FITTED_PITCH.accentSemitones, questionRise: 7 },
    tract: { formantScale: 1.17, bandwidthScale: 1.1 },
    source: { breathiness: 0.3, openQuotient: 0.68, spectralTilt: 0.2, rd: 1.8 },
  }),
  preset(DEFAULT_VOICE, {
    id: 'monotone',
    name: 'Monotone (diagnostic)',
    pitch: { accentSemitones: 0, declination: 0, questionRise: 0, finalFall: 0 },
    source: { jitter: 0, shimmer: 0, breathiness: 0, flutter: 0 },
  }),
]

export function getVoicePreset(id: string): SpeechVoice {
  return [...VOICE_PRESETS, M1_VOICE, KLATT_PROSODY_VOICE].find((v) => v.id === id) ?? DEFAULT_VOICE
}

export interface VoiceValidation {
  voice: SpeechVoice
  /** What was clamped or adjusted, for the UI and experiment logs */
  issues: string[]
}

const clamp = (x: number, [lo, hi]: Range) => Math.min(hi, Math.max(lo, x))

/** Clamp every field into range and enforce relationships between fields. Never throws. */
export function validateVoice(input: SpeechVoice): VoiceValidation {
  const issues: string[] = []
  const fix = <G extends keyof typeof VOICE_RANGES>(group: G): SpeechVoice[G] => {
    const ranges = VOICE_RANGES[group] as Record<string, Range>
    const src = (input[group] ?? {}) as unknown as Record<string, number>
    const def = DEFAULT_VOICE[group] as unknown as Record<string, number>
    const out: Record<string, number> = {}
    for (const [key, range] of Object.entries(ranges)) {
      const raw = src[key]
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : def[key]!
      if (value !== raw) issues.push(`${group}.${key} missing; used default ${value}`)
      const c = clamp(value, range)
      if (c !== value) issues.push(`${group}.${key} ${value} clamped to ${c}`)
      out[key] = c
    }
    return out as unknown as SpeechVoice[G]
  }
  const voice: SpeechVoice = {
    version: 1,
    id: input.id || 'custom',
    name: input.name || 'Custom voice',
    backend: input.backend || 'formant',
    ...(input.frontend === 'm1' ? { frontend: 'm1' as const } : {}),
    ...(input.prosody === 'fitted' ? { prosody: 'fitted' as const } : {}),
    pitch: fix('pitch'),
    timing: fix('timing'),
    source: fix('source'),
    tract: fix('tract'),
    articulation: fix('articulation'),
  }
  // Highest pitch reached (accent + question rise) stays under ~450 Hz, where F0 meets F1 and
  // vowels stop being distinguishable.
  const peak = voice.pitch.baseHz * 2 ** ((voice.pitch.accentSemitones + voice.pitch.questionRise) / 12)
  if (peak > 450) {
    const allowed = Math.max(0, 12 * Math.log2(450 / voice.pitch.baseHz) - voice.pitch.accentSemitones)
    issues.push(`questionRise ${voice.pitch.questionRise} lowered to ${allowed.toFixed(1)} (peak pitch over 450 Hz)`)
    voice.pitch.questionRise = allowed
  }
  // A short vocal tract with a very low pitch is not a human voice; raise pitch to match.
  const minHz = 60 + (voice.tract.formantScale - 0.85) * 300
  if (voice.pitch.baseHz < minHz) {
    issues.push(`baseHz ${voice.pitch.baseHz} raised to ${minHz.toFixed(0)} for formantScale ${voice.tract.formantScale}`)
    voice.pitch.baseHz = minHz
  }
  // Fast speech cannot afford long transitions: keep them under ~35% of a short vowel.
  const maxTrans = 90 / voice.timing.rate
  if (voice.articulation.transitionMs > maxTrans) {
    issues.push(`transitionMs ${voice.articulation.transitionMs} lowered to ${maxTrans.toFixed(0)} at rate ${voice.timing.rate}`)
    voice.articulation.transitionMs = maxTrans
  }
  return { voice, issues }
}

/** Apply UI controls (rate and pitch multipliers) on top of a voice, validated. */
export function withControls(voice: SpeechVoice, controls: { rate?: number; pitch?: number }): SpeechVoice {
  return validateVoice({
    ...voice,
    pitch: { ...voice.pitch, baseHz: voice.pitch.baseHz * (controls.pitch ?? 1) },
    timing: { ...voice.timing, rate: voice.timing.rate * (controls.rate ?? 1) },
  }).voice
}
