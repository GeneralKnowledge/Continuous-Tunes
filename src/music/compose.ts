/**
 * Composition tools: basslines from a figure that follows the chords and the kick, melodies
 * built from a motif (statement, sequence, answer, cadence), arpeggio patterns, and the
 * harmony-aware edits that mutations and contrast material use.
 * Everything works in the genome's own terms: scale degrees on a step grid.
 */
import type { Rng } from '../lib/rng'
import { SCALE_DEGREE_MAX, SCALE_DEGREE_MIN, type MusicGenome } from './genome'
import { barChordTones } from './harmony'
import { getStyle } from './styles'
import { arpIndices, degreeToMidi, diatonicChord, invertDegrees, scaleLength, sequenceDegrees, type ArpContour } from './theory'

type Harmonic = Pick<MusicGenome, 'scale' | 'chords' | 'bars' | 'genre' | 'stepsPerBar'>

export function clampDegree(d: number): number {
  return Math.max(SCALE_DEGREE_MIN, Math.min(SCALE_DEGREE_MAX, d))
}

const mod = (n: number, m: number) => ((n % m) + m) % m

/** Is a step on a quarter-note beat? */
export function onBeat(step: number, stepsPerBar: number): boolean {
  return step % Math.max(1, stepsPerBar / 4) === 0
}

/** Tokens of one bar's template resampled to the grid (16-token templates on an 8-step grid read every other token). */
function barTokens(template: string, stepsPerBar: number): string[] {
  const t = template.trim()
  const tokens = /\s/.test(t) ? t.split(/\s+/) : [...t]
  return Array.from({ length: stepsPerBar }, (_, s) => tokens[Math.floor((s * tokens.length) / stepsPerBar)] ?? '-')
}

/** True where a one-bar template ("x---x---…" or space-separated) has a hit, across the whole loop. */
export function hits(template: string, length: number, stepsPerBar = 16): boolean[] {
  const chars = template.replace(/\s+/g, '')
  return Array.from({ length }, (_, i) => {
    const s = i % stepsPerBar
    const c = chars[Math.floor((s * chars.length) / stepsPerBar) % chars.length]!
    return c === 'x' || c === 'X'
  })
}

// ─── Bass ───────────────────────────────────────────────────────────

/**
 * A bassline from one-bar figures (one per bar, cycling) that follow each bar's chord root.
 * Tokens: `-` rest, `R` root, `o` root an octave up, `3` third, `5` fifth, `7` seventh,
 * `b` fifth below the root, `A` a scale step into the next bar's root (approach note),
 * `P` a passing note halfway to the next bar's root.
 * With the genre's bass set to avoid the kick, onsets that land on a kick move to the next free step.
 */
export function composeBass(
  g: Harmonic & Pick<MusicGenome, 'drums' | 'bass'>,
  figures: readonly string[],
): (number | null)[] {
  const spb = g.stepsPerBar
  const len = scaleLength(g.scale.mode)
  const prog = g.chords.progression
  const out: (number | null)[] = []
  // Each root in the octave that keeps the line near the tonic (a fourth above it at most)
  const centre = degreeToMidi(g.scale, 0, g.bass.octave) + 5
  const place = (d: number) =>
    [d, d - len].sort(
      (a, b) =>
        Math.abs(degreeToMidi(g.scale, a, g.bass.octave) - centre) - Math.abs(degreeToMidi(g.scale, b, g.bass.octave) - centre),
    )[0]!
  for (let bar = 0; bar < g.bars; bar++) {
    const root = place(prog[bar] ?? 0)
    const nextRoot = place(prog[(bar + 1) % g.bars] ?? 0)
    // Approach the next root from the nearer side (an octave either way)
    const target = [nextRoot, nextRoot - len, nextRoot + len].sort((a, b) => Math.abs(a - root) - Math.abs(b - root))[0]!
    const tokens = barTokens(figures[bar % figures.length]!, spb)
    for (const t of tokens) {
      switch (t) {
        case 'R':
          out.push(root)
          break
        case 'o':
          out.push(root + len)
          break
        case '3':
          out.push(root + 2)
          break
        case '5':
          out.push(root + (len === 5 ? 3 : 4))
          break
        case '7':
          out.push(root + (len === 5 ? 4 : 6))
          break
        case 'b':
          out.push(root - (len === 5 ? 2 : 3))
          break
        case 'A':
          out.push(target === root ? root + 1 : target > root ? target - 1 : target + 1)
          break
        case 'P':
          out.push(target === root ? root + 2 : Math.round((root + target) / 2))
          break
        default:
          out.push(null)
      }
    }
  }
  const notes = out.map((d) => (d === null ? null : clampDegree(d)))
  return getStyle(g.genre).bassKick === 'avoid' ? dodgeKick(notes, g.drums.kick, spb) : notes
}

