/**
 * Contrast material (B): a second version of a song's theme for its drops and choruses.
 * B shares the theme's key, tempo, grid and layers, and differs in melody, chords and groove.
 */
import { evaluateFitness } from './fitness'
import { DEFAULT_MUTATION_CONFIG, mutate, mutateN, type MutationConfig } from './mutation'
import { CHORD_ROOT_MAX, CHORD_ROOT_MIN, cloneGenome, type MusicGenome } from '../music/genome'
import { composeMelody, extractMotif, rebaseLine, type PhraseBar } from '../music/compose'
import { getStyle } from '../music/styles'
import { scaleLength } from '../music/theory'
import type { Personality } from '../music/personality'
import { validateGenome } from '../music/validation'
import { createRng, type Rng } from '../lib/rng'

/** Only the parts change: no tempo, key, layer or loop-length changes. */
export const CONTRAST_MUTATION: MutationConfig = {
  ...DEFAULT_MUTATION_CONFIG,
  categoryWeights: {
    rhythm: 0.6,
    bass: 0.6,
    melody: 1.4,
    chords: 1,
    tempo: 0,
    scale: 0,
    layers: 0,
    parameters: 0,
  },
}

export interface ContrastMetrics {
  /** Share of melody steps that differ (0–1). */
  melody: number
  /** Share of chord roots that differ (0–1). */
  chords: number
  /** Share of drum and bass steps that differ (0–1). */
  rhythm: number
  /** How well B contrasts with A: 1 when each difference sits in its sweet spot. */
  score: number
}

function diffShare<T>(a: readonly T[], b: readonly T[], counts: (x: T, y: T) => boolean = () => true): number {
  const n = Math.max(a.length, b.length)
  if (n === 0) return 0
  let differ = 0
  let considered = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] as T
    const y = b[i] as T
    if (!counts(x, y)) continue
    considered++
    if (x !== y) differ++
  }
  return considered === 0 ? 0 : differ / considered
}

/** 1 inside [lo, hi], falling off linearly to 0 at `width` outside it. */
function sweet(x: number, lo: number, hi: number, width = 0.35): number {
  if (x >= lo && x <= hi) return 1
  const d = x < lo ? lo - x : x - hi
  return Math.max(0, 1 - d / width)
}

function clampRoot(d: number): number {
  return Math.max(CHORD_ROOT_MIN, Math.min(CHORD_ROOT_MAX, d))
}

/**
 * New chords: the progression rotated by half its length (by whole chord changes, so two-bar
 * chords stay two bars), with a substitution or two from the genre's vocabulary (a chord a
 * third away shares two tones), so B starts somewhere else harmonically but stays in key and
 * in the genre's language.
 */
function reharmonise(theme: MusicGenome, rng: Rng): number[] {
  const progression = theme.chords.progression
  const n = progression.length
  const len = scaleLength(theme.scale.mode)
  const vocab = getStyle(theme.genre).harmony.vocabulary.filter((d) => d < len)
  const shift = n > 1 ? Math.floor(n / 2) : 0
  const out = progression.map((_, i) => progression[(i + shift) % n]!)
  const span = n >= 8 && progression.every((d, i) => i % 2 === 0 || d === progression[i - 1]) ? 2 : 1
  for (let i = 0; i < n; i += span) {
    if (!rng.chance(0.3)) continue
    // A relative that doesn't just repeat the chord before or after it
    const prev = out[(i - 1 + n) % n]!
    const next = out[(i + span) % n]!
    const relatives = [(out[i]! + 2) % len, (out[i]! + len - 2) % len].filter(
      (d) => vocab.includes(d) && d !== prev && d !== next,
    )
    if (relatives.length === 0) continue
    const pick = rng.pick(relatives)
    for (let k = 0; k < span; k++) out[i + k] = pick
  }
  if (out.every((d, i) => d === progression[i])) {
    const i = rng.int(0, n / span - 1) * span
    for (let k = 0; k < span; k++) out[i + k] = (out[i]! + 3) % len
  }
  return out.map(clampRoot)
}

/** Phrase plans for B's melody: the theme's motif answered and developed over the new chords. */
const B_PLANS: readonly (readonly PhraseBar[])[] = [
  ['statement', 'answer', 'sequence', 'cadence'],
  ['statement', 'sequence', 'answer', 'cadence'],
  ['answer', 'statement', 'sequence', 'cadence'],
]

/**
 * A new melody over the new chords, built from the theme's motif (its busiest bar's rhythm and
 * shape): stated, answered by its mirror image (MusicTheoryJS diatonic inversion), moved
 * through the scale with the harmony, and closed with a cadence. Related to A, but a new tune.
 */
