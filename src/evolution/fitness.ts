import type { MusicGenome } from '../music/genome'
import {
  DEFAULT_STYLE,
  type FitnessSweetSpots,
  type LayerDensityTargets,
  type Personality,
  type StyleRanges,
} from '../music/personality'

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

/** Steps per quarter-note beat (4 beats per bar). */
function stepsPerBeat(stepsPerBar: number): number {
  return Math.max(1, Math.floor(stepsPerBar / 4))
}

/** Syncopation-ish: hits off the quarter-note beats / total hits (same meaning on 8- and 16-step grids). */
function syncopation(arr: boolean[], stepsPerBar: number): number {
  const beat = stepsPerBeat(stepsPerBar)
  let hits = 0
  let off = 0
  for (let i = 0; i < arr.length; i++) {
    if (!arr[i]) continue
    hits++
    if ((i % stepsPerBar) % beat !== 0) off++
  }
  return hits === 0 ? 0 : off / hits
}

/** Distinct pitches used, saturating at 5 (rewards a real tune without demanding every note differ). */
function pitchVariety(arr: (number | null)[]): number {
  const filled = arr.filter((n): n is number => n !== null)
  if (filled.length === 0) return 0
  return Math.min(1, new Set(filled).size / 5)
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

const SCALE_LENGTH: Record<MusicGenome['scale']['mode'], number> = {
  major: 7,
  minor: 7,
  dorian: 7,
  mixolydian: 7,
  phrygian: 7,
  pentatonic: 5,
}

const VOICING_OFFSETS: Record<MusicGenome['chords']['voicing'], number[]> = {
  triad: [0, 2, 4],
  seventh: [0, 2, 4, 6],
  power: [0, 4],
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** Scale degrees (mod scale length) that belong to the chord sounding in a bar. */
function chordTonesForBar(genome: MusicGenome, bar: number): Set<number> {
  const len = SCALE_LENGTH[genome.scale.mode]
  const root = genome.chords.progression[bar] ?? 0
  // Power chords still imply a third for melody purposes
  const offsets = genome.chords.voicing === 'power' ? [0, 2, 4] : VOICING_OFFSETS[genome.chords.voicing]
  return new Set(offsets.map((o) => mod(root + o, len)))
}

/**
 * Fraction of notes on quarter-note beats that are chord tones of the bar's chord.
 * Off-beat notes are free (passing tones). Returns null when the layer has no on-beat notes.
 */
function chordToneRatio(genome: MusicGenome, notes: (number | null)[]): number | null {
  const len = SCALE_LENGTH[genome.scale.mode]
  const spb = genome.stepsPerBar
  const beat = stepsPerBeat(spb)
  let total = 0
  let fit = 0
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    if (n === null || n === undefined || (i % spb) % beat !== 0) continue
    const bar = Math.floor(i / spb)
    // Downbeats count double: that's where a clash is most audible
    const weight = i % spb === 0 ? 2 : 1
    total += weight
    if (chordTonesForBar(genome, bar).has(mod(n, len))) fit += weight
  }
  return total === 0 ? null : fit / total
}

/** Chord progression uses common diatonic chords (I ii IV V vi) and isn't one chord throughout. */
function progressionScore(genome: MusicGenome): number {
  const len = SCALE_LENGTH[genome.scale.mode]
  const common = new Set([0, 1, 3, 4, 5])
  const prog = genome.chords.progression
  if (prog.length === 0) return 0
  const ok = prog.filter((d) => common.has(mod(d, len))).length
  const unique = new Set(prog.map((d) => mod(d, len))).size
  const uniqueness = Math.min(1, unique / Math.min(4, prog.length))
  return 0.6 * (ok / prog.length) + 0.4 * uniqueness
}

/**
 * Harmony: progression quality plus how well bass and melody sit on the chords.
 * Bass and melody are checked against the progression even when the chord layer is muted,
 * since it still defines the implied harmony.
 */
function harmonicConsistency(genome: MusicGenome): number {
  const parts: { value: number; weight: number }[] = [
    { value: progressionScore(genome), weight: genome.activeLayers.chords ? 0.3 : 0.15 },
  ]
  if (genome.activeLayers.bass) {
    const r = chordToneRatio(genome, genome.bass.notes)
    if (r !== null) parts.push({ value: r, weight: 0.35 })
  }
  if (genome.activeLayers.melody) {
    const r = chordToneRatio(genome, genome.melody.notes)
    // Melodies may lean on tensions; ~75% chord tones on the beat already sounds settled
    if (r !== null) parts.push({ value: Math.min(1, r / 0.75), weight: 0.35 })
  }
  const total = parts.reduce((a, p) => a + p.weight, 0)
  return parts.reduce((a, p) => a + p.value * p.weight, 0) / total
}

/** Fraction of melodic moves that are steps or small skips (≤ 2 scale degrees). */
function melodicSmoothness(arr: (number | null)[]): number {
  let moves = 0
  let smooth = 0
  let prev: number | null = null
  for (const n of arr) {
    if (n === null) continue
    if (prev !== null) {
      moves++
      if (Math.abs(n - prev) <= 2) smooth++
    }
    prev = n
  }
  return moves === 0 ? 1 : smooth / moves
}

/** 1 inside [lo, hi], falling off smoothly outside over `width`. */
function rangeFit(value: number, [lo, hi]: readonly [number, number], width: number): number {
  const d = value < lo ? lo - value : value > hi ? value - hi : 0
  return Math.exp(-((d / width) ** 2))
}

/** How well tempo, register and swing stay inside the personality's style. */
function styleFit(genome: MusicGenome, style: StyleRanges): number {
  const missingCore = style.coreLayers.filter((l) => !genome.activeLayers[l]).length
  return (
    0.6 ** missingCore *
    rangeFit(genome.tempo, style.tempo, 8) *
    rangeFit(genome.bass.octave, style.bassOctave, 0.8) *
    rangeFit(genome.melody.octave, style.melodyOctave, 0.8) *
    rangeFit(genome.parameters.swing, [0, style.maxSwing], 0.08)
  )
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
  // Bass follows the chords, so its groove is judged on rhythm rather than pitch
  const bassGrooveRep = barRepetition(
    genome.bass.notes.map((n) => n !== null),
    genome.stepsPerBar,
  )
  const melRep = noteBarRepetition(genome.melody.notes, genome.stepsPerBar)
  const repetition = (kickRep + bassRep + melRep) / 3

  const rhythmicComplexity =
    (syncopation(genome.drums.kick, genome.stepsPerBar) * 0.4 +
      syncopation(genome.drums.hihat, genome.stepsPerBar) * 0.3 +
      syncopation(genome.drums.snare, genome.stepsPerBar) * 0.3) *
    (genome.activeLayers.drums ? 1 : 0.3)

  const melodicComplexity =
    (pitchVariety(genome.melody.notes) * 0.5 + melodicIntervalVariety(genome.melody.notes) * 0.5) *
    (genome.activeLayers.melody ? 1 : 0.25)

  const harmonic = harmonicConsistency(genome)

  // Variety: mix of unique notes, non-identical bars, active layers
  const variety = clamp01(
    (1 - repetition) * 0.4 +
      pitchVariety(genome.bass.notes) * 0.2 +
      pitchVariety(genome.melody.notes) * 0.2 +
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

  // Distance from sweet spots (gaussian-ish). Density is judged per layer so a busy
  // melody can't hide behind sparse drums.
  const layerTargets: Required<LayerDensityTargets> = {
    drums: spots.density,
    bass: spots.density,
    melody: spots.density,
    chords: spots.density,
    ...spots.layerDensity,
  }
  const layerFits: number[] = []
  if (genome.activeLayers.drums) layerFits.push(softFit(drumDensity, layerTargets.drums, 0.2))
  if (genome.activeLayers.bass) layerFits.push(softFit(bassDensity, layerTargets.bass, 0.2))
  if (genome.activeLayers.melody) layerFits.push(softFit(melodyDensity, layerTargets.melody, 0.2))
  if (genome.activeLayers.chords) layerFits.push(softFit(chordDensity, layerTargets.chords, 0.2))
  const densityFit =
    layerFits.length === 0 ? 0 : layerFits.reduce((a, b) => a + b, 0) / layerFits.length
  const rhythmFit = softFit(rhythmicComplexity, spots.rhythmicComplexity, 0.3)
  const melodyFit = softFit(melodicComplexity, spots.melodicComplexity, 0.3)
  const varietyFit = softFit(variety, spots.variety, 0.25)

  // Repetition per layer: grooves repeat bar to bar, bass a bit less, melodies vary the most
  const repFits: number[] = []
  if (genome.activeLayers.drums) repFits.push(softFit(kickRep, 0.9, 0.25))
  if (genome.activeLayers.bass) repFits.push(softFit(bassGrooveRep, 0.75, 0.3))
  if (genome.activeLayers.melody) repFits.push(softFit(melRep, 0.55, 0.3))
  const repetitionFit =
    repFits.length === 0 ? 0 : repFits.reduce((a, b) => a + b, 0) / repFits.length

  // Prefer mostly stepwise melodies; big leaps everywhere sound random
  const smoothFit = genome.activeLayers.melody
    ? Math.min(1, melodicSmoothness(genome.melody.notes) / 0.6)
    : 1

  let score =
    densityFit * 0.18 +
    rhythmFit * 0.14 +
    melodyFit * 0.12 +
    varietyFit * 0.12 +
    repetitionFit * 0.1 +
    harmonic * 0.24 +
    smoothFit * 0.1

  // Staying in the genre's tempo / register / swing range is a hard-ish requirement
  score *= 0.3 + 0.7 * styleFit(genome, personality?.style ?? DEFAULT_STYLE)

  // Penalties
  if (activeLayerCount(genome) === 0) score *= 0.15
  if (density < 0.05) score *= 0.45 // empty
  if (density > 0.85) score *= 0.55 // chaos wall of sound
  if (repetition > 0.97) score *= 0.75 // every layer an exact one-bar loop
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
