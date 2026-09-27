import type { Rng } from '../lib/rng'
import type { MusicGenome } from '../music/genome'
import { genomesEqual } from '../music/genome'

export interface Candidate {
  genome: MusicGenome
  fitness: number
  mutationName: string
  description: string
}

export interface SelectionResult {
  winner: Candidate
  /** True when anti-stagnation forced an experimental accept. */
  forceAccepted: boolean
  exploredWorse: boolean
}

export interface SelectionConfig {
  /** Probability of accepting a slightly worse candidate for exploration. */
  exploreWorseProbability: number
  /** How much worse (absolute fitness delta) is still acceptable when exploring. */
  exploreWorseMargin: number
  /** After this many unchanged generations, force-accept best experimental. */
  stagnationLimit: number
}

export const DEFAULT_SELECTION_CONFIG: SelectionConfig = {
  exploreWorseProbability: 0.18,
  exploreWorseMargin: 0.08,
  stagnationLimit: 8,
}

/**
 * Raise exploration budget as stagnation grows (before force-accept kicks in).
 * Same seed + streak ⇒ same effective config (deterministic).
 */
export function selectionWithStagnation(
  config: SelectionConfig,
  stagnationStreak: number,
): SelectionConfig {
  const t = Math.min(1, stagnationStreak / Math.max(1, config.stagnationLimit))
  return {
    ...config,
    exploreWorseProbability: Math.min(0.85, config.exploreWorseProbability + t * 0.45),
    exploreWorseMargin: Math.min(0.25, config.exploreWorseMargin + t * 0.12),
  }
}

/**
 * Select next parent from candidates.
 * Prefers higher fitness; occasionally accepts slightly worse (exploration).
 * Anti-stagnation: after N unchanged steps, force-accept best experimental mutant.
 */
export function selectSurvivor(
  parent: MusicGenome,
  parentFitness: number,
  candidates: Candidate[],
  rng: Rng,
  stagnationStreak: number,
  config: SelectionConfig = DEFAULT_SELECTION_CONFIG,
  options?: { forceAccept?: boolean },
): SelectionResult {
  if (candidates.length === 0) {
    return {
      winner: {
        genome: parent,
        fitness: parentFitness,
        mutationName: 'none',
        description: 'no candidates',
      },
      forceAccepted: false,
      exploredWorse: false,
    }
  }

  const effective = selectionWithStagnation(config, stagnationStreak)
  const sorted = [...candidates].sort((a, b) => b.fitness - a.fitness)
  const best = sorted[0]!

  const forceAccept =
    options?.forceAccept === true || stagnationStreak >= config.stagnationLimit

  if (forceAccept) {
    const different = sorted.find((c) => !genomesEqual(c.genome, parent)) ?? best
    return { winner: different, forceAccepted: true, exploredWorse: false }
  }

  if (best.fitness >= parentFitness) {
    return { winner: best, forceAccepted: false, exploredWorse: false }
  }

  if (
    parentFitness - best.fitness <= effective.exploreWorseMargin &&
    rng.chance(effective.exploreWorseProbability)
  ) {
    return { winner: best, forceAccepted: false, exploredWorse: true }
  }

  return {
    winner: {
      genome: parent,
      fitness: parentFitness,
      mutationName: 'retain',
      description: 'kept parent',
    },
    forceAccepted: false,
    exploredWorse: false,
  }
}
