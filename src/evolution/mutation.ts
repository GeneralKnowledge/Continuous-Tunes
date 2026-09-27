import type { Rng } from '../lib/rng'
import {
  BARS_OPTIONS,
  CHORD_VOICINGS,
  SCALE_DEGREE_MAX,
  SCALE_DEGREE_MIN,
  SCALE_MODES,
  STEPS_PER_BAR_OPTIONS,
  TEMPO_MAX,
  TEMPO_MIN,
  cloneGenome,
  totalSteps,
  type MusicGenome,
} from '../music/genome'
import type { MutationWeights, Personality } from '../music/personality'
import { validateGenome } from '../music/validation'

export type MutationIntensity = 'small' | 'moderate' | 'experimental'

export interface MutationResult {
  genome: MusicGenome
  mutationName: string
  description: string
}

export interface MutationOp {
  name: string
  category: keyof MutationWeights
  /** Minimum intensity required to apply this op. */
  minIntensity: MutationIntensity
  apply: (genome: MusicGenome, rng: Rng, intensity: MutationIntensity) => MutationResult | null
}

const INTENSITY_RANK: Record<MutationIntensity, number> = {
  small: 0,
  moderate: 1,
  experimental: 2,
}

function canApply(op: MutationOp, intensity: MutationIntensity): boolean {
  return INTENSITY_RANK[intensity] >= INTENSITY_RANK[op.minIntensity]
}

