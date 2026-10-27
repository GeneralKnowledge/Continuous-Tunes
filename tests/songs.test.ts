import { describe, expect, it } from 'vitest'
import { createEvolutionState } from '../src/evolution/engine'
import { composeSong, positionInSong } from '../src/evolution/song'
import { createSongController } from '../src/evolution/songs'
import { channelPersonality, channelSeed, channelSongTemplate, getChannel } from '../src/music/channels'
import { getSongTemplate, planForm } from '../src/music/form'
import { cloneGenome } from '../src/music/genome'
import { getSeed } from '../src/music/seeds'
import {
  compileGenome,
  compileTimeline,
  levelForEnergy,
  renderForSection,
  sectionTransition,
  songBars,
  type SongSection,
  type ScheduledSong,
} from '../src/strudel/compiler'

const bars = (sections: { bars: number }[]) => sections.reduce((a, s) => a + s.bars, 0)

describe('Song forms', () => {
  it('sizes sections in whole phrases close to the target length', () => {
    const form = planForm(getSongTemplate('groovy'), 124, 'medium')
    for (const s of form) {
      expect(s.bars % 4).toBe(0)
      expect(s.bars).toBeGreaterThanOrEqual(4)
    }
    const minutes = (bars(form) * 4) / 124
    expect(minutes).toBeGreaterThan(4)
    expect(minutes).toBeLessThan(5)
  })

  it('makes ambient songs longer than house songs, and long longer than short', () => {
    const house = bars(planForm(getSongTemplate('groovy'), 124, 'medium'))
    const ambient = bars(planForm(getSongTemplate('lush'), 72, 'medium'))
    expect((ambient * 4) / 72).toBeGreaterThan((house * 4) / 124)
    const short = bars(planForm(getSongTemplate('groovy'), 124, 'short'))
    const long = bars(planForm(getSongTemplate('groovy'), 124, 'long'))
    expect(short).toBeLessThan(house)
    expect(long).toBeGreaterThan(house)
  })
})

describe('Composing a song', () => {
  const channel = getChannel('house')
  const personality = channelPersonality(channel)
  const start = createEvolutionState(channelSeed(channel), 7, { channelId: 'house', personality })

  it('evolves once per section boundary with tempo and key frozen', () => {
    const song = composeSong(start, {
      template: channelSongTemplate(channel),
      length: 'medium',
      personality,
    })
    const template = channelSongTemplate(channel)
    expect(song.sections).toHaveLength(template.sections.length)
    expect(song.startGeneration).toBe(0)
    expect(song.state.generationIndex).toBe(template.sections.length - 1)
    for (const s of song.sections) {
      expect(s.genome.tempo).toBe(start.genome.tempo)
      expect(s.genome.scale).toEqual(start.genome.scale)
    }
  })

  it('locates a bar inside the song', () => {
    const song: ScheduledSong = {
      startCycle: 0,
      sections: [
        { role: 'intro', bars: 8, energy: 0.3, genome: start.genome },
        { role: 'drop', bars: 16, energy: 1, genome: start.genome },
      ],
    }
    expect(positionInSong(song, 0)).toMatchObject({ sectionIndex: 0, barsLeftInSection: 8 })
    expect(positionInSong(song, 10.5)).toMatchObject({
      sectionIndex: 1,
      barInSection: 2,
      barsLeftInSection: 14,
      barsLeftInSong: 14,
    })
    expect(positionInSong(song, 24)).toBeNull()
  })
})

