import type { MusicGenome } from '../music/genome'
import type { FitnessSweetSpots, Personality } from '../music/personality'

export interface FitnessMetrics {
  repetition: number
  density: number
  rhythmicComplexity: number
  melodicComplexity: number
  harmonicConsistency: number
  variety: number
}

export interface FitnessResult {
  score: number
  metrics: FitnessMetrics
}

function densityOfBool(arr: boolean[]): number {
  if (arr.length === 0) return 0
  return arr.filter(Boolean).length / arr.length
}

function densityOfNotes(arr: (number | null)[]): number {
  if (arr.length === 0) return 0
  return arr.filter((n) => n !== null).length / arr.length
}

/** Fraction of steps that match the previous bar (high = repetitive). */
function barRepetition(arr: boolean[], stepsPerBar: number): number {
  if (arr.length < stepsPerBar * 2) return 0.5
  const bars = Math.floor(arr.length / stepsPerBar)
  let matches = 0
  let total = 0
  for (let b = 1; b < bars; b++) {
    for (let i = 0; i < stepsPerBar; i++) {
      total++
      if (arr[b * stepsPerBar + i] === arr[(b - 1) * stepsPerBar + i]) matches++
    }
  }
  return total === 0 ? 0.5 : matches / total
}

function noteBarRepetition(arr: (number | null)[], stepsPerBar: number): number {
  if (arr.length < stepsPerBar * 2) return 0.5
  const bars = Math.floor(arr.length / stepsPerBar)
  let matches = 0
  let total = 0
  for (let b = 1; b < bars; b++) {
    for (let i = 0; i < stepsPerBar; i++) {
      total++
      if (arr[b * stepsPerBar + i] === arr[(b - 1) * stepsPerBar + i]) matches++
    }
  }
  return total === 0 ? 0.5 : matches / total
}

/** Syncopation-ish: hits on offbeats / total hits. */
function syncopation(arr: boolean[], stepsPerBar: number): number {
  let hits = 0
  let off = 0
  for (let i = 0; i < arr.length; i++) {
    if (!arr[i]) continue
    hits++
    const step = i % stepsPerBar
    if (step % 2 === 1 || step % 4 === 2) off++
  }
  return hits === 0 ? 0 : off / hits
}

function uniqueRatio(arr: (number | null)[]): number {
  const filled = arr.filter((n): n is number => n !== null)
  if (filled.length === 0) return 0
  return new Set(filled).size / filled.length
}

function melodicIntervalVariety(arr: (number | null)[]): number {
  const filled: number[] = []
  for (const n of arr) if (n !== null) filled.push(n)
  if (filled.length < 2) return 0
  const intervals = new Set<number>()
  for (let i = 1; i < filled.length; i++) {
    intervals.add(Math.abs(filled[i]! - filled[i - 1]!))
  }
  // Cap at 5 distinct interval sizes as "full variety"
  return Math.min(1, intervals.size / 5)
}

/** Chord progression uses diatonic degrees sensibly (0,2,3,4,5 common). */
function harmonicConsistency(genome: MusicGenome): number {
  if (!genome.activeLayers.chords) return 0.6
  const common = new Set([0, 2, 3, 4, 5])
  const prog = genome.chords.progression
  if (prog.length === 0) return 0
  const ok = prog.filter((d) => common.has(d)).length
  // Mild bonus if not all the same chord
  const unique = new Set(prog).size
  const uniqueness = Math.min(1, unique / Math.min(4, prog.length))
  return 0.6 * (ok / prog.length) + 0.4 * uniqueness
}

function activeLayerCount(g: MusicGenome): number {
  return Object.values(g.activeLayers).filter(Boolean).length
}

/**
 * Evaluate genome with transparent musical heuristics.
 * Not "more complexity = better" — scores against sweet spots and
 * penalises empty chaos and total stasis.
 */
