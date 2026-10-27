/**
 * Personality biases mutation weights and fitness sweet spots.
 * Channels compose a seed + personality + evolution defaults.
 */

export interface MutationWeights {
  rhythm: number
  bass: number
  melody: number
  chords: number
  tempo: number
  scale: number
  layers: number
  parameters: number
}

/** Per-layer density targets; missing layers fall back to the overall density. */
export interface LayerDensityTargets {
  drums?: number
  bass?: number
  melody?: number
  chords?: number
}

/** Genre boundaries the fitness keeps evolution inside. */
export interface StyleRanges {
  tempo: readonly [number, number]
  bassOctave: readonly [number, number]
  melodyOctave: readonly [number, number]
  maxSwing: number
  /** Layers the genre needs; dropping one is penalised. */
  coreLayers: readonly ('drums' | 'bass' | 'melody' | 'chords')[]
}

export const DEFAULT_STYLE: StyleRanges = {
  tempo: [80, 140],
  bassOctave: [2, 3],
  melodyOctave: [4, 5],
  maxSwing: 0.3,
  coreLayers: [],
}

export interface FitnessSweetSpots {
  /** Preferred overall density 0–1. */
  density: number
  /** Optional per-layer density targets. */
  layerDensity?: LayerDensityTargets
  /** Preferred rhythmic complexity 0–1. */
  rhythmicComplexity: number
  /** Preferred melodic complexity 0–1. */
  melodicComplexity: number
  /** Preferred variety / non-repetition 0–1. */
  variety: number
}

export interface Personality {
  id: string
  label: string
  mutationWeights: MutationWeights
  sweetSpots: FitnessSweetSpots
  style: StyleRanges
  /** Bias toward small / moderate / experimental mutation intensity. */
  intensityBias: {
    small: number
    moderate: number
    experimental: number
  }
}

const DEFAULT_INTENSITY = { small: 0.7, moderate: 0.2, experimental: 0.1 }

