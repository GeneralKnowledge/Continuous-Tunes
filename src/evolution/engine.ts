import { createRng } from '../lib/rng'
import { cloneGenome, genomesEqual, type MusicGenome } from '../music/genome'
import { applyChannelFingerprint } from '../music/fingerprint'
import type { Personality } from '../music/personality'
import { evaluateFitness, type FitnessResult } from './fitness'
import {
  createHistory,
  pushGeneration,
  type GenerationHistory,
  type GenerationRecord,
} from './generation'
import {
  DEFAULT_MUTATION_CONFIG,
  intensityWithStagnation,
  mutate,
  mutateN,
  pickIntensity,
  type MutationConfig,
} from './mutation'
import {
  DEFAULT_SELECTION_CONFIG,
  selectSurvivor,
  type Candidate,
  type SelectionConfig,
} from './selection'

export interface EvolutionConfig {
  candidatesPerGeneration: number
  mutation: MutationConfig
  selection: SelectionConfig
  historySize: number
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  candidatesPerGeneration: 10,
  mutation: DEFAULT_MUTATION_CONFIG,
  selection: DEFAULT_SELECTION_CONFIG,
  historySize: 64,
}

export interface EvolutionState {
  generationIndex: number
  genome: MusicGenome
  fitness: FitnessResult
  /** Fitness of the previous accepted generation (for UI delta). */
  previousFitness: number
  /** Original user seed (for display / reproducibility labels). */
  rngSeed: number
  /** Current Mulberry32 state for resume. */
  rngState: number
  stagnationStreak: number
  history: GenerationHistory
  lastMutationName: string
  lastDescription: string
  channelId?: string
  /** Optional bookmarked generation index within history. */
  bookmarkIndex: number | null
}

export interface StepResult {
  state: EvolutionState
  accepted: boolean
  forceAccepted: boolean
  exploredWorse: boolean
  candidates: Candidate[]
  fitnessDelta: number
}

export function createEvolutionState(
  genome: MusicGenome,
  rngSeed: number,
  options?: {
    personality?: Personality
    config?: Partial<EvolutionConfig>
    channelId?: string
  },
): EvolutionState {
  const config = { ...DEFAULT_EVOLUTION_CONFIG, ...options?.config }
  const seeded =
    options?.channelId !== undefined
      ? applyChannelFingerprint(options.channelId, genome)
      : cloneGenome(genome)
  const fitness = evaluateFitness(seeded, options?.personality)
  const record: GenerationRecord = {
    index: 0,
    genome: cloneGenome(seeded),
    fitness: fitness.score,
    metrics: fitness.metrics,
    mutationName: 'seed',
    description: 'initial seed',
    forceAccepted: false,
    exploredWorse: false,
    timestamp: 0,
  }
  return {
    generationIndex: 0,
    genome: cloneGenome(seeded),
    fitness,
    previousFitness: fitness.score,
    rngSeed,
    rngState: rngSeed >>> 0,
    stagnationStreak: 0,
    history: pushGeneration(createHistory(config.historySize), record),
    lastMutationName: 'seed',
    lastDescription: 'initial seed',
    channelId: options?.channelId,
    bookmarkIndex: null,
  }
}

/**
 * Run one generation: mutate N candidates, evaluate, select survivor.
 */