describe('Song rendering', () => {
  it('plays one bar per cycle (the loop is slowed by its bar count)', () => {
    const g = getSeed('electronic')
    const code = compileGenome(g)
    expect(code).toContain(`.slow(${g.bars})`)
    expect(code).toMatch(/^setcps\(0\.51667\)/) // 124 BPM / 4 beats per bar / 60
  })

  it('swings by delaying off-beat steps by a fraction of one step', () => {
    const g = cloneGenome(getSeed('electronic'))
    g.parameters.swing = 0.2
    const code = compileGenome(g)
    expect(code).not.toContain('swingBy')
    // 0.2 of a step; a step is 1/64 of the 4-bar, 16-step loop before .slow(4)
    expect(code).toContain(`.late(${0.2 / 64})`)
  })

  it('thins the arrangement at low energy and drops kick and bass in a breakdown', () => {
    expect(renderForSection('intro', 0.1, undefined, 8)).toMatchObject({
      drums: 'off',
      bass: false,
      melody: false,
      chords: true,
    })
    expect(renderForSection('drop', 1, undefined, 32)).toMatchObject({
      drums: 'full',
      bass: true,
      melody: true,
    })
    expect(renderForSection('breakdown', 0.35, undefined, 16)).toMatchObject({
      drums: 'light',
      bass: false,
      melody: true,
    })
  })

  it('plays quiet sections quieter and ramps the level across a build', () => {
    expect(levelForEnergy(1)).toBe(1)
    // about 7.5 dB below a drop
    expect(20 * Math.log10(levelForEnergy(0.3))).toBeLessThan(-7)
    expect(renderForSection('build', 0.6, 0.9, 8).level).toEqual({
      from: levelForEnergy(0.6),
      to: levelForEnergy(0.9),
    })
    const g = getSeed('electronic')
    const code = compileTimeline(
      [{ startCycle: 0, sections: [{ role: 'build', bars: 8, energy: 0.6, energyEnd: 0.9, genome: g }] }],
      g.tempo,
    )
    expect(code).toContain(`.velocity(saw.range(${levelForEnergy(0.6)}, ${levelForEnergy(0.9)}).slow(8))`)
  })

  it('sweeps the filter across a build', () => {
    const r = renderForSection('build', 0.6, 0.9, 8)
    expect(r.sweep).toEqual({ from: expect.any(Number), to: expect.any(Number), bars: 8 })
    expect(r.sweep!.to).toBeGreaterThan(r.sweep!.from)
  })

  it('leads into every section of a song and lands drops on a crash', () => {
    const g = getSeed('electronic')
    const sections: SongSection[] = planForm(getSongTemplate('groovy'), g.tempo, 'medium').map((s) => ({
      ...s,
      genome: g,
    }))
    const t = sections.map((_, i) => sectionTransition(sections, i))
    const roles = sections.map((s) => s.role)
    // intro, groove, build, drop, breakdown, build, drop, outro
    expect(t.map((x) => x.fill)).toEqual(['roll', 'tom', 'build', 'tom', 'tom', 'build', 'tom', null])
    expect(roles.filter((_, i) => t[i]!.crash)).toEqual(['drop', 'drop'])
    expect(roles.filter((_, i) => t[i]!.ramp)).toEqual(['build', 'build'])
  })

  it('uses a hi-hat riser out of a section without drums', () => {
    const g = getSeed('electronic')
    const sections: SongSection[] = [
      { role: 'intro', bars: 8, energy: 0.1, genome: g },
      { role: 'groove', bars: 8, energy: 0.6, genome: g },
    ]
    expect(sectionTransition(sections, 0).fill).toBe('riser')
    const code = compileTimeline([{ startCycle: 0, sections }], g.tempo)
    expect(code).toContain('s("hh*16").gain(saw.range(0.05, 0.5))')
  })

  it('leaves out fills, ramps and crashes when drums are muted', () => {
    const g = getSeed('electronic')
    const sections: SongSection[] = [
      { role: 'build', bars: 4, energy: 0.6, energyEnd: 0.9, genome: g },
      { role: 'drop', bars: 8, energy: 1, genome: g },
    ]
    const code = compileTimeline([{ startCycle: 0, sections }], g.tempo, { drums: true })
    expect(code).not.toMatch(/"(bd|sd|hh|cr|ht|mt|lt)[ *"]/)
  })

  it('places songs on absolute cycles and repeats the last song as a safety net', () => {
    const g = getSeed('electronic')
    const a: ScheduledSong = {
      startCycle: 5,
      sections: [
        { role: 'intro', bars: 8, energy: 0.3, genome: g },
        { role: 'drop', bars: 16, energy: 1, genome: g },
      ],
    }
    const code = compileTimeline([a], g.tempo)
    expect(code).toContain('[5, silence]')
    // Played once, then repeated as the safety net
    expect(code.match(/\[24, song0\]/g)).toHaveLength(2)
    expect(code).toContain('const song0 = arrange(')
    // intro: 7 bars, then a snare roll into the drop; drop: a crash bar, then the rest
    expect(code).toContain('[7, stack(song0s0d, song0s0t).velocity(0.415)]')
    expect(code).toMatch(/\[1, stack\(song0s0t, /)
    expect(code).toMatch(/\[1, stack\(song0s1d, song0s1t, s\("cr"\)/)
    expect(code).toMatch(/\[15, stack\(song0s1d, song0s1t\)\.early\(1\)\]/)
  })

  it('speeds a song at another tempo up to the base tempo', () => {
    const g = getSeed('electronic')
    const faster = cloneGenome(g)
    faster.tempo = g.tempo * 1.25
    const a: ScheduledSong = { startCycle: 0, sections: [{ role: 'drop', bars: 16, energy: 1, genome: g }] }
    const b: ScheduledSong = {
      startCycle: 16,
      sections: [{ role: 'drop', bars: 20, energy: 1, genome: faster }],
    }
    const code = compileTimeline([a, b], g.tempo)
    expect(code).toContain('[16, song1]')
    // 20 bars at 1.25× the base tempo take 16 base cycles
    expect(code).toMatch(/const song1 = arrange\([\s\S]*\)\.fast\(1\.25\)\n/)
  })
})

describe('Song controller', () => {
  it('queues the next song halfway through and moves on when it starts', () => {
    const channel = getChannel('minimal')
    const personality = channelPersonality(channel)
    let state = createEvolutionState(channelSeed(channel), 3, { channelId: 'minimal', personality })
    let cycle = 0
    const sent: string[] = []
    const timers: { at: number; fn: () => void }[] = []

    const ctrl = createSongController({
      getState: () => state,
      setState: (s) => {
        state = s
      },
      now: () => cycle,
      play: (code) => {
        sent.push(code)
        return Promise.resolve()
      },
      template: () => channelSongTemplate(channel),
      length: () => 'short',
      personality: () => personality,
      config: () => undefined,
      mutes: () => ({}),
      setTimeoutFn: (fn) => {
        timers.push({ at: cycle, fn })
        return 0 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeoutFn: () => {},
    })
    // Run due timers after moving the clock
    const advanceTo = (c: number) => {
      cycle = c
      // Fire the timers that were pending; ones they re-arm wait for the next advance
      for (const t of timers.splice(0)) t.fn()
    }

    ctrl.start()
    expect(sent).toHaveLength(1)
    const first = ctrl.songs()[0]!
    expect(first.startCycle).toBe(1)
    const length = songBars(first)

    advanceTo(1 + length / 4)
    expect(ctrl.nowPlaying()?.song.number).toBe(1)
    expect(sent).toHaveLength(1)

    advanceTo(1 + length / 2)
    expect(sent).toHaveLength(2)
    expect(ctrl.songs().map((s) => s.number)).toEqual([1, 2])
    const second = ctrl.songs()[1]!
    expect(second.startCycle).toBe(1 + length)

    advanceTo(second.startCycle + 0.5)
    expect(ctrl.songs().map((s) => s.number)).toEqual([2])
    expect(ctrl.nowPlaying()).toMatchObject({ song: { number: 2 }, position: { sectionIndex: 0 } })

    ctrl.stop()
    expect(ctrl.isRunning()).toBe(false)
  })
})