export const PERSONALITIES: Record<string, Personality> = {
  sparse: {
    id: 'sparse',
    label: 'Sparse',
    mutationWeights: {
      rhythm: 1.4,
      bass: 1.1,
      melody: 0.35,
      chords: 0.25,
      tempo: 0.35,
      scale: 0.2,
      layers: 1.0,
      parameters: 0.3,
    },
    sweetSpots: {
      layerDensity: { drums: 0.22, bass: 0.2, melody: 0.15, chords: 0.12 },
      density: 0.22,
      rhythmicComplexity: 0.18,
      melodicComplexity: 0.1,
      variety: 0.3,
    },
    style: { tempo: [84, 132], bassOctave: [2, 3], melodyOctave: [4, 5], maxSwing: 0.2, coreLayers: ['drums', 'bass'] },
    intensityBias: { small: 0.8, moderate: 0.15, experimental: 0.05 },
  },
  lush: {
    id: 'lush',
    label: 'Lush',
    mutationWeights: {
      rhythm: 0.25,
      bass: 0.7,
      melody: 1.4,
      chords: 1.6,
      tempo: 0.3,
      scale: 0.9,
      layers: 0.5,
      parameters: 0.4,
    },
    sweetSpots: {
      layerDensity: { drums: 0.06, bass: 0.15, melody: 0.3, chords: 0.1 },
      density: 0.4,
      rhythmicComplexity: 0.08,
      melodicComplexity: 0.75,
      variety: 0.55,
    },
    style: { tempo: [60, 90], bassOctave: [2, 3], melodyOctave: [4, 5], maxSwing: 0.1, coreLayers: ['melody', 'chords'] },
    intensityBias: { small: 0.72, moderate: 0.2, experimental: 0.08 },
  },
  driving: {
    id: 'driving',
    label: 'Driving',
    mutationWeights: {
      rhythm: 1.7,
      bass: 1.5,
      melody: 0.7,
      chords: 0.45,
      tempo: 1.0,
      scale: 0.25,
      layers: 0.4,
      parameters: 0.5,
    },
    sweetSpots: {
      layerDensity: { drums: 0.3, bass: 0.5, melody: 0.55, chords: 0.25 },
      density: 0.55,
      rhythmicComplexity: 0.22,
      melodicComplexity: 0.85,
      variety: 0.62,
    },
    style: { tempo: [118, 140], bassOctave: [2, 3], melodyOctave: [4, 5], maxSwing: 0.15, coreLayers: ['drums', 'bass', 'melody'] },
    intensityBias: { small: 0.6, moderate: 0.28, experimental: 0.12 },
  },
  groovy: {
    id: 'groovy',
    label: 'Groovy',
    mutationWeights: {
      rhythm: 1.8,
      bass: 1.4,
      melody: 0.5,
      chords: 0.7,
      tempo: 0.5,
      scale: 0.3,
      layers: 0.35,
      parameters: 1.2,
    },
    sweetSpots: {
      layerDensity: { drums: 0.32, bass: 0.45, melody: 0.4, chords: 0.25 },
      density: 0.52,
      rhythmicComplexity: 0.3,
      melodicComplexity: 0.75,
      variety: 0.58,
    },
    style: { tempo: [118, 130], bassOctave: [2, 3], melodyOctave: [4, 5], maxSwing: 0.3, coreLayers: ['drums', 'bass', 'chords'] },
    intensityBias: { small: 0.65, moderate: 0.25, experimental: 0.1 },
  },
  chill: {
    id: 'chill',
    label: 'Chill',
    mutationWeights: {
      rhythm: 0.45,
      bass: 1.1,
      melody: 1.1,
      chords: 1.3,
      tempo: 0.9,
      scale: 0.7,
      layers: 0.6,
      parameters: 0.5,
    },
    sweetSpots: {
      layerDensity: { drums: 0.1, bass: 0.2, melody: 0.35, chords: 0.12 },
      density: 0.32,
      rhythmicComplexity: 0.15,
      melodicComplexity: 0.75,
      variety: 0.55,
    },
    style: { tempo: [70, 100], bassOctave: [2, 3], melodyOctave: [4, 5], maxSwing: 0.35, coreLayers: ['bass', 'melody', 'chords'] },
    intensityBias: { small: 0.75, moderate: 0.2, experimental: 0.05 },
  },
  folk: {
    id: 'folk',
    label: 'Folk',
    mutationWeights: {
      rhythm: 0.6,
      bass: 0.9,
      melody: 1.7,
      chords: 1.2,
      tempo: 0.4,
      scale: 1.1,
      layers: 0.4,
      parameters: 0.35,
    },
    sweetSpots: {
      layerDensity: { drums: 0.2, bass: 0.3, melody: 0.45, chords: 0.12 },
      density: 0.38,
      rhythmicComplexity: 0.45,
      melodicComplexity: 0.85,
      variety: 0.62,
    },
    style: { tempo: [84, 120], bassOctave: [2, 3], melodyOctave: [4, 5], maxSwing: 0.25, coreLayers: ['bass', 'melody', 'chords'] },
    intensityBias: DEFAULT_INTENSITY,
  },
  dusty: {
    id: 'dusty',
    label: 'Dusty',
    mutationWeights: {
      rhythm: 0.9,
      bass: 0.9,
      melody: 1.2,
      chords: 1.4,
      tempo: 0.3,
      scale: 0.3,
      layers: 0.3,
      parameters: 0.8,
    },
    sweetSpots: {
      layerDensity: { drums: 0.3, bass: 0.2, melody: 0.25, chords: 0.15 },
      density: 0.3,
      rhythmicComplexity: 0.35,
      melodicComplexity: 0.6,
      variety: 0.5,
    },
    style: { tempo: [72, 95], bassOctave: [2, 3], melodyOctave: [4, 5], maxSwing: 0.5, coreLayers: ['drums', 'bass', 'chords'] },
    intensityBias: { small: 0.75, moderate: 0.2, experimental: 0.05 },
  },
  rolling: {
    id: 'rolling',
    label: 'Rolling',
    mutationWeights: {
      rhythm: 1.6,
      bass: 1.3,
      melody: 0.7,
      chords: 0.6,
      tempo: 0.3,
      scale: 0.2,
      layers: 0.4,
      parameters: 0.3,
    },
    sweetSpots: {
      layerDensity: { drums: 0.35, bass: 0.18, melody: 0.15, chords: 0.08 },
      density: 0.35,
      rhythmicComplexity: 0.5,
      melodicComplexity: 0.4,
      variety: 0.5,
    },
    style: { tempo: [164, 178], bassOctave: [1, 2], melodyOctave: [4, 5], maxSwing: 0.1, coreLayers: ['drums', 'bass'] },
    intensityBias: { small: 0.65, moderate: 0.25, experimental: 0.1 },
  },
  euphoric: {
    id: 'euphoric',
    label: 'Euphoric',
    mutationWeights: {
      rhythm: 0.6,
      bass: 0.7,
      melody: 1.6,
      chords: 1.2,
      tempo: 0.3,
      scale: 0.3,
      layers: 0.3,
      parameters: 0.2,
    },
    sweetSpots: {
      layerDensity: { drums: 0.3, bass: 0.75, melody: 0.95, chords: 0.08 },
      density: 0.6,
      rhythmicComplexity: 0.3,
      melodicComplexity: 0.85,
      variety: 0.7,
    },
    style: { tempo: [132, 142], bassOctave: [2, 3], melodyOctave: [4, 5], maxSwing: 0.05, coreLayers: ['drums', 'bass', 'melody'] },
    intensityBias: { small: 0.75, moderate: 0.2, experimental: 0.05 },
  },
}

export function getPersonality(id: string): Personality {
  const p = PERSONALITIES[id]
  if (!p) throw new Error(`Unknown personality: ${id}`)
  return p
}