/** Move bass onsets that coincide with a kick to the next free off-kick step in the same bar (or drop them). */
export function dodgeKick(notes: (number | null)[], kick: readonly boolean[], stepsPerBar: number): (number | null)[] {
  const out = [...notes]
  for (let i = 0; i < out.length; i++) {
    if (out[i] === null || out[i] === undefined || !kick[i]) continue
    const barEnd = (Math.floor(i / stepsPerBar) + 1) * stepsPerBar
    let j = i + 1
    while (j < barEnd && (kick[j] || out[j] !== null)) j++
    if (j < barEnd && j - i <= 2) out[j] = out[i]!
    out[i] = null
  }
  return out
}

/** Share of bass onsets that land on a kick (0–1); null without bass notes. */
export function bassKickOverlap(notes: readonly (number | null)[], kick: readonly boolean[]): number | null {
  let on = 0
  let both = 0
  notes.forEach((n, i) => {
    if (n === null) return
    on++
    if (kick[i]) both++
  })
  return on === 0 ? null : both / on
}

// ─── Melody ─────────────────────────────────────────────────────────

/** What one bar of a phrase does with the motif. */
export type PhraseBar =
  | 'statement' // the motif on this bar's chord
  | 'sequence' // the motif moved with the harmony (diatonic sequence)
  | 'answer' // the motif mirrored (diatonic inversion): the response to the call
  | 'cadence' // the motif's opening, then a resolution onto the chord's root or third
  | 'rest' // space

export interface Motif {
  /** One bar of rhythm: x = note, - = rest (16 or 8 characters). */
  rhythm: string
  /** Degrees relative to the anchor, one per onset. */
  shape: readonly number[]
}

/**
 * Snap the notes on strong beats to the nearest tone of their bar's chord, so a line always
 * lands on the harmony where it is heard most; off-beat notes stay as passing tones.
 */
export function snapToChords(g: Harmonic, notes: readonly (number | null)[], everyBeat = true): (number | null)[] {
  const tones = barChordTones(g)
  const len = scaleLength(g.scale.mode)
  const spb = g.stepsPerBar
  return notes.map((n, i) => {
    if (n === null) return null
    const strong = i % spb === 0 || (everyBeat && onBeat(i % spb, spb))
    if (!strong) return n
    const set = tones[Math.floor(i / spb) % g.bars]!
    if (set.has(mod(n, len))) return n
    for (const d of [1, -1, 2, -2]) if (set.has(mod(n + d, len))) return clampDegree(n + d)
    return n
  })
}

/**
 * A melody from a motif and a phrase plan (one entry per bar, cycling). Each bar anchors the
 * motif on a tone of its chord near where the line already is, then transforms it as planned
 * (MusicTheoryJS diatonic sequence and inversion). Strong beats are snapped to the chords.
 */
export function composeMelody(
  g: Harmonic,
  motif: Motif,
  plan: readonly PhraseBar[],
  options: { anchor?: number; range?: readonly [number, number] } = {},
): (number | null)[] {
  const spb = g.stepsPerBar
  const len = scaleLength(g.scale.mode)
  const [lo, hi] = options.range ?? [-1, len + 4]
  const tones = barChordTones(g)
  const rhythm = hits(motif.rhythm, spb, spb)
  const onsets = rhythm.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)
  let anchor = options.anchor ?? 2
  const out: (number | null)[] = []
  for (let bar = 0; bar < g.bars; bar++) {
    const kind = plan[bar % plan.length]!
    const bar0: (number | null)[] = Array.from({ length: spb }, () => null)
    if (kind === 'rest') {
      out.push(...bar0)
      continue
    }
    // Anchor: the chord tone nearest the previous anchor
    const set = tones[bar]!
    const cands: number[] = []
    for (let d = lo; d <= hi; d++) if (set.has(mod(d, len))) cands.push(d)
    const nearest = cands.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0] ?? anchor
    let shape = onsets.map((_, k) => motif.shape[k % motif.shape.length]!)
    let base = nearest
    if (kind === 'sequence') {
      const step = (g.chords.progression[bar] ?? 0) - (g.chords.progression[(bar + g.bars - 1) % g.bars] ?? 0)
      shape = sequenceDegrees(g.scale, shape, Math.max(-3, Math.min(3, step))).map((d) => d ?? 0)
      base = anchor
    } else if (kind === 'answer') {
      shape = invertDegrees(g.scale, shape, 0).map((d) => d ?? 0)
    } else if (kind === 'cadence') {
      const keep = Math.max(1, Math.ceil(onsets.length / 2))
      shape = shape.slice(0, keep)
    }
    onsets.forEach((s, k) => {
      if (k >= shape.length) return
      bar0[s] = clampDegree(Math.max(lo, Math.min(hi, base + shape[k]!)))
    })
    if (kind === 'cadence') {
      // Resolve: the last onset falls on the root (or third) of the chord, from above if possible
      const last = onsets[Math.min(onsets.length - 1, shape.length)] ?? onsets[onsets.length - 1]!
      const prev = bar0.slice(0, last).filter((d): d is number => d !== null).pop() ?? base
      const goals = cands.filter((d) => mod(d - (g.chords.progression[bar] ?? 0), len) === 0 || mod(d - (g.chords.progression[bar] ?? 0), len) === 2)
      bar0[last] = goals.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev))[0] ?? prev
    }
    const placed = bar0.filter((d): d is number => d !== null)
    anchor = placed[placed.length - 1] ?? anchor
    out.push(...bar0)
  }
  return snapToChords(g, out)
}

