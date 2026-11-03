/**
 * The shared acoustic representation: a SpeechPlan is what every synthesis backend consumes.
 *
 * It holds timed phone segments (with their linguistic position and stress), a pitch contour and
 * the word/sentence timing, all independent of how sound is made. A formant backend turns segments
 * into articulatory targets; a diphone backend (M2) would pick units between neighbouring
 * segments and PSOLA them to the same durations and pitch.
 */
import type { Stress } from './phonemes'

/** Phone id for silence (pauses at boundaries, leading and trailing silence). */
export const PAUSE = '_'

export interface PlanSegment {
  /** Phoneme id from phonemes.ts, or PAUSE */
  phone: string
  /** Seconds from the start of the utterance */
  start: number
  duration: number
  /** Lexical stress of the syllable this phone belongs to */
  stress: Stress
  /** Pitch-accented syllable (content word stress or emphasis) */
  accented: boolean
  role: 'onset' | 'nucleus' | 'coda' | 'pause'
  /** Index into SpeechPlan.words, or -1 for pauses */
  word: number
  wordInitial: boolean
  wordFinal: boolean
  phraseFinal: boolean
}

export interface PitchPoint {
  time: number
  hz: number
}

export interface PlanWord {
  text: string
  start: number
  end: number
  phones: string
}

export interface PlanSentence {
  text: string
  type: 'statement' | 'question' | 'exclamation'
  start: number
  end: number
}

export interface SpeechPlan {
  /** Total length in seconds, including leading and trailing silence */
  duration: number
  segments: PlanSegment[]
  /** f0 targets in time order; linear between points, held outside them */
  pitch: PitchPoint[]
  words: PlanWord[]
  sentences: PlanSentence[]
}

/** f0 at time t, interpolated from the plan's pitch points. */
export function pitchAt(points: readonly PitchPoint[], t: number): number {
  if (points.length === 0) return 120
  if (t <= points[0]!.time) return points[0]!.hz
  const last = points[points.length - 1]!
  if (t >= last.time) return last.hz
  // binary search for the segment containing t
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid]!.time <= t) lo = mid
    else hi = mid
  }
  const a = points[lo]!
  const b = points[hi]!
  const u = b.time > a.time ? (t - a.time) / (b.time - a.time) : 0
  return a.hz + (b.hz - a.hz) * u
}
