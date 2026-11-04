/**
 * Consonant layer for the Strudel voice (stage 4): plans stop releases and the state of the oral
 * constriction on top of the formant frames, for the instrument's DSP to play. Nothing here makes
 * sound.
 *
 * Why (measured against the CMU ARCTIC awb recordings, docs/speech/strudel-voice.md):
 * - Releases. The frames move in 5 ms steps, so a burst of 8–20 ms that should decay within a few
 *   milliseconds was smeared into a short ramp, 6–16 dB weaker than the speaker's. The instrument
 *   now plays each release as an event at its exact sample: a transient, then burst noise with a
 *   place-dependent decay (labial short and diffuse, alveolar longer and high, velar longest and
 *   compact; Stevens 1998, ch. 7; Klatt 1980's burst via the parallel branch).
 * - Constriction. During a closure or a narrow fricative constriction, voicing is radiated mainly
 *   at low frequencies (the "voice bar"): the higher formants are not excited through a closed or
 *   narrowed mouth (Stevens 1998, ch. 7–8; Westbury 1983). Unfiltered closure voicing made /b g/
 *   sound like /ð/ and /v ð/ like vowels. `cl` tells the instrument how far to low-pass voicing.
 * - Voiced frication. Turbulence is driven by the airflow, so in voiced fricatives it pulses with
 *   the glottal cycle (Klatt 1980, 50% modulation; Stevens 1998, ch. 8). A deeper modulation keeps
 *   the hiss and makes it periodic, rather than adding a separate low hum.
 */
import { isVowel } from '../../phonemes'
import { PAUSE, type SpeechPlan } from '../../plan'
import type { SpeechVoice } from '../../voice'
import { CONSONANTS } from '../../backends/formant/targets'
import type { SynthFrame } from '../../backends/formant/klatt'

export interface ConsonantSettings {
  /** play stop releases as sample-accurate events */
  bursts: boolean
  /** the event replaces the frame-rate burst (true) or adds its transient to it (false), which
   *  keeps frication bridging the release and the aspiration */
  replace: boolean
  /** burst gain by place (linear, like the frication amplitude) and decay time constant, ms */
  labial: readonly [gain: number, tauMs: number]
  alveolar: readonly [gain: number, tauMs: number]
  velar: readonly [gain: number, tauMs: number]
  postalveolar: readonly [gain: number, tauMs: number]
  /** voiced stops: burst gain and duration factors (weaker, shorter releases) */
  voicedGain: number
  voicedTau: number
  /** stop closures: constriction 0–1 (1 = only the low-passed voice bar is radiated) */
  closureCl: number
  /** voiced fricatives: constriction 0–1 */
  fricCl: number
  /** corner of the constricted-tract low-pass, Hz, and the low-passed voicing's level */
  clHz: number
  clGain: number
  /** voicing and frication scale in the weak voiced fricatives /v ð/ (recorded: about 15 dB under
   *  the vowel, V1: 8 dB) */
  weakAv: number
  weakAf: number
  /** voicing scale in the voiced sibilants /z ʒ/ */
  sibAv: number
  /** play recorded consonant noise (consonant-noise.ts) instead of synthetic turbulence and
   *  releases; recGain/recBurst set their levels */
  recorded: boolean
  /** with recorded: also replace the fricatives' turbulence (false: releases only) */
  recFric: boolean
  recGain: number
  recBurst: number
  /** depth of the glottal modulation of frication in voiced fricatives (0 = V1's) */
  vmod: number
}

/** V1's consonants: every stage-4 mechanism off. */
export const V1_CONSONANTS: ConsonantSettings = {
  bursts: false,
  replace: false,
  labial: [0, 2.5],
  alveolar: [0, 4],
  velar: [0, 6],
  postalveolar: [0, 4],
  voicedGain: 0.6,
  voicedTau: 0.7,
  closureCl: 0,
  fricCl: 0,
  clHz: 400,
  clGain: 2,
  weakAv: 1,
  weakAf: 1,
  sibAv: 1,
  vmod: 0,
  recorded: false,
  recFric: false,
  recGain: 0.02,
  recBurst: 0.02,
}

/**
 * The default since 4 Nov 2026: stop releases as sample-accurate events playing short recorded
 * releases (CMU ARCTIC awb) in place of the frame-rate burst, at recBurst 0.01 (6 dB under the
 * level matched to the recordings). Judged by Whisper, as Reuben chose: benchmark WER level with V1
 * over three real-Strudel runs (small 17.0% vs 16.7%, base 16.7% vs 17.3%), diagnostic words
 * 46% → 53% (small), minimal pairs 51% → 56% (small). docs/speech/strudel-voice.md, Stage 4.
 */
