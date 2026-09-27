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
      rhythm: 1.2,
      bass: 1.0,
      melody: 0.6,
      chords: 0.4,
      tempo: 0.5,
      scale: 0.3,
      layers: 0.8,
      parameters: 0.4,
    },
    sweetSpots: {
      density: 0.25,
      rhythmicComplexity: 0.3,
      melodicComplexity: 0.25,
      variety: 0.4,
    },
    intensityBias: { small: 0.8, moderate: 0.15, experimental: 0.05 },
  },
  lush: {
    id: 'lush',
    label: 'Lush',
    mutationWeights: {
      rhythm: 0.5,
      bass: 0.8,
      melody: 1.2,
      chords: 1.4,
      tempo: 0.4,
      scale: 0.7,
      layers: 0.6,
      parameters: 0.5,
    },
    sweetSpots: {
      density: 0.45,
      rhythmicComplexity: 0.35,
      melodicComplexity: 0.55,
      variety: 0.5,
    },
    intensityBias: DEFAULT_INTENSITY,
  },
  driving: {
    id: 'driving',
    label: 'Driving',
    mutationWeights: {
      rhythm: 1.5,
      bass: 1.3,
      melody: 0.8,
      chords: 0.6,
      tempo: 0.9,
      scale: 0.3,
      layers: 0.5,
      parameters: 0.6,
    },
    sweetSpots: {
      density: 0.55,
      rhythmicComplexity: 0.5,
      melodicComplexity: 0.4,
      variety: 0.45,
    },
    intensityBias: { small: 0.65, moderate: 0.25, experimental: 0.1 },
  },
  groovy: {
    id: 'groovy',
    label: 'Groovy',
    mutationWeights: {
      rhythm: 1.4,
      bass: 1.2,
      melody: 0.7,
      chords: 0.8,
      tempo: 0.6,
      scale: 0.4,
      layers: 0.5,
      parameters: 1.0,
    },
    sweetSpots: {
      density: 0.5,
      rhythmicComplexity: 0.55,
      melodicComplexity: 0.35,
      variety: 0.4,
    },
    intensityBias: DEFAULT_INTENSITY,
  },
  chill: {
    id: 'chill',
    label: 'Chill',
    mutationWeights: {
      rhythm: 0.7,
      bass: 1.0,
      melody: 1.0,
      chords: 1.1,
      tempo: 0.8,
      scale: 0.6,
      layers: 0.7,
      parameters: 0.5,
    },
    sweetSpots: {
      density: 0.35,
      rhythmicComplexity: 0.35,
      melodicComplexity: 0.45,
      variety: 0.45,
    },
    intensityBias: { small: 0.75, moderate: 0.2, experimental: 0.05 },
  },
  folk: {
    id: 'folk',
    label: 'Folk',
    mutationWeights: {
      rhythm: 0.8,
      bass: 1.0,
      melody: 1.4,
      chords: 1.0,
      tempo: 0.5,
      scale: 0.9,
      layers: 0.5,
      parameters: 0.4,
    },
    sweetSpots: {
      density: 0.4,
      rhythmicComplexity: 0.4,
      melodicComplexity: 0.55,
      variety: 0.5,
    },
    intensityBias: DEFAULT_INTENSITY,
  },
}

export function getPersonality(id: string): Personality {
  const p = PERSONALITIES[id]
  if (!p) throw new Error(`Unknown personality: ${id}`)
  return p
}
