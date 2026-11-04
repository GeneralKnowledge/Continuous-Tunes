/**
 * Expression layer for the Strudel voice: shapes voice quality, loudness and micro-pitch from the
 * plan's linguistic structure, on top of the articulation frames. Stress then changes more than
 * duration: stressed vowels are louder and tenser, unstressed ones softer and laxer, and phrase
 * ends relax towards a breathier, quieter voice. Nothing here makes sound; it edits control
 * frames that the instrument plays.
 *
 * Sources:
 * - Voice quality by prominence and position: tenser phonation (lower Rd) on accented syllables,
 *   laxer and breathier at phrase ends (Gobl & Ní Chasaide 2003; Fant 1995's Rd scale;
 *   Sluijter & van Heuven 1996 on spectral balance as a stress cue).
 * - Microprosody: f0 is raised at the onset of a vowel after a voiceless obstruent and lowered
 *   in and after voiced obstruents (Lehiste & Peterson 1961; House & Fairbanks 1953). Listeners
 *   use these as voicing cues (Haggard et al. 1970), which our weakest contrasts need.
 */
import { isVowel, isVoiced, mannerOf } from '../../phonemes'
import { PAUSE, type SpeechPlan } from '../../plan'
import type { SynthFrame } from '../../backends/formant/klatt'

export interface ExpressionSettings {
  /** Rd change on accented vowels (negative = tenser) */
  accentRd: number
  /** Rd change on unstressed vowels */
  unstressedRd: number
  /** Rd change towards the end of a phrase-final syllable */
  finalRd: number
  /** voicing level change, dB */
  accentDb: number
  unstressedDb: number
  finalDb: number
  /** f0 raise after voiceless obstruents and dip in voiced obstruents, as a fraction of f0 */
  microRaise: number
  microDip: number
}

export const DEFAULT_EXPRESSION: ExpressionSettings = {
  accentRd: -0.15,
  unstressedRd: 0.15,
  finalRd: 0.45,
  accentDb: 1.5,
  unstressedDb: -2.5,
  finalDb: -4,
  microRaise: 0.06,
  microDip: 0.05,
}

const OBSTRUENT = new Set(['stop', 'fricative', 'affricate'])
const isObstruent = (p: string) => p !== PAUSE && !isVowel(p) && OBSTRUENT.has(mannerOf(p) as string)

/** Edit formant frames (5 ms) in place: per-frame Rd, voicing level and f0. */
export function applyExpression(frames: SynthFrame[], plan: SpeechPlan, rd: number, frameSeconds: number, x: ExpressionSettings = DEFAULT_EXPRESSION): void {
  const segs = plan.segments
  const n = frames.length
  const dRd = new Float64Array(n)
  const dDb = new Float64Array(n)
  const dF0 = new Float64Array(n)
  const at = (t: number) => Math.max(0, Math.min(n - 1, Math.round(t / frameSeconds)))
  // smooth bump: 0 at the edges of [a, b], 1 in the middle part
  const bump = (arr: Float64Array, a: number, b: number, v: number, edge = 0.02) => {
    for (let k = at(a - edge); k <= at(b + edge); k++) {
      const t = k * frameSeconds
      const w = t < a ? (t - (a - edge)) / edge : t > b ? (b + edge - t) / edge : 1
      arr[k] = arr[k]! + v * Math.max(0, Math.min(1, w))
    }
  }
  segs.forEach((s, i) => {
    const end = s.start + s.duration
    if (isVowel(s.phone)) {
      if (s.accented) {
        bump(dRd, s.start, end, x.accentRd)
        bump(dDb, s.start, end, x.accentDb)
      } else if (s.stress === 0) {
        bump(dRd, s.start, end, x.unstressedRd)
        bump(dDb, s.start, end, x.unstressedDb)
      }
      // the last vowel of a phrase relaxes over its second half
      const last = segs.slice(i + 1).findIndex((q) => isVowel(q.phone) || q.phone === PAUSE)
      const nextIsPause = last >= 0 && segs[i + 1 + last]!.phone === PAUSE
      if (s.phraseFinal || nextIsPause) {
        const mid = s.start + s.duration * 0.4
        for (let k = at(mid); k <= at(end + 0.03); k++) {
          const u = Math.min(1, (k * frameSeconds - mid) / Math.max(0.02, end - mid))
          dRd[k] = dRd[k]! + x.finalRd * u
          dDb[k] = dDb[k]! + x.finalDb * u
        }
      }
      // microprosody at the vowel onset, set by the preceding consonant
      const prev = segs[i - 1]
      if (prev && isObstruent(prev.phone)) {
        const v = isVoiced(prev.phone) ? -x.microDip : x.microRaise
        for (let k = at(s.start); k <= at(s.start + 0.06); k++) {
          const u = 1 - (k * frameSeconds - s.start) / 0.06
          dF0[k] = dF0[k]! + v * Math.max(0, u)
        }
      }
    } else if (s.phone !== PAUSE && isObstruent(s.phone) && isVoiced(s.phone)) {
      bump(dF0, s.start, end, -x.microDip, 0.015)
    }
  })
  for (let k = 0; k < n; k++) {
    const f = frames[k]!
    f.rd = Math.max(0.3, Math.min(2.7, (f.rd ?? rd) + dRd[k]!))
    f.av *= 10 ** (dDb[k]! / 20)
    f.f0 *= 1 + dF0[k]!
  }
}
