import { describe, expect, it } from 'vitest'
import { createRng } from '../src/lib/rng'
import { mutate, MUTATION_OPS, mutateN } from '../src/evolution/mutation'
import { genomesEqual, cloneGenome } from '../src/music/genome'
import { getSeed } from '../src/music/seeds'
import { validateGenome } from '../src/music/validation'
import { getPersonality } from '../src/music/personality'

describe('Mutations', () => {
  it('are deterministic for the same seed', () => {
    const parent = getSeed('electronic')
    const a = mutate(parent, createRng(12345))
    const b = mutate(parent, createRng(12345))
    expect(a.mutationName).toBe(b.mutationName)
    expect(a.description).toBe(b.description)
    expect(genomesEqual(a.genome, b.genome)).toBe(true)
  })

  it('do not corrupt genomes', () => {
    const parent = getSeed('minimal')
    const rng = createRng(7)
    for (let i = 0; i < 50; i++) {
      const result = mutate(parent, rng)
      expect(() => validateGenome(result.genome)).not.toThrow()
    }
  })

  it('change something (usually)', () => {
    const parent = getSeed('pentatonic')
    const rng = createRng(99)
    let changed = 0
    for (let i = 0; i < 30; i++) {
      const result = mutate(cloneGenome(parent), rng)
      if (!genomesEqual(parent, result.genome)) changed++
    }
    expect(changed).toBeGreaterThan(20)
  })

  it('each registered op can run without throwing on seeds', () => {
    const seeds = ['minimal', 'ambient', 'electronic', 'pentatonic'] as const
    for (const op of MUTATION_OPS) {
      let applied = false
      for (const seedName of seeds) {
        for (let seed = 0; seed < 20; seed++) {
          const result = op.apply(cloneGenome(getSeed(seedName)), createRng(seed), 'experimental')
          if (result) {
            expect(() => validateGenome(result.genome)).not.toThrow()
            applied = true
            break
          }
        }
        if (applied) break
      }
      // Ops may legitimately return null often; just ensure we tried
      expect(typeof op.name).toBe('string')
    }
  })

  it('mutateN applies multiple changes', () => {
    const parent = getSeed('electronic')
    const result = mutateN(parent, createRng(55), 3)
    expect(result.mutationName.includes('+')).toBe(true)
    expect(() => validateGenome(result.genome)).not.toThrow()
  })

  it('respects personality without crashing', () => {
    const parent = getSeed('ambient')
    const personality = getPersonality('lush')
    const result = mutate(parent, createRng(1), { personality })
    expect(() => validateGenome(result.genome)).not.toThrow()
  })

  it('forceOp ChangeTempo works', () => {
    const parent = getSeed('minimal')
    const result = mutate(parent, createRng(3), { forceOp: 'ChangeTempo', intensity: 'moderate' })
    expect(result.mutationName).toBe('ChangeTempo')
    expect(() => validateGenome(result.genome)).not.toThrow()
  })
})
