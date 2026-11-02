/**
 * Counter-melody: a second line that answers the melody instead of doubling it, adapted from
 * libcantus's generateCounterMelody. Onsets complement the melody (the counter moves where the
 * melody holds or rests, and only now and then reinforces a strong beat with it); pitches are
 * ranked by the same kind of weights libcantus's "pop" profile uses: imperfect consonances
 * (thirds and sixths) against the melody first, chord tones, stepwise motion, contrary motion,
 * and a register below the melody. Where the melody leaves a whole bar empty after a phrase, the
 * counter imitates that phrase a third or a sixth lower: call and response between the two.
 */
import { createRng, type Rng } from '../lib/rng'
import { SCALE_DEGREE_MAX, SCALE_DEGREE_MIN, type MusicGenome, type NoteLayer } from './genome'
import { compositionContext, midiOf, noteHolds, soundingLine } from './context'
import { cellFrom, placeCell } from './motif'

export interface CounterOptions {
  /** Fewest steps between counter onsets (a beat by default): keeps the line uncluttered. */
  minGap?: number
  /** Counter notes per bar to aim for (the line answers in the melody's gaps, up to this many). */
  density?: number
  /** Probability of joining the melody on a strong beat it also attacks. */
  reinforce?: number
  /** Imitate the melody in bars it leaves empty. */
  imitate?: boolean
  gate?: number
}

/** libcantus's pop profile weights. */
const W = {
  imperfect: 2.5,
  perfect: 1,
  dissonance: -2,
  chordTone: 1.5,
  contrary: 1.5,
  oblique: 1.25,
  parallelImperfect: 2,
  stepwise: 0.75,
  distance: -0.2,
  leap: -6,
  drift: -0.02,
}

const mod = (n: number, m: number) => ((n % m) + m) % m
const imperfect = (ic: number) => ic === 3 || ic === 4 || ic === 8 || ic === 9