function newMelody(theme: MusicGenome, b: MusicGenome, rng: Rng): (number | null)[] {
  const motif = extractMotif(theme, theme.melody.notes)
  if (!motif) return theme.melody.notes.map(() => null)
  // Give the motif a pickup or an extra note sometimes, so B's rhythm isn't A's exactly
  const rhythm = [...motif.rhythm]
  const free = rhythm.map((c, i) => (c === '-' && i % 2 === 0 ? i : -1)).filter((i) => i >= 0)
  let shape = [...motif.shape]
  if (free.length && rng.chance(0.6)) {
    const at = rng.pick(free)
    rhythm[at] = 'x'
    const k = rhythm.slice(0, at).filter((c) => c === 'x').length
    shape = [...shape.slice(0, k), (shape[k - 1] ?? 0) + rng.pick([1, 2, -1]), ...shape.slice(k)]
  }
  const plan = rng.pick(B_PLANS)
  const anchor = (theme.melody.notes.find((d) => d !== null) ?? 2) + rng.pick([0, 2])
  const bars = b.bars >= 8 ? plan.flatMap((p) => [p, p === 'cadence' ? 'cadence' : 'rest'] as PhraseBar[]) : plan
  return composeMelody(b, { rhythm: rhythm.join(''), shape }, bars, { anchor })
}

/** The theme with new chords, the bass moved to the new roots and a new melody. */
export function contrastFrom(theme: MusicGenome, rng: Rng): MusicGenome {
  const g = cloneGenome(theme)
  g.chords.progression = reharmonise(theme, rng)
  if (g.chords.colors) g.chords.colors = g.chords.colors.map(() => null)
  // The bass keeps its figure: each note keeps its role in the new chord, approach notes re-aim
  g.bass.notes = rebaseLine(g, theme.bass.notes, theme.chords.progression, g.chords.progression)
  g.melody.notes = newMelody(theme, g, rng)
  validateGenome(g)
  return g
}

export function contrastMetrics(a: MusicGenome, b: MusicGenome): ContrastMetrics {
  // Steps where both are silent say nothing about the melody
  const melody = diffShare(a.melody.notes, b.melody.notes, (x, y) => x !== null || y !== null)
  const chords = diffShare(a.chords.progression, b.chords.progression)
  const rhythm =
    (diffShare(a.drums.kick, b.drums.kick) +
      diffShare(a.drums.snare, b.drums.snare) +
      diffShare(a.drums.hihat, b.drums.hihat) +
      diffShare(a.bass.notes, b.bass.notes)) /
    4
  const sameFrame =
    a.tempo === b.tempo &&
    a.scale.root === b.scale.root &&
    a.scale.mode === b.scale.mode &&
    a.bars === b.bars &&
    a.stepsPerBar === b.stepsPerBar
  // A new melody over partly new chords, with a recognisably related groove.
  // Without a melody layer the chords and groove carry the contrast.
  const parts = a.activeLayers.melody
    ? 0.5 * sweet(melody, 0.4, 0.85) + 0.3 * sweet(chords, 0.25, 0.75) + 0.2 * sweet(rhythm, 0.05, 0.35)
    : 0.65 * sweet(chords, 0.25, 0.75) + 0.35 * sweet(rhythm, 0.05, 0.35)
  const score = sameFrame ? parts : 0
  return { melody, chords, rhythm, score: Number(score.toFixed(4)) }
}

export interface ContrastOptions {
  personality?: Personality
  /** Candidates tried; the best by fitness and contrast wins. */
  candidates?: number
  /** Extra small mutations per candidate, on top of the new chords and melody. */
  steps?: number
}

export interface Contrast {
  genome: MusicGenome
  metrics: ContrastMetrics
  fitness: number
}

/** Derive contrast material from a theme. Deterministic for a given seed. */
export function deriveContrast(theme: MusicGenome, seed: number, options: ContrastOptions = {}): Contrast {
  const rng = createRng(seed)
  const candidates = options.candidates ?? 8
  const steps = options.steps ?? 2
  let best: Contrast | null = null
  let bestScore = -1
  for (let i = 0; i < candidates; i++) {
    const genome = mutateN(contrastFrom(theme, rng), rng, steps, {
      intensity: 'small',
      config: CONTRAST_MUTATION,
      personality: options.personality,
    }).genome
    const metrics = contrastMetrics(theme, genome)
    const fitness = evaluateFitness(genome, options.personality).score
    const score = 0.5 * fitness + 0.5 * metrics.score
    if (score > bestScore) {
      best = { genome, metrics, fitness }
      bestScore = score
    }
  }
  return best!
}

/** A small change to B for its next appearance, so the second drop isn't identical to the first. */
export function varyContrast(b: MusicGenome, seed: number, personality?: Personality): MusicGenome {
  return mutate(b, createRng(seed), { intensity: 'small', config: CONTRAST_MUTATION, personality }).genome
}
