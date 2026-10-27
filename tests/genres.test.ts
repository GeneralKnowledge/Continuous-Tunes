import { describe, expect, it } from 'vitest'
import { createEvolutionState } from '../src/evolution/engine'
import { evaluateFitness } from '../src/evolution/fitness'
import { composeSong } from '../src/evolution/song'
import {
  CHANNELS,
  channelKit,
  channelPersonality,
  channelSeed,
  channelSongTemplate,
  channelStorageId,
  getChannel,
} from '../src/music/channels'
import { applyChannelFingerprint } from '../src/music/fingerprint'
import { DEFAULT_KIT, KITS, getKit } from '../src/music/kits'
import { getSeed } from '../src/music/seeds'
import { validateGenome } from '../src/music/validation'
import { compileGenome, compileTimeline } from '../src/strudel/compiler'

const drumSamples = (id: string) => {
  const d = getKit(id).drums
  return [d.kick, d.snare, d.hat, d.crash, ...d.toms, ...(d.loop ? [d.loop.sample] : [])]
}

describe('Sound kits', () => {
  it('gives every channel its own kit', () => {
    for (const ch of CHANNELS) expect(channelKit(ch)).toBe(KITS[ch.id])
    expect(getKit('nope')).toBe(DEFAULT_KIT)
  })

  it('names samples by bank, never by a bare number (mini-notation reads "909" as a number)', () => {
    for (const id of Object.keys(KITS)) {
      for (const name of drumSamples(id)) expect(name.split(':')[0]).toMatch(/[a-z]/)
    }
  })

  it('keeps House and Electronic apart', () => {
    expect(drumSamples('house')).not.toEqual(drumSamples('electronic'))
    expect(KITS.house!.bass).not.toEqual(KITS.electronic!.bass)
    expect(getChannel('house').seedName).not.toBe(getChannel('electronic').seedName)
  })

  it('plays the kit in compiled code, and the default kit leaves output unchanged', () => {
    const g = getSeed('house')
    expect(compileGenome(g)).toBe(compileGenome(g, undefined, DEFAULT_KIT))
    const code = compileGenome(g, undefined, KITS.house)
    expect(code).toContain(KITS.house!.drums.kick)
    expect(code).toContain(KITS.house!.drums.snare)
    expect(code).not.toMatch(/s\("bd[ "]/)
  })

  it('compiles synth settings and a stretched break', () => {
    const trance = compileGenome(getSeed('trance'), undefined, KITS.trance)
    expect(trance).toContain('.sound("supersaw")')
    expect(trance).toMatch(/\.delaytime\([\d.]+\)/)
    const lofi = compileGenome(getSeed('lofi'), undefined, KITS.lofi)
    expect(lofi).toMatch(/\.crush\(\d+\)/)
    const dnb = compileGenome(getSeed('dnb'), undefined, KITS.dnb)
    expect(dnb).toMatch(/s\("breaks165[^"]*"\)\.fit\(\)/)
  })
})

describe('Genres', () => {
  it('has Lo-fi, Drum & Bass and Trance channels', () => {
    for (const id of ['lofi', 'dnb', 'trance']) expect(getChannel(id).id).toBe(id)
  })

  it('starts every channel from a valid seed inside its tempo range', () => {
    for (const ch of CHANNELS) {
      const g = applyChannelFingerprint(ch.id, channelSeed(ch))
      expect(() => validateGenome(g)).not.toThrow()
      const [lo, hi] = channelPersonality(ch).style.tempo
      expect(g.tempo).toBeGreaterThanOrEqual(lo)
      expect(g.tempo).toBeLessThanOrEqual(hi)
    }
  })

  it('scores every seed well under its own fitness rules', () => {
    for (const ch of CHANNELS) {
      const g = applyChannelFingerprint(ch.id, channelSeed(ch))
      expect(evaluateFitness(g, channelPersonality(ch)).score, ch.id).toBeGreaterThan(0.7)
    }
  })

  it('composes and compiles a song for every channel', () => {
    for (const ch of CHANNELS) {
      const personality = channelPersonality(ch)
      const state = createEvolutionState(applyChannelFingerprint(ch.id, channelSeed(ch)), 3, {
        channelId: ch.id,
        personality,
      })
      const song = composeSong(state, { template: channelSongTemplate(ch), length: 'short', personality })
      expect(song.sections.length).toBeGreaterThan(2)
      const code = compileTimeline([{ startCycle: 0, sections: song.sections }], state.genome.tempo, undefined, channelKit(ch))
      expect(code).toContain('arrange(')
    }
  })

  it('keeps the dnb two-step and four-on-the-floor for trance', () => {
    const dnb = applyChannelFingerprint('dnb', getSeed('dnb'))
    const beat = dnb.stepsPerBar / 4
    expect(dnb.drums.kick[0]).toBe(true)
    expect(dnb.drums.snare[beat]).toBe(true)
    expect(dnb.drums.snare[3 * beat]).toBe(true)
    const trance = applyChannelFingerprint('trance', getSeed('trance'))
    for (let i = 0; i < trance.stepsPerBar; i += trance.stepsPerBar / 4) expect(trance.drums.kick[i]).toBe(true)
  })

  it('stores reseeded channels under a new id so old saves do not override the new sound', () => {
    expect(channelStorageId(getChannel('house'))).toBe('house@v2')
    expect(channelStorageId(getChannel('minimal'))).toBe('minimal@v2')
    expect(channelStorageId(getChannel('electronic'))).toBe('electronic')
  })
})