function flipAt(arr: boolean[], i: number): void {
  arr[i] = !arr[i]
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function resizeBool(arr: boolean[], len: number): boolean[] {
  const out = arr.slice(0, len)
  while (out.length < len) out.push(false)
  return out
}

function resizeNotes(arr: (number | null)[], len: number): (number | null)[] {
  const out = arr.slice(0, len)
  while (out.length < len) out.push(null)
  return out
}

/** Default mutation probability config (not hardcoded at call sites). */
export interface MutationConfig {
  /** Relative category weights (combined with personality). */
  categoryWeights: MutationWeights
  /** Probability of each intensity tier. */
  intensityProbabilities: {
    small: number
    moderate: number
    experimental: number
  }
}

export const DEFAULT_MUTATION_CONFIG: MutationConfig = {
  categoryWeights: {
    rhythm: 1,
    bass: 1,
    melody: 1,
    chords: 1,
    tempo: 0.6,
    scale: 0.4,
    layers: 0.5,
    parameters: 0.4,
  },
  intensityProbabilities: {
    small: 0.7,
    moderate: 0.2,
    experimental: 0.1,
  },
}

export function mergeMutationConfig(
  base: MutationConfig,
  personality?: Personality,
): MutationConfig {
  if (!personality) return base
  const categoryWeights = { ...base.categoryWeights }
  for (const key of Object.keys(categoryWeights) as (keyof MutationWeights)[]) {
    categoryWeights[key] = categoryWeights[key]! * personality.mutationWeights[key]
  }
  return {
    categoryWeights,
    intensityProbabilities: { ...personality.intensityBias },
  }
}

export function pickIntensity(rng: Rng, config: MutationConfig): MutationIntensity {
  const { small, moderate, experimental } = config.intensityProbabilities
  const total = small + moderate + experimental
  const r = rng.next() * total
  if (r < small) return 'small'
  if (r < small + moderate) return 'moderate'
  return 'experimental'
}

/**
 * Shift intensity toward moderate/experimental as stagnation rises
 * so long runs don't freeze on tiny tweaks.
 */
export function intensityWithStagnation(
  config: MutationConfig,
  stagnationStreak: number,
  stagnationLimit = 8,
): MutationConfig {
  const t = Math.min(1, stagnationStreak / Math.max(1, stagnationLimit))
  const { small, moderate, experimental } = config.intensityProbabilities
  const shift = t * 0.35
  return {
    ...config,
    intensityProbabilities: {
      small: Math.max(0.15, small - shift),
      moderate: moderate + shift * 0.4,
      experimental: experimental + shift * 0.6,
    },
  }
}

// ─── Mutation operators ───────────────────────────────────────────────

export const MUTATION_OPS: MutationOp[] = [
  {
    name: 'AddKickHit',
    category: 'rhythm',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const offs = g.drums.kick.map((v, i) => (!v ? i : -1)).filter((i) => i >= 0)
      if (offs.length === 0) return null
      const i = rng.pick(offs)
      g.drums.kick[i] = true
      return { genome: g, mutationName: 'AddKickHit', description: `kick on @${i}` }
    },
  },
  {
    name: 'RemoveKickHit',
    category: 'rhythm',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const ons = g.drums.kick.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
      if (ons.length <= 1) return null
      const i = rng.pick(ons)
      g.drums.kick[i] = false
      return { genome: g, mutationName: 'RemoveKickHit', description: `kick off @${i}` }
    },
  },
  {
    name: 'ToggleSnare',
    category: 'rhythm',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.drums.snare.length - 1)
      flipAt(g.drums.snare, i)
      return { genome: g, mutationName: 'ToggleSnare', description: `snare toggle @${i}` }
    },
  },
  {
    name: 'ToggleHihat',
    category: 'rhythm',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.drums.hihat.length - 1)
      flipAt(g.drums.hihat, i)
      return { genome: g, mutationName: 'ToggleHihat', description: `hihat toggle @${i}` }
    },
  },
  {
    name: 'ShiftDrumPattern',
    category: 'rhythm',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const which = rng.pick(['kick', 'snare', 'hihat'] as const)
      const amount = rng.chance(0.5) ? 1 : -1
      const arr = g.drums[which]
      const n = arr.length
      const rot = ((amount % n) + n) % n
      g.drums[which] = [...arr.slice(rot), ...arr.slice(0, rot)]
      return {
        genome: g,
        mutationName: 'ShiftDrumPattern',
        description: `shift ${which} by ${rot}`,
      }
    },
  },
  {
    name: 'ChangeBassRhythm',
    category: 'bass',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.bass.notes.length - 1)
      if (g.bass.notes[i] === null) {
        g.bass.notes[i] = rng.int(SCALE_DEGREE_MIN, Math.min(4, SCALE_DEGREE_MAX))
      } else if (rng.chance(0.5)) {
        g.bass.notes[i] = null
      } else {
        g.bass.notes[i] = rng.int(SCALE_DEGREE_MIN, SCALE_DEGREE_MAX)
      }
      return { genome: g, mutationName: 'ChangeBassRhythm', description: `bass @${i}=${g.bass.notes[i]}` }
    },
  },
  {
    name: 'ChangeBassNote',
    category: 'bass',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const filled = g.bass.notes.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0)
      if (filled.length === 0) {
        const i = rng.int(0, g.bass.notes.length - 1)
        g.bass.notes[i] = rng.int(0, 4)
      } else {
        const i = rng.pick(filled)
        const cur = g.bass.notes[i]!
        const delta = rng.chance(0.5) ? 1 : -1
        g.bass.notes[i] = clamp(cur + delta, SCALE_DEGREE_MIN, SCALE_DEGREE_MAX)
      }
      return { genome: g, mutationName: 'ChangeBassNote', description: `bass note change` }
    },
  },
  {
    name: 'ChangeBassOctave',
    category: 'bass',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      g.bass.octave = clamp(g.bass.octave + (rng.chance(0.5) ? 1 : -1), 1, 4)
      return { genome: g, mutationName: 'ChangeBassOctave', description: `bass oct=${g.bass.octave}` }
    },
  },
  {
    name: 'ChangeMelodyNote',
    category: 'melody',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.melody.notes.length - 1)
      if (g.melody.notes[i] === null) {
        g.melody.notes[i] = rng.int(SCALE_DEGREE_MIN, SCALE_DEGREE_MAX)
      } else if (rng.chance(0.35)) {
        g.melody.notes[i] = null
      } else {
        const cur = g.melody.notes[i]!
        g.melody.notes[i] = clamp(cur + (rng.chance(0.5) ? 1 : -1), SCALE_DEGREE_MIN, SCALE_DEGREE_MAX)
      }
      return {
        genome: g,
        mutationName: 'ChangeMelodyNote',
        description: `melody @${i}=${g.melody.notes[i]}`,
      }
    },
  },
  {
    name: 'AddMelodyPhrase',
    category: 'melody',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const start = rng.int(0, Math.max(0, g.melody.notes.length - 4))
      const len = rng.int(2, 4)
      for (let k = 0; k < len && start + k < g.melody.notes.length; k++) {
        g.melody.notes[start + k] = rng.int(0, 5)
      }
      return {
        genome: g,
        mutationName: 'AddMelodyPhrase',
        description: `melody phrase @${start} len=${len}`,
      }
    },
  },
  {
    name: 'ChangeMelodyOctave',
    category: 'melody',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      g.melody.octave = clamp(g.melody.octave + (rng.chance(0.5) ? 1 : -1), 3, 6)
      return {
        genome: g,
        mutationName: 'ChangeMelodyOctave',
        description: `melody oct=${g.melody.octave}`,
      }
    },
  },
  {
    name: 'ChangeChordRoot',
    category: 'chords',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.chords.progression.length - 1)
      g.chords.progression[i] = rng.int(SCALE_DEGREE_MIN, SCALE_DEGREE_MAX)
      return {
        genome: g,
        mutationName: 'ChangeChordRoot',
        description: `chord[${i}]=${g.chords.progression[i]}`,
      }
    },
  },
  {
    name: 'ChangeChordVoicing',
    category: 'chords',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const options = CHORD_VOICINGS.filter((v) => v !== g.chords.voicing)
      g.chords.voicing = rng.pick(options)
      return {
        genome: g,
        mutationName: 'ChangeChordVoicing',
        description: `voicing=${g.chords.voicing}`,
      }
    },
  },
  {
    name: 'ToggleChordRhythm',
    category: 'chords',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.chords.rhythm.length - 1)
      flipAt(g.chords.rhythm, i)
      return {
        genome: g,
        mutationName: 'ToggleChordRhythm',
        description: `chord rhythm @${i}`,
      }
    },
  },
  {
    name: 'ChangeTempo',
    category: 'tempo',
    minIntensity: 'small',
    apply(genome, rng, intensity) {
      const g = cloneGenome(genome)
      const delta =
        intensity === 'small' ? rng.int(-4, 4) : intensity === 'moderate' ? rng.int(-12, 12) : rng.int(-24, 24)
      if (delta === 0) return null
      g.tempo = clamp(g.tempo + delta, TEMPO_MIN, TEMPO_MAX)
      return { genome: g, mutationName: 'ChangeTempo', description: `tempo=${g.tempo}` }
    },
  },
  {
    name: 'ChangeScaleRoot',
    category: 'scale',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      g.scale.root = (g.scale.root + rng.int(1, 11)) % 12
      return {
        genome: g,
        mutationName: 'ChangeScaleRoot',
        description: `root=${g.scale.root}`,
      }
    },
  },
  {
    name: 'ChangeScaleMode',
    category: 'scale',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const options = SCALE_MODES.filter((m) => m !== g.scale.mode)
      g.scale.mode = rng.pick(options)
      return {
        genome: g,
        mutationName: 'ChangeScaleMode',
        description: `mode=${g.scale.mode}`,
      }
    },
  },
  {
    name: 'AddLayer',
    category: 'layers',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const off = (Object.keys(g.activeLayers) as (keyof typeof g.activeLayers)[]).filter(
        (k) => !g.activeLayers[k],
      )
      if (off.length === 0) return null
      const layer = rng.pick(off)
      g.activeLayers[layer] = true
      return { genome: g, mutationName: 'AddLayer', description: `enable ${layer}` }
    },
  },
  {
    name: 'RemoveLayer',
    category: 'layers',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const on = (Object.keys(g.activeLayers) as (keyof typeof g.activeLayers)[]).filter(
        (k) => g.activeLayers[k],
      )
      if (on.length <= 1) return null
      const layer = rng.pick(on)
      g.activeLayers[layer] = false
      return { genome: g, mutationName: 'RemoveLayer', description: `disable ${layer}` }
    },
  },
  {
    name: 'ChangeSwing',
    category: 'parameters',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const delta = (rng.next() - 0.5) * 0.2
      g.parameters.swing = clamp(g.parameters.swing + delta, 0, 1)
      return {
        genome: g,
        mutationName: 'ChangeSwing',
        description: `swing=${g.parameters.swing.toFixed(2)}`,
      }
    },
  },
  {
    name: 'AddDrumFill',
    category: 'rhythm',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const spb = g.stepsPerBar
      const bar = rng.int(0, g.bars - 1)
      const start = bar * spb + Math.floor(spb * 0.75)
      for (let i = start; i < (bar + 1) * spb; i++) {
        if (rng.chance(0.55)) g.drums.hihat[i] = true
        if (rng.chance(0.35)) g.drums.snare[i] = true
      }
      return {
        genome: g,
        mutationName: 'AddDrumFill',
        description: `fill bar ${bar}`,
      }
    },
  },
  {
    name: 'EchoBassNote',
    category: 'bass',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const filled = g.bass.notes
        .map((v, i) => (v !== null ? i : -1))
        .filter((i) => i >= 0)
      if (filled.length === 0) return null
      const i = rng.pick(filled)
      const gap = rng.int(1, 3)
      const j = i + gap
      if (j >= g.bass.notes.length) return null
      g.bass.notes[j] = g.bass.notes[i]
      return {
        genome: g,
        mutationName: 'EchoBassNote',
        description: `echo bass ${i}→${j}`,
      }
    },
  },
  {
    name: 'RestructureLength',
    category: 'layers',
    minIntensity: 'experimental',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const newSpb = rng.pick([...STEPS_PER_BAR_OPTIONS])
      const newBars = rng.pick([...BARS_OPTIONS])
      if (newSpb === g.stepsPerBar && newBars === g.bars) return null
      g.stepsPerBar = newSpb
      g.bars = newBars
      const n = totalSteps(g)
      g.drums.kick = resizeBool(g.drums.kick, n)
      g.drums.snare = resizeBool(g.drums.snare, n)
      g.drums.hihat = resizeBool(g.drums.hihat, n)
      g.bass.notes = resizeNotes(g.bass.notes, n)
      g.melody.notes = resizeNotes(g.melody.notes, n)
      g.chords.rhythm = resizeBool(g.chords.rhythm, n)
      const prog = g.chords.progression.slice(0, newBars)
      while (prog.length < newBars) prog.push(rng.int(0, 5))
      g.chords.progression = prog
      return {
        genome: g,
        mutationName: 'RestructureLength',
        description: `${newSpb}spb x ${newBars} bars`,
      }
    },
  },
]