/** The rhythm and shape of the bar of a melody with the most notes, as a motif (for developing it). */
export function extractMotif(g: Pick<MusicGenome, 'stepsPerBar' | 'bars'>, notes: readonly (number | null)[]): Motif | null {
  const spb = g.stepsPerBar
  let best = -1
  let bestCount = 0
  for (let bar = 0; bar < g.bars; bar++) {
    const count = notes.slice(bar * spb, (bar + 1) * spb).filter((n) => n !== null).length
    if (count > bestCount) {
      best = bar
      bestCount = count
    }
  }
  if (best < 0) return null
  const slice = notes.slice(best * spb, (best + 1) * spb)
  const first = slice.find((n) => n !== null)!
  return {
    rhythm: slice.map((n) => (n === null ? '-' : 'x')).join(''),
    shape: slice.filter((n): n is number => n !== null).map((n) => n - first),
  }
}

// ─── Arpeggios ──────────────────────────────────────────────────────

/** An arpeggio pattern: contour over the chord's tones on the onsets of a one-bar rhythm. */
export function arpPattern(
  g: Pick<MusicGenome, 'stepsPerBar' | 'bars'>,
  contour: ArpContour,
  rhythm: string,
  tones = 4,
  octaves = 2,
): (number | null)[] {
  const spb = g.stepsPerBar
  const on = hits(rhythm, spb, spb)
  const count = on.filter(Boolean).length
  const seq = arpIndices(contour, tones, octaves, Math.max(1, count))
  const bar: (number | null)[] = []
  let k = 0
  for (let s = 0; s < spb; s++) bar.push(on[s] ? Math.min(11, seq[k++ % seq.length]!) : null)
  return Array.from({ length: g.bars }, () => bar).flat()
}

// ─── Harmony-aware edits ────────────────────────────────────────────

/**
 * Move a line from one progression to another: each note keeps its function relative to its
 * bar's chord root (root stays root, fifth stays fifth), and approach notes at the end of a bar
 * are re-aimed at the new next root.
 */
export function rebaseLine(
  g: Pick<MusicGenome, 'stepsPerBar' | 'bars' | 'scale'>,
  notes: readonly (number | null)[],
  from: readonly number[],
  to: readonly number[],
): (number | null)[] {
  const spb = g.stepsPerBar
  const len = scaleLength(g.scale.mode)
  const out = notes.map((d, i) => {
    if (d === null) return null
    const bar = Math.floor(i / spb)
    return clampDegree(d + (to[bar]! - from[bar]!))
  })
  for (let bar = 0; bar < g.bars; bar++) {
    // The last onset of the bar: was it a step into the old next root?
    let last = -1
    for (let s = spb - 1; s >= spb / 2; s--) if (notes[bar * spb + s] !== null) { last = bar * spb + s; break }
    if (last < 0) continue
    const oldNext = from[(bar + 1) % g.bars]!
    const newNext = to[(bar + 1) % g.bars]!
    const d = notes[last]!
    const gap = [oldNext, oldNext + len, oldNext - len].map((t) => d - t).find((x) => Math.abs(x) === 1)
    if (gap !== undefined) {
      const near = [newNext, newNext + len, newNext - len].sort((a, b) => Math.abs(a - out[last]!) - Math.abs(b - out[last]!))[0]!
      out[last] = clampDegree(near + gap)
    }
  }
  return out
}

/**
 * A substitute for one chord: a close relative (a third up or down,
 * sharing two tones) or other chords of the genre's vocabulary, keeping the first bar's home
 * chord most of the time so the loop still resolves.
 */
export function substituteChord(
  g: Harmonic,
  bar: number,
  rng: Rng,
  neighbours: readonly (number | undefined)[] = [],
): number {
  const len = scaleLength(g.scale.mode)
  const cur = g.chords.progression[bar] ?? 0
  // Never the chord next door: two bars of the same chord is a held chord, not a change
  // Diminished chords only when the genre has them in its vocabulary for this mode
  const vocab = getStyle(g.genre).harmony.vocabulary.filter(
    (d) => d < len && !neighbours.includes(d) && !['dim', 'halfdim'].includes(diatonicChord(g.scale, d).family),
  )
  const relatives = [mod(cur + 2, len), mod(cur - 2, len)].filter((d) => vocab.includes(d))
  const pool = rng.chance(0.65) && relatives.length > 0 ? relatives : vocab.filter((d) => d !== cur)
  return pool.length > 0 ? rng.pick(pool) : cur
}
