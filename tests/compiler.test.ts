import { describe, expect, it } from 'vitest'
import { compileGenome, summarizeGenome } from '../src/strudel/compiler'
import { getSeed } from '../src/music/seeds'
import { allSeeds } from '../src/music/seeds'

describe('Strudel compiler', () => {
  it('emits setcps/stack style Strudel', () => {
    const code = compileGenome(getSeed('electronic'))
    expect(code).toMatch(/^setcps\(/)
    expect(code).toContain('stack(')
    expect(code).toContain('s("')
    expect(code).toContain('note("')
  })

  it('compiles all seeds without throwing', () => {
    for (const g of Object.values(allSeeds())) {
      const code = compileGenome(g)
      expect(code.length).toBeGreaterThan(20)
      expect(code).toContain('setcps')
      expect(code).toContain('stack')
    }
  })

  it('omits inactive layers', () => {
    const g = getSeed('minimal')
    // minimal has melody/chords off
    const code = compileGenome(g)
    expect(g.activeLayers.melody).toBe(false)
    // bass + drums present
    expect(code).toContain('bd')
    expect(code).toContain('sawtooth')
  })

  it('ambient has no drums in output when drums inactive', () => {
    const g = getSeed('ambient')
    expect(g.activeLayers.drums).toBe(false)
    const code = compileGenome(g)
    expect(code).not.toContain('bd')
  })

  it('summarizeGenome is readable', () => {
    const s = summarizeGenome(getSeed('pentatonic'))
    expect(s).toContain('bpm')
    expect(s).toContain('pentatonic')
  })

  it('empty layers still produce valid silence stack', () => {
    const g = getSeed('minimal')
    g.activeLayers = { drums: false, bass: false, melody: false, chords: false }
    const code = compileGenome(g)
    expect(code).toContain('stack(')
    expect(code).toContain('s("~")')
  })
})
