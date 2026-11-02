/**
 * Performance: how the parts are *played* rather than what they are. The genome says which
 * drum steps hit and which notes sound; this module turns that into per-hit velocities and
 * micro-timing, the way a player interprets a written part. Everything is a deterministic
 * function of the genome and its genre, so the same genome always performs the same way, and
 * genomes saved before this existed simply gain the performance when they play.
 *
 * Grounded in measurements of the Groove MIDI Dataset (see groove-reference.ts and
 * docs/research/groove-analysis.md):
 * - Timing is mostly systematic, not random: each instrument sits at a characteristic place per
 *   16th position (off-beat 16th hats a little late, backbeats close to the pulse). We apply the
 *   reference style's per-position offsets, scaled per genre, plus a small hashed spread.
 * - Velocity varies hit to hit even at the same position (a spread of ~0.1–0.2 of the range),
 *   on top of the accent shape the genre already defines.
 * - Phrases shape the playing: the fourth bar of a four-bar phrase is the loudest and the most
 *   varied, and ghost notes gather on the 16th before a beat. We lift the phrase's last bar and
 *   add a ghost pickup there in genres that use ghost notes.
 *
 * And between the parts (after Magenta's Drumify / Groove idea that one part's performance is
 * conditioned on another's): the bass breathes with the kick (punches with it in genres that lock
 * to it, ducks in its shadow in genres that steer around it), and melodic lines are shaped with
 * rules from the KTH performance-rule tradition (Friberg et al.): metrical accent, longer notes
 * leaning, high notes louder, phrase-final notes softer.
 */
import type { MusicGenome } from './genome'
import { GROOVE_REFERENCE, type GrooveReference } from './groove-reference'
import { randAt } from './pattern'
import { noteHolds } from './context'
import type { GenreStyle } from './styles'

export interface PerformanceProfile {
  /** GROOVE_REFERENCE style whose timing and phrase shape the genre borrows. */
  reference: string
  /** Share of the reference's per-position timing offsets applied (0 = machine-straight). */
  timing: number
  /** Extra hashed timing spread per hit, ms (kept well under the dataset's ~15–20 ms). */
  jitterMs: number
  /** Share of the reference's hit-to-hit velocity spread applied. */
  velocity: number
  /** Depth of the four-bar phrase shape (1 = as measured, louder last bar). */
  phrase: number
  /** Ghost snare pickups at the end of each four-bar phrase. */
  ghosts: boolean
  /** A closed-hat pickup at the end of each four-bar phrase (programmed genres' phrase marker). */
  hatPickup?: boolean
  /** Depth of the melodic dynamics (lead, counter, arp) and the bass's response to the kick. */
  expression: number
}

export type DrumVoice = 'kick' | 'snare' | 'hihat' | 'perc'

/** A stable number per genome, so two genomes don't share the same "random" spread. */
export function performanceSeed(g: Pick<MusicGenome, 'drums' | 'tempo' | 'genre'>): number {
  let h = 0x811c9dc5 ^ g.tempo
  const fold = (arr: readonly boolean[] | undefined, salt: number) => {
    if (!arr) return
    for (let i = 0; i < arr.length; i++) if (arr[i]) h = Math.imul(h ^ (i * 31 + salt), 0x01000193)
  }
  fold(g.drums.kick, 1)
  fold(g.drums.snare, 2)
  fold(g.drums.hihat, 3)
  fold(g.drums.perc, 4)
  for (const c of g.genre ?? '') h = Math.imul(h ^ c.charCodeAt(0), 0x01000193)
  return h >>> 0
}

/** Roughly normal (−1.7…1.7, sd 1) from two hashes: a spread without long tails. */
function bell(seed: number, time: number, salt: number): number {
  return (randAt(seed, time, salt) + randAt(seed, time, salt + 101) - 1) / 0.408
}

const SALT: Record<DrumVoice, number> = { kick: 11, snare: 23, hihat: 37, perc: 53 }

function reference(p: PerformanceProfile): GrooveReference | undefined {
  return GROOVE_REFERENCE[p.reference] ?? GROOVE_REFERENCE.all
}

function refInstrument(ref: GrooveReference, voice: DrumVoice) {
  return voice === 'kick' ? ref.kick : voice === 'snare' ? ref.snare : ref.hat
}

/** Phrase loudness for the bar at `bar` of the loop (four-bar phrases), around 1. */
export function phraseLevel(p: PerformanceProfile, bar: number): number {
  const ref = reference(p)
  if (!ref || p.phrase <= 0) return 1
  return 1 + p.phrase * 1.5 * ((ref.phraseVelocity[bar % 4] ?? 1) - 1)
}

/**
 * Velocity multiplier for each step of a drum line (1 where it rests): the phrase shape times a
 * hashed hit-to-hit spread of the reference's measured size, relative to its mean level.
 * `firstBar` is the loop bar the steps start on (fills render one bar at a time).
 */
