import { describe, expect, it } from 'vitest'
import { createRng } from '../src/lib/rng'
import {
  cloneGenome,
  deserializeGenome,
  genomesEqual,
  serializeGenome,
} from '../src/music/genome'
import { allSeeds, getSeed, SEED_NAMES } from '../src/music/seeds'
import { GenomeValidationError, isValidGenome, validateGenome } from '../src/music/validation'

describe('RNG', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('diverges for different seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a.next()).not.toBe(b.next())
  })

  it('int stays in range', () => {
    const rng = createRng(99)
    for (let i = 0; i < 100; i++) {
      const v = rng.int(3, 7)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(7)
    }
  })
})

describe('Genome validation & serialisation', () => {
  it('all seeds are valid', () => {
    for (const name of SEED_NAMES) {
      const g = getSeed(name)
      expect(isValidGenome(g)).toBe(true)
      expect(validateGenome(g)).toBe(g)
    }
  })

  it('serialise → deserialise round-trips', () => {
    const g = getSeed('electronic')
    const round = deserializeGenome(serializeGenome(g))
    expect(genomesEqual(g, round)).toBe(true)
    expect(validateGenome(round)).toEqual(g)
  })

  it('cloneGenome is deep and independent', () => {
    const g = getSeed('minimal')
    const c = cloneGenome(g)
    expect(genomesEqual(g, c)).toBe(true)
    c.drums.kick[0] = !c.drums.kick[0]
    expect(g.drums.kick[0]).not.toBe(c.drums.kick[0])
  })

  it('rejects invalid tempo', () => {
    const g = cloneGenome(getSeed('minimal'))
    ;(g as { tempo: number }).tempo = 10
    expect(() => validateGenome(g)).toThrow(GenomeValidationError)
    expect(isValidGenome(g)).toBe(false)
  })

  it('rejects wrong-length drum arrays', () => {
    const g = cloneGenome(getSeed('minimal'))
    g.drums.kick = [true, false]
    expect(() => validateGenome(g)).toThrow(/drums.kick/)
  })

  it('rejects bad scale root', () => {
    const g = cloneGenome(getSeed('ambient'))
    g.scale.root = 99
    expect(() => validateGenome(g)).toThrow(/scale.root/)
  })

  it('rejects invalid note degrees', () => {
    const g = cloneGenome(getSeed('pentatonic'))
    g.melody.notes[0] = 99
    expect(() => validateGenome(g)).toThrow(/melody.notes/)
  })

  it('rejects non-objects', () => {
    expect(() => validateGenome(null)).toThrow(GenomeValidationError)
    expect(() => validateGenome('nope')).toThrow(GenomeValidationError)
  })

  it('allSeeds returns four named genomes', () => {
    const seeds = allSeeds()
    expect(Object.keys(seeds).sort()).toEqual([...SEED_NAMES].sort())
  })
})