/** A seed from a line's content, so the same melody always gets the same counter line. */
function lineSeed(g: MusicGenome): number {
  let h = 0x811c9dc5
  for (const d of [...g.melody.notes, ...g.chords.progression, g.scale.root]) {
    h ^= d === null ? 255 : d + 128
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function composeCounter(g: MusicGenome, options: CounterOptions = {}, rng: Rng = createRng(lineSeed(g))): NoteLayer {
  const ctx = compositionContext({ ...g, activeLayers: { ...g.activeLayers, melody: true } })
  const spb = ctx.stepsPerBar
  const n = ctx.steps
  const beat = Math.max(1, spb / 4)
  const half = Math.max(1, beat / 2)
  const minGap = options.minGap ?? beat
  const octave = g.melody.octave
  const melodyMidi = ctx.melodySounding.map((d) => (d === null ? null : midiOf(g, d, octave)))
  const melodyDegrees = g.melody.notes.filter((d): d is number => d !== null)
  const out: (number | null)[] = Array.from({ length: n }, () => null)
  if (melodyDegrees.length === 0) return { notes: out, octave, gate: options.gate ?? 0.8 }
  // A register a sixth or so under the melody's centre
  const mean = melodyDegrees.reduce((a, d) => a + d, 0) / melodyDegrees.length
  const centre = Math.round(mean) - 5
  const lo = Math.max(SCALE_DEGREE_MIN, centre - 5)
  const hi = Math.min(SCALE_DEGREE_MAX, centre + 5)

  // Bars the melody leaves (nearly) empty after a phrase: answer the phrase there
  const imitated = new Set<number>()
  if (options.imitate !== false) {
    for (let bar = 1; bar < g.bars; bar++) {
      const here = g.melody.notes.slice(bar * spb, (bar + 1) * spb).filter((d) => d !== null).length
      const prev = cellFrom(g.melody.notes, (bar - 1) * spb, spb)
      if (here > 1 || !prev || prev.notes.length < 2) continue
      const anchor = (g.melody.notes.slice((bar - 1) * spb, bar * spb).find((d) => d !== null) ?? 2) - rng.pick([2, 2, 5])
      const line: (number | null)[] = Array.from({ length: n }, () => null)
      placeCell(line, prev, bar * spb, anchor, spb, {
        chordTonesAt: (s) => ctx.chordTones[Math.floor(s / spb) % g.bars]!,
        scaleLength: ctx.scaleLength,
        range: [lo, hi],
      })
      // Stay out of the way of the melody's own note in that bar, if it has one
      for (let s = bar * spb; s < (bar + 1) * spb; s++) if (line[s] !== null && !ctx.melodyOnset[s]) out[s] = line[s]!
      imitated.add(bar)
    }
  }

  // Complement onsets elsewhere: per bar, the half-beats where the melody is silent first, then
  // where it holds a note (a beat before an off-beat), now and then a strong beat it also
  // attacks; up to `density` of them, at least `minGap` apart
  const onsets: number[] = []
  const density = options.density ?? 3
  for (let bar = 0; bar < g.bars; bar++) {
    if (imitated.has(bar)) continue
    const cands: { s: number; score: number }[] = []
    for (let s = bar * spb; s < (bar + 1) * spb; s += half) {
      const attacked = ctx.melodyOnset[s]!
      const sounding = ctx.melodySounding[s] !== null
      const whole = s % beat === 0
      let score: number
      if (!attacked && !sounding) score = 3
      else if (!attacked) score = 1.5
      else if (s % (2 * beat) === 0 && rng.chance(options.reinforce ?? 0.35)) score = 1
      else continue
      if (whole) score += 0.75
      cands.push({ s, score: score + rng.next() * 0.5 })
    }
    const picked: number[] = []
    for (const c of cands.sort((a, b) => b.score - a.score)) {
      if (picked.length >= density) break
      if (picked.some((p) => Math.abs(p - c.s) < minGap)) continue
      if (onsets.length && c.s - onsets[onsets.length - 1]! < minGap && c.s < (onsets[onsets.length - 1]! + minGap)) continue
      picked.push(c.s)
    }
    onsets.push(...picked.sort((a, b) => a - b))
  }

  // How long each counter note will sound, so it stays under the melody for all of it
  const marks: (number | null)[] = Array.from({ length: n }, (_, i) => (out[i] !== null || onsets.includes(i) ? 0 : null))
  const holds = noteHolds(marks, options.gate ?? 0.8)
  let prev: number | null = null
  let prevPrev: number | null = null
  let prevMelody: number | null = null
  for (const s of onsets) {
    const bar = Math.floor(s / spb) % g.bars
    const tones = ctx.chordTones[bar]!
    const mel = melodyMidi[s] ?? null
    const melPrev = s > 0 ? (melodyMidi[s - 1] ?? mel) : mel
    const strong = s % beat === 0
    let ceiling = Number.POSITIVE_INFINITY
    for (let k = s; k < Math.min(n, s + holds[s]!); k++) if (melodyMidi[k] !== null) ceiling = Math.min(ceiling, melodyMidi[k]!)
    let best: number | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    for (let d = lo; d <= hi; d++) {
      const p = midiOf(g, d, octave)
      if (p >= ceiling) continue // stay under the melody for as long as the note sounds
      let score = 0
      const ic = mel === null ? null : Math.abs(p - mel) % 12
      if (ic !== null) {
        if (imperfect(ic)) score += W.imperfect
        else if (ic === 0 || ic === 7) score += W.perfect
        else if (ic !== 5) score += W.dissonance * (strong ? 1.5 : 1)
      }
      const chordTone = tones.has(mod(d, ctx.scaleLength))
      if (chordTone) score += W.chordTone
      else if (strong) score -= 2.5
      if (prev !== null) {
        const pp = midiOf(g, prev, octave)
        const move = p - pp
        score += Math.abs(move) * W.distance
        if (move !== 0 && Math.abs(move) <= 2) score += W.stepwise
        // A line, not a pedal: repeating a note is allowed but not preferred, twice is avoided
        if (move === 0) score -= prevPrev === d ? 2.5 : 1
        if (Math.abs(move) > 9) score += W.leap
        if (mel !== null && melPrev !== null && prevMelody !== null) {
          const melMove = mel - melPrev
          if ((move > 0 && melMove < 0) || (move < 0 && melMove > 0)) score += W.contrary
          else if (move === 0 || melMove === 0) score += W.oblique
          else if (ic !== null && imperfect(ic) && imperfect(Math.abs(pp - prevMelody) % 12)) score += W.parallelImperfect
        }
      }
      score += Math.abs(d - centre) * W.drift * 3
      score += rng.next() * 1e-3
      if (score > bestScore) {
        bestScore = score
        best = d
      }
    }
    if (best === null) continue
    out[s] = best
    prevPrev = prev
    prev = best
    prevMelody = mel
  }
  return { notes: out, octave, gate: options.gate ?? 0.8 }
}

/** Share of counter onsets that land on a melody onset (0 = fully complementary). */
export function counterCollisions(g: MusicGenome): number | null {
  if (!g.counter) return null
  const on = g.counter.notes.map((d, i) => (d !== null ? i : -1)).filter((i) => i >= 0)
  if (on.length === 0) return null
  return on.filter((i) => g.melody.notes[i] !== null).length / on.length
}

/** Lowest gap in semitones between the counter and the melody while both sound (negative = crossing). */
export function counterSpacing(g: MusicGenome): number | null {
  if (!g.counter) return null
  const mel = soundingLine(g.melody)
  const ctr = soundingLine(g.counter)
  let min: number | null = null
  for (let i = 0; i < mel.length; i++) {
    if (mel[i] === null || ctr[i] === null) continue
    const gap = midiOf(g, mel[i]!, g.melody.octave) - midiOf(g, ctr[i]!, g.counter.octave)
    min = min === null ? gap : Math.min(min, gap)
  }
  return min
}

/**
 * Give a genome a fresh counter line for its current melody and chords (keeps it on/off as it
 * was). The counter is derived material: it is recomposed whenever the melody or harmony moves.
 */
export function refreshCounter(g: MusicGenome, options?: CounterOptions): MusicGenome {
  if (!g.counter) return g
  // The counter is written in the melody's octave, a sixth or so under it
  g.counter = composeCounter(g, { gate: g.counter.gate, ...options })
  return g
}