export function evaluateFitness(
  genome: MusicGenome,
  personality?: Personality,
): FitnessResult {
  const spots: FitnessSweetSpots = personality?.sweetSpots ?? {
    density: 0.4,
    rhythmicComplexity: 0.4,
    melodicComplexity: 0.4,
    variety: 0.45,
  }

  const drumDensity =
    (densityOfBool(genome.drums.kick) +
      densityOfBool(genome.drums.snare) +
      densityOfBool(genome.drums.hihat)) /
    3
  const bassDensity = densityOfNotes(genome.bass.notes)
  const melodyDensity = densityOfNotes(genome.melody.notes)
  const chordDensity = densityOfBool(genome.chords.rhythm)

  // Density only counts active layers
  const densParts: number[] = []
  if (genome.activeLayers.drums) densParts.push(drumDensity)
  if (genome.activeLayers.bass) densParts.push(bassDensity)
  if (genome.activeLayers.melody) densParts.push(melodyDensity)
  if (genome.activeLayers.chords) densParts.push(chordDensity)
  const density = densParts.length === 0 ? 0 : densParts.reduce((a, b) => a + b, 0) / densParts.length

  const kickRep = barRepetition(genome.drums.kick, genome.stepsPerBar)
  const bassRep = noteBarRepetition(genome.bass.notes, genome.stepsPerBar)
  const melRep = noteBarRepetition(genome.melody.notes, genome.stepsPerBar)
  const repetition = (kickRep + bassRep + melRep) / 3

  const rhythmicComplexity =
    (syncopation(genome.drums.kick, genome.stepsPerBar) * 0.4 +
      syncopation(genome.drums.hihat, genome.stepsPerBar) * 0.3 +
      syncopation(genome.drums.snare, genome.stepsPerBar) * 0.3) *
    (genome.activeLayers.drums ? 1 : 0.3)

  const melodicComplexity =
    (uniqueRatio(genome.melody.notes) * 0.5 + melodicIntervalVariety(genome.melody.notes) * 0.5) *
    (genome.activeLayers.melody ? 1 : 0.25)

  const harmonic = harmonicConsistency(genome)

  // Variety: mix of unique notes, non-identical bars, active layers
  const variety = clamp01(
    (1 - repetition) * 0.4 +
      uniqueRatio(genome.bass.notes) * 0.2 +
      uniqueRatio(genome.melody.notes) * 0.2 +
      (activeLayerCount(genome) / 4) * 0.2,
  )

  const metrics: FitnessMetrics = {
    repetition,
    density,
    rhythmicComplexity,
    melodicComplexity,
    harmonicConsistency: harmonic,
    variety,
  }

  // Distance from sweet spots (gaussian-ish)
  const densityFit = softFit(density, spots.density, 0.25)
  const rhythmFit = softFit(rhythmicComplexity, spots.rhythmicComplexity, 0.3)
  const melodyFit = softFit(melodicComplexity, spots.melodicComplexity, 0.3)
  const varietyFit = softFit(variety, spots.variety, 0.25)

  // Repetition: prefer mid — not total clone, not total chaos
  const repetitionFit = softFit(repetition, 0.55, 0.3)

  let score =
    densityFit * 0.22 +
    rhythmFit * 0.18 +
    melodyFit * 0.18 +
    varietyFit * 0.18 +
    repetitionFit * 0.12 +
    harmonic * 0.12

  // Penalties
  if (activeLayerCount(genome) === 0) score *= 0.15
  if (density < 0.05) score *= 0.45 // empty
  if (density > 0.85) score *= 0.55 // chaos wall of sound
  if (repetition > 0.95) score *= 0.5 // total stasis
  if (repetition < 0.15 && density > 0.3) score *= 0.7 // chaotic non-pattern

  return { score: clamp01(score), metrics }
}

function softFit(value: number, target: number, width: number): number {
  const d = Math.abs(value - target) / width
  return clamp01(1 - d * d)
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** Detect extremes for tests / UI. */
export function classifyFitnessExtreme(result: FitnessResult): 'empty' | 'static' | 'chaos' | 'ok' {
  const { metrics } = result
  if (metrics.density < 0.08) return 'empty'
  if (metrics.repetition > 0.85 && metrics.variety < 0.35) return 'static'
  // Wall-of-sound: very dense with imperfect bar repetition
  if (metrics.density > 0.85 && metrics.repetition < 0.65) return 'chaos'
  return 'ok'
}