function pickOp(
  rng: Rng,
  intensity: MutationIntensity,
  config: MutationConfig,
): MutationOp {
  const eligible = MUTATION_OPS.filter((op) => canApply(op, intensity))
  const weights = eligible.map((op) => Math.max(0.01, config.categoryWeights[op.category]))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i]!
    if (r <= 0) return eligible[i]!
  }
  return eligible[eligible.length - 1]!
}

/**
 * Apply one mutation. Retries a few times if an op returns null.
 * Always returns a validated genome.
 */
export function mutate(
  genome: MusicGenome,
  rng: Rng,
  options?: {
    intensity?: MutationIntensity
    config?: MutationConfig
    personality?: Personality
    forceOp?: string
  },
): MutationResult {
  const config = mergeMutationConfig(options?.config ?? DEFAULT_MUTATION_CONFIG, options?.personality)
  const intensity = options?.intensity ?? pickIntensity(rng, config)

  if (options?.forceOp) {
    const op = MUTATION_OPS.find((o) => o.name === options.forceOp)
    if (!op) throw new Error(`Unknown mutation: ${options.forceOp}`)
    const result = op.apply(cloneGenome(genome), rng, intensity)
    if (!result) {
      // Fall through to random if forced op can't apply
    } else {
      validateGenome(result.genome)
      return result
    }
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const op = pickOp(rng, intensity, config)
    const result = op.apply(cloneGenome(genome), rng, intensity)
    if (result) {
      validateGenome(result.genome)
      return result
    }
  }

  // Guaranteed no-op-safe fallback: ChangeTempo by ±1
  const g = cloneGenome(genome)
  g.tempo = clamp(g.tempo + (rng.chance(0.5) ? 1 : -1), TEMPO_MIN, TEMPO_MAX)
  validateGenome(g)
  return { genome: g, mutationName: 'ChangeTempo', description: `tempo=${g.tempo} (fallback)` }
}

/**
 * Apply N sequential mutations (for moderate/experimental bundles).
 */
export function mutateN(
  genome: MusicGenome,
  rng: Rng,
  n: number,
  options?: Parameters<typeof mutate>[2],
): MutationResult {
  let current = genome
  const names: string[] = []
  const descs: string[] = []
  for (let i = 0; i < n; i++) {
    const r = mutate(current, rng, options)
    current = r.genome
    names.push(r.mutationName)
    descs.push(r.description)
  }
  return {
    genome: current,
    mutationName: names.join('+'),
    description: descs.join('; '),
  }
}
