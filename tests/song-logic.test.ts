import { describe, expect, it } from 'vitest'
import { evaluateFitness } from '../src/evolution/fitness'
import { MUTATION_OPS } from '../src/evolution/mutation'
import { createEvolutionState, runGenerations } from '../src/evolution/engine'
import { createRng } from '../src/lib/rng'
import { channelPersonality, channelSeed, CHANNELS, getChannel } from '../src/music/channels'
import { applyChannelFingerprint } from '../src/music/fingerprint'
import { cloneGenome } from '../src/music/genome'
import { getPersonality } from '../src/music/personality'
import { getSeed } from '../src/music/seeds'
import { validateGenome } from '../src/music/validation'

const op = (name: string) => MUTATION_OPS.find((o) => o.name === name)!

describe('Song fitness', () => {
  it('scores each channel seed well under its own personality', () => {
    for (const c of CHANNELS) {
      const g = applyChannelFingerprint(c.id, channelSeed(c))
      expect(evaluateFitness(g, channelPersonality(c)).score).toBeGreaterThan(0.65)
    }
  })

  it('prefers bass notes that fit the chord', () => {
    const g = cloneGenome(getSeed('electronic'))
    const clash = cloneGenome(g)
    // Bar 1 chord is degree 0 (tones 0, 2, 4); put the downbeats on degree 1
    for (let i = 0; i < clash.stepsPerBar; i += 4) clash.bass.notes[i] = 1
    expect(evaluateFitness(g).metrics.harmonicConsistency).toBeGreaterThan(
      evaluateFitness(clash).metrics.harmonicConsistency,
    )
  })

  it('penalises tempo outside the genre range', () => {
    const p = getPersonality('lush')
    const g = cloneGenome(getSeed('ambient'))
    const fast = cloneGenome(g)
    fast.tempo = 160
    expect(evaluateFitness(fast, p).score).toBeLessThan(evaluateFitness(g, p).score * 0.5)
  })

  it('penalises a melody with a note on every step', () => {
    const p = getPersonality('driving')
    const g = cloneGenome(getSeed('electronic'))
    const busy = cloneGenome(g)
    busy.melody.notes = busy.melody.notes.map((n, i) => n ?? (i % 3))
    expect(evaluateFitness(busy, p).score).toBeLessThan(evaluateFitness(g, p).score)
  })

  it('gives the same rhythm score on 8- and 16-step grids', () => {
    const g16 = cloneGenome(getSeed('electronic'))
    const g8 = validateGenome(regridTo8(g16))
    expect(evaluateFitness(g8).metrics.rhythmicComplexity).toBeCloseTo(
      evaluateFitness(g16).metrics.rhythmicComplexity,
      5,
    )
  })

  it('keeps every channel inside its tempo range over a long run', () => {
    for (const id of ['house', 'downtempo']) {
      const c = getChannel(id)
      const personality = channelPersonality(c)
      const s = runGenerations(createEvolutionState(channelSeed(c), 5, { channelId: id, personality }), 300, {
        personality,
      })
      const [lo, hi] = personality.style.tempo
      expect(s.genome.tempo).toBeGreaterThanOrEqual(lo - 4)
      expect(s.genome.tempo).toBeLessThanOrEqual(hi + 4)
      for (const layer of personality.style.coreLayers) expect(s.genome.activeLayers[layer]).toBe(true)
    }
  })
})

/** Hand re-grid of a 16-step genome to 8 steps (keep the even steps). */
function regridTo8(g: ReturnType<typeof getSeed>) {
  const h = cloneGenome(g)
  const even = <T>(a: T[]) => a.filter((_, i) => i % 2 === 0)
  h.stepsPerBar = 8
  h.drums = { kick: even(h.drums.kick), snare: even(h.drums.snare), hihat: even(h.drums.hihat) }
  h.bass.notes = even(h.bass.notes)
  h.melody.notes = even(h.melody.notes)
  h.chords.rhythm = even(h.chords.rhythm)
  return h
}

describe('Song mutations', () => {
  it('re-grids 16→8 steps keeping hits on the same beats', () => {
    const g = cloneGenome(getSeed('electronic'))
    for (let seed = 0; seed < 200; seed++) {
      const r = op('RestructureLength').apply(g, createRng(seed), 'experimental')
      if (!r || r.genome.stepsPerBar !== 8 || r.genome.bars !== 4) continue
      // Kick on every beat at 16 steps (0,4,8,12) must land on 0,2,4,6 at 8 steps
      expect(r.genome.drums.kick.slice(0, 8)).toEqual([true, false, true, false, true, false, true, false])
      return
    }
    throw new Error('no 8-step restructure produced')
  })

  it('repeats bars instead of padding silence when the loop grows', () => {
    const g = cloneGenome(getSeed('electronic'))
    for (let seed = 0; seed < 200; seed++) {
      const r = op('RestructureLength').apply(g, createRng(seed), 'experimental')
      if (!r || r.genome.bars !== 8 || r.genome.stepsPerBar !== 16) continue
      expect(r.genome.drums.kick.slice(64)).toEqual(r.genome.drums.kick.slice(0, 64))
      expect(r.genome.chords.progression).toEqual([0, 5, 3, 4, 0, 5, 3, 4])
      return
    }
    throw new Error('no 8-bar restructure produced')
  })

  it('drum fills rewrite the end of the last bar instead of piling up', () => {
    let g = cloneGenome(getSeed('electronic'))
    const rng = createRng(4)
    for (let i = 0; i < 50; i++) g = op('AddDrumFill').apply(g, rng, 'moderate')!.genome
    const spb = g.stepsPerBar
    const lastBarStart = (g.bars - 1) * spb
    // Everything before the fill region is untouched
    expect(g.drums.hihat.slice(0, lastBarStart + spb * 0.75)).toEqual(
      getSeed('electronic').drums.hihat.slice(0, lastBarStart + spb * 0.75),
    )
  })

  it('modulates only to a closely related key', () => {
    const g = cloneGenome(getSeed('electronic'))
    for (let seed = 0; seed < 20; seed++) {
      const r = op('ChangeScaleRoot').apply(g, createRng(seed), 'moderate')!
      expect([(g.scale.root + 5) % 12, (g.scale.root + 7) % 12]).toContain(r.genome.scale.root)
    }
  })
})
