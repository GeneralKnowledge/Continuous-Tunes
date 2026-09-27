/** Scale modes supported by the genome. */
export const SCALE_MODES = [
  'major',
  'minor',
  'dorian',
  'mixolydian',
  'pentatonic',
  'phrygian',
] as const

export type ScaleMode = (typeof SCALE_MODES)[number]

export const CHORD_VOICINGS = ['triad', 'seventh', 'power'] as const
export type ChordVoicing = (typeof CHORD_VOICINGS)[number]

export interface Scale {
  /** Pitch class 0–11 (C=0). */
  root: number
  mode: ScaleMode
}

export interface DrumPattern {
  kick: boolean[]
  snare: boolean[]
  hihat: boolean[]
}

export interface NoteLayer {
  /** Scale degrees; null = rest. Length = stepsPerBar * bars. */
  notes: (number | null)[]
  octave: number
}

export interface ChordLayer {
  /** Scale-degree roots for each chord slot (length = bars). */
  progression: number[]
  voicing: ChordVoicing
  /** Hit pattern length = stepsPerBar * bars. */
  rhythm: boolean[]
}

export interface ActiveLayers {
  drums: boolean
  bass: boolean
  melody: boolean
  chords: boolean
}

export interface GenomeParameters {
  /** Swing amount 0–1. */
  swing: number
}

/**
 * Structured, serialisable music genome.
 * Not arbitrary JS — easy to mutate, compare, save, and compile.
 */
export interface MusicGenome {
  tempo: number
  stepsPerBar: number
  bars: number
  scale: Scale
  drums: DrumPattern
  bass: NoteLayer
  melody: NoteLayer
  chords: ChordLayer
  activeLayers: ActiveLayers
  parameters: GenomeParameters
}

export const TEMPO_MIN = 60
export const TEMPO_MAX = 180
export const STEPS_PER_BAR_OPTIONS = [8, 16] as const
export const BARS_OPTIONS = [2, 4, 8] as const
export const OCTAVE_MIN = 1
export const OCTAVE_MAX = 6
export const SCALE_DEGREE_MIN = 0
export const SCALE_DEGREE_MAX = 7

/** Total step count for a genome. */
export function totalSteps(g: Pick<MusicGenome, 'stepsPerBar' | 'bars'>): number {
  return g.stepsPerBar * g.bars
}

/** Deep clone via JSON (genome is plain data). */
export function cloneGenome(g: MusicGenome): MusicGenome {
  return JSON.parse(JSON.stringify(g)) as MusicGenome
}

export function serializeGenome(g: MusicGenome): string {
  return JSON.stringify(g)
}

export function deserializeGenome(json: string): MusicGenome {
  const parsed: unknown = JSON.parse(json)
  return parsed as MusicGenome
}

/** Equality by serialised form. */
export function genomesEqual(a: MusicGenome, b: MusicGenome): boolean {
  return serializeGenome(a) === serializeGenome(b)
}

/** Create an empty boolean step array. */
export function emptySteps(n: number): boolean[] {
  return Array.from({ length: n }, () => false)
}

/** Create a rest-filled note array. */
export function emptyNotes(n: number): (number | null)[] {
  return Array.from({ length: n }, () => null)
}
