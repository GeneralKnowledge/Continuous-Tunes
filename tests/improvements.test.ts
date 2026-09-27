import { describe, expect, it } from 'vitest'
import {
  selectionWithStagnation,
  selectSurvivor,
  DEFAULT_SELECTION_CONFIG,
} from '../src/evolution/selection'
import { intensityWithStagnation, DEFAULT_MUTATION_CONFIG } from '../src/evolution/mutation'
import {
  createEvolutionState,
  rewindToGeneration,
  setBookmark,
  stepGeneration,
  runGenerations,
} from '../src/evolution/engine'
import { applyChannelFingerprint } from '../src/music/fingerprint'
import { compileGenome } from '../src/strudel/compiler'
import { createRng } from '../src/lib/rng'
import { cloneGenome } from '../src/music/genome'
import { getSeed } from '../src/music/seeds'

describe('Anti-plateau selection & mutation', () => {
  it('raises exploration probability with stagnation', () => {
    const base = DEFAULT_SELECTION_CONFIG
    const low = selectionWithStagnation(base, 0)
    const mid = selectionWithStagnation(base, 4)
    const high = selectionWithStagnation(base, 8)
    expect(low.exploreWorseProbability).toBe(base.exploreWorseProbability)
    expect(mid.exploreWorseProbability).toBeGreaterThan(low.exploreWorseProbability)
    expect(high.exploreWorseProbability).toBeGreaterThan(mid.exploreWorseProbability)
    expect(high.exploreWorseMargin).toBeGreaterThan(base.exploreWorseMargin)
  })

  it('shifts intensity toward experimental with stagnation', () => {
    const base = DEFAULT_MUTATION_CONFIG
    const hot = intensityWithStagnation(base, 8, 8)
    expect(hot.intensityProbabilities.experimental).toBeGreaterThan(
      base.intensityProbabilities.experimental,
    )
    expect(hot.intensityProbabilities.small).toBeLessThan(base.intensityProbabilities.small)
  })

  it('explore-worse path can accept with high stagnation config', () => {
    const parent = getSeed('minimal')
    const mutant = cloneGenome(parent)
    mutant.tempo += 2
    let explored = false
    for (let seed = 0; seed < 40; seed++) {
      const result = selectSurvivor(
        parent,
        0.9,
        [{ genome: mutant, fitness: 0.85, mutationName: 't', description: 't' }],
        createRng(seed),
        6,
        DEFAULT_SELECTION_CONFIG,
      )
      if (result.exploredWorse) {
        explored = true
        break
      }
    }
    expect(explored).toBe(true)
  })
})

describe('Rewind & bookmark', () => {
  it('rewinds to a generation still in history', () => {
    let state = createEvolutionState(getSeed('electronic'), 11)
    state = runGenerations(state, 5, { config: { candidatesPerGeneration: 4, historySize: 64 } })
    const target = state.history.records[2]!
    const rewound = rewindToGeneration(state, target.index)
    expect(rewound).not.toBeNull()
    expect(rewound!.generationIndex).toBe(target.index)
    expect(rewound!.genome.tempo).toBe(target.genome.tempo)
  })

  it('setBookmark stores index', () => {
    const state = createEvolutionState(getSeed('minimal'), 1)
    const booked = setBookmark(state, 0)
    expect(booked.bookmarkIndex).toBe(0)
  })
})

describe('Channel fingerprint', () => {
  it('house forces four-on-floor kicks', () => {
    const g = cloneGenome(getSeed('electronic'))
    g.drums.kick = g.drums.kick.map(() => false)
    const out = applyChannelFingerprint('house', g)
    const step = Math.floor(out.stepsPerBar / 4)
    expect(out.drums.kick[0]).toBe(true)
    expect(out.drums.kick[step]).toBe(true)
    expect(out.activeLayers.drums).toBe(true)
  })

  it('ambient clears snares', () => {
    const g = cloneGenome(getSeed('ambient'))
    g.drums.snare = g.drums.snare.map(() => true)
    const out = applyChannelFingerprint('ambient', g)
    expect(out.drums.snare.every((x) => !x)).toBe(true)
  })
})

describe('Compiler mutes', () => {
  it('omits muted layers from output', () => {
    const g = getSeed('electronic')
    const full = compileGenome(g)
    const muted = compileGenome(g, { drums: true })
    expect(full).toContain('bd')
    expect(muted).not.toContain('bd')
    expect(muted).toContain('sawtooth')
  })
})

describe('Fitness delta tracking', () => {
  it('tracks previousFitness across a step', () => {
    const state = createEvolutionState(getSeed('pentatonic'), 3)
    expect(state.previousFitness).toBe(state.fitness.score)
    const before = state.fitness.score
    const result = stepGeneration(state, {
      forceAccept: true,
      config: { candidatesPerGeneration: 6 },
    })
    expect(result.state.previousFitness).toBe(before)
    expect(typeof result.fitnessDelta).toBe('number')
  })
})