export const DEFAULT_CONSONANTS: ConsonantSettings = {
  ...V1_CONSONANTS,
  bursts: true,
  replace: true,
  labial: [2.5, 2.5],
  alveolar: [1.0, 4],
  velar: [1.2, 6],
  postalveolar: [0.6, 4],
  recorded: true,
  recBurst: 0.01,
}

const PLACE: Record<string, 'labial' | 'alveolar' | 'velar' | 'postalveolar'> = {
  p: 'labial', b: 'labial', t: 'alveolar', d: 'alveolar', k: 'velar', g: 'velar', tʃ: 'postalveolar', dʒ: 'postalveolar',
}
/** order of the recorded snippets as the instrument indexes them */
export const NOISE_PHONES = ['f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'p', 'b', 't', 'd', 'k', 'g'] as const
/** level trims for the recorded snippets, dB, measured at recGain = recBurst = 0.02 against the
 *  awb recordings (consonant-measure.py: fricative level, burst level) */
export const REC_TRIM_DB: Record<(typeof NOISE_PHONES)[number], number> = {
  f: -10.7, v: -10.5, θ: -8, ð: -7.3, s: -4.4, z: -5.2, ʃ: -1.1, ʒ: -0.5, p: 5, b: 2, t: -1, d: 1.6, k: -7.5, g: -4,
}
const noiseIndex = (ph: string) => (NOISE_PHONES as readonly string[]).indexOf(ph) + 1

const VOICED_STOPS = new Set(['b', 'd', 'g', 'dʒ'])
const VOICED_FRIC = new Set(['v', 'ð', 'z', 'ʒ'])

/**
 * Edit formant frames in place (constriction track, burst windows) and return the release events
 * as the instrument reads them: "time gain tau;…" (seconds, linear, ms).
 */
export function applyConsonants(frames: SynthFrame[], plan: SpeechPlan, voice: SpeechVoice, frameSeconds: number, x: ConsonantSettings): string {
  const segs = plan.segments
  const n = frames.length
  const at = (t: number) => Math.max(0, Math.min(n - 1, Math.round(t / frameSeconds)))
  const strength = voice.articulation.consonantStrength
  const events: string[] = []
  for (const f of frames) {
    f.cl = 0
    f.ns = 0
  }
  segs.forEach((s, i) => {
    if (s.phone === PAUSE || isVowel(s.phone)) return
    const target = CONSONANTS[s.phone]
    if (!target) return
    const end = s.start + s.duration
    if (target.stop) {
      const release = end - Math.min(target.stop.burstMs / 1000, s.duration * 0.5)
      // closure: low-passed voice bar only
      if (x.closureCl > 0) for (let k = at(s.start); k < at(release); k++) frames[k]!.cl = Math.max(frames[k]!.cl ?? 0, x.closureCl)
      if (x.bursts) {
        const [g0, tau0] = x[PLACE[s.phone]!]
        const voiced = VOICED_STOPS.has(s.phone)
        const next = segs[i + 1]
        // a word-final stop before a pause is released weakly (British English), as in V1
        const finalRelease = s.phraseFinal && s.wordFinal && !target.af && (!next || next.phone === PAUSE) ? 0.35 : 1
        const gain = g0 * (voiced ? x.voicedGain : 1) * strength * finalRelease
        const tau = tau0 * (voiced ? x.voicedTau : 1)
        if (gain > 0) events.push(`${release.toFixed(4)} ${gain.toFixed(3)} ${tau.toFixed(2)}${x.recorded && noiseIndex(s.phone) ? ` ${noiseIndex(s.phone)}` : ''}`)
        // the event replaces the frame-rate burst of plain stops; affricates keep their frication
        if (!target.af && x.replace) for (let k = at(release) - 1; k <= at(end) + 1 && k < n; k++) if (k >= 0) frames[k]!.af = 0
      }
    }
    if (x.recorded && x.recFric && !target.stop && noiseIndex(s.phone)) for (let k = at(s.start) - 1; k <= at(end) && k < n; k++) if (k >= 0) frames[k]!.ns = noiseIndex(s.phone)
    if (VOICED_FRIC.has(s.phone)) {
      const weak = s.phone === 'v' || s.phone === 'ð'
      for (let k = at(s.start); k < at(end); k++) {
        const f = frames[k]!
        if (x.fricCl > 0) f.cl = Math.max(f.cl ?? 0, x.fricCl)
        if (weak) {
          f.av *= x.weakAv
          f.af *= x.weakAf
        } else f.av = Math.min(1, f.av * x.sibAv)
      }
    }
  })
  return events.join(';')
}