export function drumVelocities(p: PerformanceProfile | undefined, voice: DrumVoice, steps: readonly boolean[], spb: number, seed: number, firstBar = 0): number[] {
  if (!p) return steps.map(() => 1)
  const ref = reference(p)
  const inst = ref ? refInstrument(ref, voice) : undefined
  const played = inst ? inst.velocity.filter((v) => v > 0) : []
  const meanVel = played.length ? played.reduce((a, b) => a + b, 0) / played.length : 0.5
  const spread = inst ? (inst.velocityJitter / meanVel) * p.velocity : 0
  return steps.map((on, i) => {
    if (!on) return 1
    const bar = firstBar + Math.floor(i / spb)
    const t = bar + (i % spb) / spb
    const v = phraseLevel(p, bar) * (1 + spread * 0.5 * bell(seed, t, SALT[voice]))
    return Math.max(0.35, Math.min(1.5, v))
  })
}

/**
 * Micro-timing in seconds for each step of a drum line: the reference style's mean offset at
 * that 16th (scaled by the genre's timing depth) plus a hashed spread. 0 where it rests.
 */
export function drumNudges(p: PerformanceProfile | undefined, voice: DrumVoice, steps: readonly boolean[], spb: number, tempo: number, seed: number, firstBar = 0): number[] {
  if (!p || (p.timing <= 0 && p.jitterMs <= 0)) return steps.map(() => 0)
  const ref = reference(p)
  const inst = ref ? refInstrument(ref, voice) : undefined
  const sixteenth = 60 / tempo / 4
  return steps.map((on, i) => {
    if (!on) return 0
    const s = i % spb
    const pos = Math.round((s * 16) / spb) % 16
    const bar = firstBar + Math.floor(i / spb)
    const sys = inst ? (inst.offset[pos] ?? 0) * p.timing * sixteenth : 0
    const jit = (p.jitterMs / 1000) * bell(seed, bar + s / spb, SALT[voice] + 7)
    return Math.max(-0.025, Math.min(0.025, sys + jit))
  })
}

/**
 * A line with one pickup in the last bar of every four-bar phrase, the bar where the dataset's
 * drummers vary the most: on the last 16th, or else the 16th before beat 3 or the "e" of beat 4
 * (where its ghost notes gather), the first that neither this line nor the kick already plays.
 * Only loops of four bars or more, so the pickup lands on a real phrase end.
 */
export function phrasePickups(line: readonly boolean[], kick: readonly boolean[], spb: number, bars: number): boolean[] {
  const out = [...line]
  if (bars < 4 || spb < 8) return out
  for (let bar = 3; bar < bars; bar += 4) {
    const base = bar * spb
    const at = [spb - 1, spb / 2 - 1, spb - 3].map((s) => base + s).find((i) => !out[i] && !kick[i])
    if (at !== undefined) out[at] = true
  }
  return out
}

/** The snare with ghost pickups at phrase ends, in genres whose profile plays them. */
export function phraseGhosts(p: PerformanceProfile | undefined, snare: readonly boolean[], kick: readonly boolean[], spb: number, bars: number): boolean[] {
  return p?.ghosts ? phrasePickups(snare, kick, spb, bars) : [...snare]
}

/** Metrical weight of a 16th position: bar downbeat, beats, 8ths, 16ths. */
function metric(step: number, spb: number): number {
  const s = step % spb
  const beat = Math.max(1, spb / 4)
  if (s === 0) return 1
  if (s % beat === 0) return 0.6
  if (s % Math.max(1, beat / 2) === 0) return 0.3
  return 0
}

/**
 * Level multiplier per step of a melodic line (1 where it rests), after the KTH rules: notes on
 * strong beats and long notes lean in, the line gets louder as it climbs above its median, and the
 * last note before a rest of a beat or more (a phrase end) relaxes. `expression` scales it all;
 * the result stays within about ±20 %.
 */
export function lineDynamics(notes: readonly (number | null)[], gate: number | undefined, spb: number, expression: number): number[] {
  const out = notes.map(() => 1)
  if (expression <= 0) return out
  const holds = noteHolds(notes, gate)
  const played = notes.filter((n): n is number => n !== null)
  if (played.length < 2) return out
  const sorted = [...played].sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]!
  const beat = Math.max(1, spb / 4)
  notes.forEach((n, i) => {
    if (n === null) return
    let next = i + 1
    while (next < notes.length && notes[next] === null) next++
    const restAfter = next - i - holds[i]!
    let d = 0.1 * metric(i, spb) - 0.05
    d += 0.05 * Math.min(1, (holds[i]! - 1) / beat)
    d += 0.012 * Math.max(-4, Math.min(4, n - med))
    if (restAfter >= beat || next >= notes.length) d -= 0.06
    out[i] = Number((1 + expression * d).toFixed(3))
  })
  return out
}

/**
 * The bass's level against the kick: in genres that lock to the kick, notes struck with it punch
 * and the rest sit back; in genres that steer around it, notes in the kick's shadow (the step
 * after a kick) duck, like a sidechained bass, and the off-beat answers stay full.
 */
export function bassKickDynamics(bass: readonly (number | null)[], kick: readonly boolean[], rule: GenreStyle['bassKick'], spb: number, expression: number): number[] {
  const out = bass.map(() => 1)
  if (expression <= 0 || !kick.some(Boolean)) return out
  bass.forEach((n, i) => {
    if (n === null) return
    let d = 0.04 * metric(i, spb)
    if (rule === 'lock') d += kick[i] ? 0.08 : -0.08
    else if (rule === 'avoid') d += kick[i] || kick[(i - 1 + kick.length) % kick.length] ? -0.15 : 0.03
    out[i] = Number((1 + expression * d).toFixed(3))
  })
  return out
}