export function stepGeneration(
  state: EvolutionState,
  options?: {
    personality?: Personality
    config?: Partial<EvolutionConfig>
    forceAccept?: boolean
    now?: number
  },
): StepResult {
  const config: EvolutionConfig = {
    ...DEFAULT_EVOLUTION_CONFIG,
    ...options?.config,
    mutation: options?.config?.mutation ?? DEFAULT_EVOLUTION_CONFIG.mutation,
    selection: options?.config?.selection ?? DEFAULT_EVOLUTION_CONFIG.selection,
  }

  const rng = createRng(state.rngState)
  const mutConfig = intensityWithStagnation(
    config.mutation,
    state.stagnationStreak,
    config.selection.stagnationLimit,
  )

  const candidates: Candidate[] = []
  const n = config.candidatesPerGeneration

  for (let i = 0; i < n; i++) {
    const intensity = pickIntensity(rng, mutConfig)
    const mutCount =
      intensity === 'experimental' ? rng.int(2, 3) : intensity === 'moderate' ? rng.int(1, 2) : 1
    const mutation =
      mutCount > 1
        ? mutateN(state.genome, rng, mutCount, {
            intensity,
            config: mutConfig,
            personality: options?.personality,
          })
        : mutate(state.genome, rng, {
            intensity,
            config: mutConfig,
            personality: options?.personality,
          })
    const fingerprinted =
      state.channelId !== undefined
        ? applyChannelFingerprint(state.channelId, mutation.genome)
        : mutation.genome
    const fit = evaluateFitness(fingerprinted, options?.personality)
    candidates.push({
      genome: fingerprinted,
      fitness: fit.score,
      mutationName: mutation.mutationName,
      description: mutation.description,
    })
  }

  const selection = selectSurvivor(
    state.genome,
    state.fitness.score,
    candidates,
    rng,
    state.stagnationStreak,
    config.selection,
    { forceAccept: options?.forceAccept },
  )

  const winner = selection.winner
  const changed = !genomesEqual(winner.genome, state.genome)
  const fitness = evaluateFitness(winner.genome, options?.personality)
  const fitnessDelta = fitness.score - state.fitness.score

  const generationIndex = state.generationIndex + 1
  const record: GenerationRecord = {
    index: generationIndex,
    genome: cloneGenome(winner.genome),
    fitness: fitness.score,
    metrics: fitness.metrics,
    mutationName: winner.mutationName,
    description: winner.description,
    forceAccepted: selection.forceAccepted,
    exploredWorse: selection.exploredWorse,
    timestamp: options?.now ?? 0,
  }

  const history = pushGeneration(
    { ...state.history, maxSize: config.historySize },
    record,
  )

  const newState: EvolutionState = {
    generationIndex,
    genome: cloneGenome(winner.genome),
    fitness,
    previousFitness: state.fitness.score,
    rngSeed: state.rngSeed,
    rngState: rng.getState(),
    stagnationStreak: changed ? 0 : state.stagnationStreak + 1,
    history,
    lastMutationName: winner.mutationName,
    lastDescription: winner.description,
    channelId: state.channelId,
    bookmarkIndex: state.bookmarkIndex,
  }

  return {
    state: newState,
    accepted: changed,
    forceAccepted: selection.forceAccepted,
    exploredWorse: selection.exploredWorse,
    candidates,
    fitnessDelta,
  }
}

/** Run many generations headlessly. */
export function runGenerations(
  initial: EvolutionState,
  count: number,
  options?: Parameters<typeof stepGeneration>[1],
): EvolutionState {
  let state = initial
  for (let i = 0; i < count; i++) {
    state = stepGeneration(state, options).state
  }
  return state
}

/** Bookmark current generation index. */
export function setBookmark(state: EvolutionState, index: number | null): EvolutionState {
  return { ...state, bookmarkIndex: index }
}

/**
 * Rewind genome/fitness to a generation still in bounded history.
 * Keeps RNG state so future evolution continues (does not time-travel RNG).
 */
export function rewindToGeneration(state: EvolutionState, index: number): EvolutionState | null {
  const record = state.history.records.find((r) => r.index === index)
  if (!record) return null
  return {
    ...state,
    generationIndex: record.index,
    genome: cloneGenome(record.genome),
    previousFitness: state.fitness.score,
    fitness: {
      score: record.fitness,
      metrics: record.metrics,
    },
    lastMutationName: record.mutationName,
    lastDescription: `rewind: ${record.description}`,
    stagnationStreak: 0,
  }
}

export interface EvolutionSnapshot {
  version: 1
  state: EvolutionState
}

export function snapshotOf(state: EvolutionState): EvolutionSnapshot {
  return { version: 1, state }
}

export function restoreSnapshot(raw: unknown): EvolutionState {
  const snap = raw as EvolutionSnapshot
  if (!snap || snap.version !== 1 || !snap.state) {
    throw new Error('Invalid evolution snapshot')
  }
  // Back-compat for older snapshots missing new fields
  const s = snap.state
  return {
    ...s,
    previousFitness: s.previousFitness ?? s.fitness.score,
    bookmarkIndex: s.bookmarkIndex ?? null,
  }
}
