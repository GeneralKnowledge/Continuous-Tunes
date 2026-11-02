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
  /**
   * Optional extra percussion (shaker, rim, conga or ride, by kit). Length = total steps.
   * Missing in genomes saved before it existed.
   */
  perc?: boolean[]
}

export interface NoteLayer {
  /**
   * Scale degrees; null = rest. Length = stepsPerBar * bars.
   * Degrees run from SCALE_DEGREE_MIN (below the root, for approach notes) to SCALE_DEGREE_MAX.
   */
  notes: (number | null)[]
  octave: number
  /**
   * How long each note sounds, as a share of the gap to the next onset: 0 = one step (the old
   * behaviour), 1 = legato into the next note. Missing in genomes saved before it existed.
   */
  gate?: number
}

export interface ChordLayer {
  /** Scale-degree roots for each chord slot (length = bars), 0–7. */
  progression: number[]
  voicing: ChordVoicing
  /**
   * Optional chord colour per bar: a chord type (Tonal names such as "m9", "7", "sus4", "maj7")
   * replacing the genre's default colour for that bar; null keeps the default. Lets a bar become
   * a secondary dominant, a borrowed chord or a suspension while its root stays a scale degree.
   */
  colors?: (string | null)[]
  /** Hit pattern length = stepsPerBar * bars. */
  rhythm: boolean[]
  /** Stab length as a share of the gap to the next hit (see NoteLayer.gate). */
  gate?: number
}

/**
 * An arpeggio that follows the chords: each step is an index into the bar's chord tones
 * (0 = lowest; indices past the last tone climb into the next octave), or null for a rest.
 */
export interface ArpLayer {
  pattern: (number | null)[]
  octave: number
}

export interface ActiveLayers {
  drums: boolean
  bass: boolean
  melody: boolean
  chords: boolean
  /** Missing in genomes saved before the arp layer existed (= off). */
  arp?: boolean
  /** Counter-melody; missing = off. */
  counter?: boolean
}

/** Layers a pattern gene can transform. */
export const PATTERN_TARGETS = ['kick', 'snare', 'hihat', 'perc', 'bass', 'melody', 'chords', 'arp', 'counter'] as const
export type PatternTarget = (typeof PATTERN_TARGETS)[number]

/**
 * Pattern transforms, after TidalCycles:
 * - degrade: drop each event with probability `amount` (Tidal's degradeBy): breathing hats, sparse twinkles
 * - ply: repeat each event `amount` (2–4) times inside its own length: rolls, ratchets, triplet hat flourishes
 * - off: an echo `amount` steps later at a lower level (Tidal's off): dub answers, delayed responses
 * - nudge: play `amount` of a step late (negative: early): the layer's feel against the grid
 */
export const PATTERN_OPS = ['degrade', 'ply', 'off', 'nudge'] as const
export type PatternOp = (typeof PATTERN_OPS)[number]

/**
 * A transform on one layer, played by Strudel on every pass (so a 4-bar loop played for 16 bars
 * varies from pass to pass) and understood by the fitness and the mutations.
 */
export interface PatternGene {
  target: PatternTarget
  op: PatternOp
  amount: number
  /** Only on the last bar of every `every` bars, counted from the section start (Tidal's lastOf). */
  every?: number
  /** Each event is transformed with this probability (Tidal's sometimesBy); always when missing. */
  chance?: number
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
  /**
   * Genre whose musical language (chord colours, voicings, groove, fills) renders this genome.
   * Optional: genomes saved before it existed play in the neutral default style.
   */
  genre?: string
  tempo: number
  stepsPerBar: number
  bars: number
  scale: Scale
  drums: DrumPattern
  bass: NoteLayer
  melody: NoteLayer
  chords: ChordLayer
  arp?: ArpLayer
  /**
   * A secondary line that answers the melody (composed from it and the chords, see counter.ts).
   * Missing in genomes saved before it existed.
   */
  counter?: NoteLayer
  /** Pattern transforms (see PatternGene); missing = none. */
  patterns?: PatternGene[]
  activeLayers: ActiveLayers
  parameters: GenomeParameters
}

export const TEMPO_MIN = 60
export const TEMPO_MAX = 180
export const STEPS_PER_BAR_OPTIONS = [8, 16] as const
export const BARS_OPTIONS = [2, 4, 8] as const
export const OCTAVE_MIN = 1
export const OCTAVE_MAX = 6
/** Note degrees: a little below the root (approach notes) to two octaves up. */
export const SCALE_DEGREE_MIN = -7
export const SCALE_DEGREE_MAX = 14
/** Chord roots stay inside the first octave of the scale. */
export const CHORD_ROOT_MIN = 0
export const CHORD_ROOT_MAX = 7
export const ARP_INDEX_MAX = 11

/** Total step count for a genome. */
export function totalSteps(g: Pick<MusicGenome, 'stepsPerBar' | 'bars'>): number {
  return g.stepsPerBar * g.bars
}

/** Deep clone via JSON (genome is plain data). */
export function cloneGenome(g: MusicGenome): MusicGenome {
  return deepCopy(g)
}

/** Deep copy of plain JSON data (arrays, objects, primitives); several times faster than a JSON round trip. */
function deepCopy<T>(v: T): T {
  if (Array.isArray(v)) {
    const out = new Array(v.length)
    for (let i = 0; i < v.length; i++) out[i] = deepCopy(v[i])
    return out as T
  }
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k in v) {
      const x = (v as Record<string, unknown>)[k]
      if (x !== undefined) out[k] = deepCopy(x)
    }
    return out as T
  }
  return v
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
