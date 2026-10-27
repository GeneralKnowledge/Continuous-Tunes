/**
 * Contrast material (B): a second version of a song's theme for its drops and choruses.
 * B shares the theme's key, tempo, grid and layers, and differs in melody, chords and groove.
 */
import { evaluateFitness } from './fitness'
import { DEFAULT_MUTATION_CONFIG, mutate, mutateN, type MutationConfig } from './mutation'
import { cloneGenome, SCALE_DEGREE_MAX, SCALE_DEGREE_MIN, type MusicGenome } from '../music/genome'
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

function clampDegree(d: number): number {
  return Math.max(SCALE_DEGREE_MIN, Math.min(SCALE_DEGREE_MAX, d))
}

/**
 * New chords: the progression rotated by half its length, with a substitution or two
 * (a third or a fourth up), so B starts somewhere else harmonically but stays in key.
 */
function reharmonise(progression: readonly number[], rng: Rng): number[] {
  const n = progression.length
  const shift = n > 1 ? Math.floor(n / 2) : 0
  const out = progression.map((_, i) => progression[(i + shift) % n]!)
  for (let i = 0; i < n; i++) {
    if (rng.chance(0.3)) out[i] = (out[i]! + (rng.chance(0.5) ? 2 : 3)) % 7
  }
  if (out.every((d, i) => d === progression[i])) {
    const i = rng.int(0, n - 1)
    out[i] = (out[i]! + 3) % 7
  }
  return out.map(clampDegree)
}

/**
 * A new melody over the new chords: the theme's rhythm (with a note added on each empty beat),
 * each note a chord tone of its bar, moving mostly by small steps.
 */
function newMelody(theme: MusicGenome, progression: readonly number[], rng: Rng): (number | null)[] {
  const spb = theme.stepsPerBar
  const beat = Math.max(1, spb / 4)
  const notes: (number | null)[] = theme.melody.notes.map(() => null)
  let prev = theme.melody.notes.find((d) => d !== null) ?? 4
  for (let i = 0; i < notes.length; i++) {
    const onset = theme.melody.notes[i] !== null || (i % beat === 0 && rng.chance(0.35))
    if (!onset) continue
    const root = progression[Math.floor(i / spb)] ?? 0
    const tones = [root, root + 2, root + 4, root + 7].map((t) => clampDegree(t % 8))
    // Keep some of the theme's notes that still fit the new chord, as a shared motif
    const kept = theme.melody.notes[i]
    if (kept !== null && kept !== undefined && tones.includes(kept) && rng.chance(0.6)) {
      prev = kept
      notes[i] = kept
      continue
    }
    // Prefer tones near the previous note that differ from the theme's note here
    const ranked = tones
      .map((t) => ({ t, cost: Math.abs(t - prev) + (t === theme.melody.notes[i] ? 1 : 0) + rng.next() * 2 }))
      .sort((a, b) => a.cost - b.cost)
    prev = ranked[0]!.t
    notes[i] = prev
  }
  return notes
}

/** The theme with new chords, the bass moved to the new roots and a new melody. */
export function contrastFrom(theme: MusicGenome, rng: Rng): MusicGenome {
  const g = cloneGenome(theme)
  const spb = g.stepsPerBar
  g.chords.progression = reharmonise(theme.chords.progression, rng)
  g.bass.notes = theme.bass.notes.map((d, i) => {
    if (d === null) return null
    const bar = Math.floor(i / spb)
    return clampDegree(d + (g.chords.progression[bar]! - theme.chords.progression[bar]!))
  })
  g.melody.notes = newMelody(theme, g.chords.progression, rng)
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
