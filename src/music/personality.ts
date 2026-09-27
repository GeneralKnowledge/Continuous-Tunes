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

export interface FitnessSweetSpots {
  /** Preferred overall density 0–1. */
  density: number
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
      density: 0.22,
      rhythmicComplexity: 0.28,
      melodicComplexity: 0.2,
      variety: 0.38,
    },
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
      density: 0.4,
      rhythmicComplexity: 0.28,
      melodicComplexity: 0.58,
      variety: 0.5,
    },
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
      density: 0.55,
      rhythmicComplexity: 0.52,
      melodicComplexity: 0.38,
      variety: 0.42,
    },
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
      density: 0.52,
      rhythmicComplexity: 0.58,
      melodicComplexity: 0.32,
      variety: 0.38,
    },
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
      density: 0.32,
      rhythmicComplexity: 0.3,
      melodicComplexity: 0.48,
      variety: 0.45,
    },
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
      density: 0.38,
      rhythmicComplexity: 0.35,
      melodicComplexity: 0.6,
      variety: 0.52,
    },
    intensityBias: DEFAULT_INTENSITY,
  },
}

export function getPersonality(id: string): Personality {
  const p = PERSONALITIES[id]
  if (!p) throw new Error(`Unknown personality: ${id}`)
  return p
}
