import { describe, expect, it } from 'vitest'
import {
  createEvolutionState,
  restoreSnapshot,
  runGenerations,
  snapshotOf,
  stepGeneration,
} from '../src/evolution/engine'
import { selectSurvivor, DEFAULT_SELECTION_CONFIG } from '../src/evolution/selection'
import { createRng } from '../src/lib/rng'
import { genomesEqual, cloneGenome } from '../src/music/genome'
import { getSeed } from '../src/music/seeds'
import { getPersonality } from '../src/music/personality'
import { channelPersonality, channelSeed, getChannel } from '../src/music/channels'

describe('Selection', () => {
  it('forceAccept picks a differing candidate', () => {
    const parent = getSeed('minimal')
    const mutant = cloneGenome(parent)
    mutant.tempo = parent.tempo + 5
    const result = selectSurvivor(
      parent,
      0.5,
      [
        {
          genome: mutant,
          fitness: 0.4,
          mutationName: 'ChangeTempo',
          description: 'tempo+5',
        },
      ],
      createRng(1),
      0,
      DEFAULT_SELECTION_CONFIG,
      { forceAccept: true },
    )
    expect(result.forceAccepted).toBe(true)
    expect(genomesEqual(result.winner.genome, mutant)).toBe(true)
  })

  it('forceAccept triggers after stagnation limit', () => {
    const parent = getSeed('minimal')
    const mutant = cloneGenome(parent)
    mutant.tempo += 3
    const result = selectSurvivor(
      parent,
      0.9,
      [{ genome: mutant, fitness: 0.2, mutationName: 'x', description: 'x' }],
      createRng(1),
      DEFAULT_SELECTION_CONFIG.stagnationLimit,
      DEFAULT_SELECTION_CONFIG,
    )
    expect(result.forceAccepted).toBe(true)
  })
})

describe('Evolution engine', () => {
  it('is reproducible for the same seed', () => {
    const genome = getSeed('electronic')
    const personality = getPersonality('driving')
    const a = runGenerations(createEvolutionState(genome, 42, { personality }), 30, {
      personality,
      now: 1,
    })
    const b = runGenerations(createEvolutionState(genome, 42, { personality }), 30, {
      personality,
      now: 1,
    })
    expect(a.generationIndex).toBe(30)
    expect(genomesEqual(a.genome, b.genome)).toBe(true)
    expect(a.fitness.score).toBe(b.fitness.score)
    expect(a.rngState).toBe(b.rngState)
  })

  it('diverges for different seeds', () => {
    const genome = getSeed('electronic')
    const a = runGenerations(createEvolutionState(genome, 1), 20)
    const b = runGenerations(createEvolutionState(genome, 2), 20)
    // Extremely unlikely to be identical after 20 gens
    expect(genomesEqual(a.genome, b.genome) && a.fitness.score === b.fitness.score).toBe(false)
  })

  it('runs hundreds of generations', () => {
    const channel = getChannel('minimal')
    const personality = channelPersonality(channel)
    const state = runGenerations(
      createEvolutionState(channelSeed(channel), 7, {
        personality,
        config: { candidatesPerGeneration: 5, historySize: 64 },
      }),
      200,
      {
        personality,
        config: { candidatesPerGeneration: 5, historySize: 64 },
      },
    )
    expect(state.generationIndex).toBe(200)
    expect(state.history.records.length).toBeLessThanOrEqual(64)
    expect(state.history.records.length).toBeGreaterThan(0)
  })

  it('bounds history size', () => {
    const state = runGenerations(
      createEvolutionState(getSeed('ambient'), 9, {
        config: { candidatesPerGeneration: 3, historySize: 10 },
      }),
      25,
      { config: { candidatesPerGeneration: 3, historySize: 10 } },
    )
    expect(state.history.records.length).toBe(10)
    expect(state.history.records[0]!.index).toBe(16) // 25-10+1 = 16? wait: start has gen0, then 25 steps → indices 0..25, keep last 10 → 16..25
  })

  it('restore snapshot continues identically', () => {
    const personality = getPersonality('groovy')
    let state = createEvolutionState(getSeed('pentatonic'), 99, { personality })
    state = runGenerations(state, 15, { personality })
    const snap = snapshotOf(state)
    const json = JSON.parse(JSON.stringify(snap)) as unknown
    const restored = restoreSnapshot(json)

    const contA = runGenerations(state, 10, { personality })
    const contB = runGenerations(restored, 10, { personality })
    expect(genomesEqual(contA.genome, contB.genome)).toBe(true)
    expect(contA.generationIndex).toBe(contB.generationIndex)
  })

  it('stepGeneration forceAccept works', () => {
    let state = createEvolutionState(getSeed('minimal'), 3, {
      config: { candidatesPerGeneration: 8 },
    })
    // Drive stagnation then force
    const result = stepGeneration(state, {
      forceAccept: true,
      config: { candidatesPerGeneration: 8 },
    })
    expect(result.forceAccepted).toBe(true)
    expect(result.state.generationIndex).toBe(1)
  })
})
