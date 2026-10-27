import { describe, expect, it } from 'vitest'
import { createEvolutionState, type EvolutionState } from '../src/evolution/engine'
import { composeNextSong, composeSong, evaluateSong } from '../src/evolution/song'
import {
  SONG_HISTORY_LIMIT,
  addToHistory,
  createSongController,
  songRecord,
  type PlannedSong,
  type SongRecord,
} from '../src/evolution/songs'
import { CHANNELS, channelPersonality, channelSeed, channelSongTemplate, getChannel } from '../src/music/channels'
import { HIGHLIGHT_ROLES, getSongTemplate, planForm, varyForm } from '../src/music/form'
import { validateGenome } from '../src/music/validation'
import { createRng } from '../src/lib/rng'
import { MemoryStorage, clearChannel, loadSongHistory, saveSongHistory } from '../src/persistence/session'
import { compileTimeline, songBars, songCycles } from '../src/strudel/compiler'

const total = (form: readonly { bars: number }[]) => form.reduce((a, s) => a + s.bars, 0)

describe('Form mutation', () => {
  it('varies a form inside the genre: intro, outro, builds into highlights, whole phrases', () => {
    for (const id of ['groovy', 'sparse', 'lush', 'chill', 'dusty', 'rolling', 'euphoric', 'folk']) {
      const planned = planForm(getSongTemplate(id), 124, 'medium')
      let changed = 0
      for (let seed = 1; seed <= 40; seed++) {
        const { form, changes } = varyForm(planned, createRng(seed), 2)
        if (changes.length > 0) changed++
        expect(form[0]!.role).toBe('intro')
        expect(form[form.length - 1]!.role).toBe('outro')
        expect(form.some((s) => HIGHLIGHT_ROLES.has(s.role))).toBe(true)
        form.forEach((s, i) => {
          expect(s.bars % 4).toBe(0)
          expect(s.bars).toBeGreaterThanOrEqual(4)
          if (s.role === 'build') expect(HIGHLIGHT_ROLES.has(form[i + 1]!.role)).toBe(true)
        })
        expect(total(form)).toBeGreaterThanOrEqual(total(planned) * 0.75)
        expect(total(form)).toBeLessThanOrEqual(total(planned) * 1.35)
      }
      expect(changed, id).toBeGreaterThan(35)
    }
  })

  it('is deterministic for a seed and leaves the input alone', () => {
    const planned = planForm(getSongTemplate('groovy'), 124, 'medium')
    const copy = structuredClone(planned)
    expect(varyForm(planned, createRng(9), 2)).toEqual(varyForm(planned, createRng(9), 2))
    expect(planned).toEqual(copy)
  })

  it('gives the next song a varied form and says how', () => {
    const ch = getChannel('house')
    const personality = channelPersonality(ch)
    const state = createEvolutionState(channelSeed(ch), 5, { channelId: 'house', personality })
    const options = { template: channelSongTemplate(ch), length: 'medium' as const, personality }
    const first = composeSong(state, options)
    expect(first.formChanges).toEqual([])
    const next = composeNextSong(first.state, options)
    expect(next.formChanges.length).toBeGreaterThan(0)
    const shape = (s: { sections: { role: string; bars: number; energy: number }[] }) => s.sections.map((x) => `${x.role}${x.bars}@${x.energy}`)
    expect(shape(next)).not.toEqual(shape(first))
  })
})

describe('An hour of songs', () => {
  it('plays distinct songs, each grown from the last, on every channel', () => {
    for (const ch of CHANNELS) {
      const personality = channelPersonality(ch)
      const options = { template: channelSongTemplate(ch), length: 'medium' as const, personality }
      let state: EvolutionState = createEvolutionState(channelSeed(ch), 21, { channelId: ch.id, personality })
      let song = composeSong(state, options)
      let minutes = 0
      const forms = new Set<string>()
      const themes = new Set<string>()
      let count = 0
      while (minutes < 60) {
        const theme = song.sections[0]!.genome
        minutes += (total(song.sections) * 4) / theme.tempo
        count++
        forms.add(song.sections.map((s) => `${s.role}${s.bars}`).join(' '))
        themes.add(JSON.stringify([theme.melody.notes, theme.bass.notes, theme.chords.progression, theme.drums]))
        for (const s of song.sections) expect(() => validateGenome(s.genome)).not.toThrow()
        expect(evaluateSong(song.sections).score, ch.id).toBeGreaterThan(0.6)

        state = song.state
        const next = composeNextSong(state, options)
        const nextTheme = next.sections[0]!.genome
        // Grown from the last: the tempo stays in the genre and moves by small steps
        const [lo, hi] = personality.style.tempo
        expect(nextTheme.tempo).toBeGreaterThanOrEqual(lo - 10)
        expect(nextTheme.tempo).toBeLessThanOrEqual(hi + 10)
        expect(Math.abs(nextTheme.tempo - theme.tempo)).toBeLessThanOrEqual(16)
        song = next
      }
      expect(count, ch.id).toBeGreaterThanOrEqual(8)
      // Distinct: most songs have their own theme, and forms vary
      expect(themes.size / count, ch.id).toBeGreaterThan(0.8)
      expect(forms.size, ch.id).toBeGreaterThan(2)
    }
  })
})

describe('Next song and next section', () => {
  function harness() {
    const channel = getChannel('house')
    const personality = channelPersonality(channel)
    let state = createEvolutionState(channelSeed(channel), 3, { channelId: 'house', personality })
    let cycle = 0
    const sent: string[] = []
    const started: PlannedSong[] = []
    const timers: (() => void)[] = []
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
      onSongStart: (song) => started.push(song),
      setTimeoutFn: (fn) => {
        timers.push(fn)
        return 0 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeoutFn: () => {
        timers.length = 0
      },
    })
    const advanceTo = (c: number) => {
      cycle = c
      for (const fn of timers.splice(0)) fn()
    }
    return { ctrl, sent, started, advanceTo }
  }

  it('starts the next song on the next bar, cutting the current one there', () => {
    const { ctrl, sent, started, advanceTo } = harness()
    ctrl.start(5)
    expect(started.map((s) => s.number)).toEqual([5])
    advanceTo(4.5)
    ctrl.nextSong()
    const [cut, next] = ctrl.songs()
    expect(next!.number).toBe(6)
    expect(next!.startCycle).toBe(5)
    expect(songBars(cut!)).toBe(4)
    expect(cut!.startCycle + songCycles(cut!, 122)).toBeCloseTo(5)
    expect(sent).toHaveLength(2)
    advanceTo(5.1)
    expect(ctrl.songs().map((s) => s.number)).toEqual([6])
    expect(started.map((s) => s.number)).toEqual([5, 6])
    expect(ctrl.nowPlaying()).toMatchObject({ song: { number: 6 }, position: { sectionIndex: 0 } })
  })

  it('uses the song already queued instead of composing another', () => {
    const { ctrl, advanceTo } = harness()
    ctrl.start()
    const first = ctrl.songs()[0]!
    advanceTo(1 + songBars(first) / 2 + 0.2)
    const queued = ctrl.songs()[1]!
    ctrl.nextSong()
    expect(ctrl.songs()[1]).toMatchObject({ number: queued.number, sections: queued.sections })
  })

  it('skips to the next section on the next bar and keeps the whole form in view', () => {
    const { ctrl, sent, advanceTo } = harness()
    ctrl.start()
    const first = ctrl.songs()[0]!
    advanceTo(1.5)
    ctrl.nextSection()
    const [cut, rest] = ctrl.songs()
    expect(songBars(cut!)).toBe(1)
    expect(rest!.startCycle).toBe(2)
    expect(rest!.firstSection).toBe(1)
    expect(rest!.sections).toEqual(first.form.slice(1))
    expect(sent.at(-1)).toContain('arrange(')
    // Pressed again before it lands: skips one more
    ctrl.nextSection()
    expect(ctrl.songs()[1]!.firstSection).toBe(2)
    advanceTo(2.1)
    expect(ctrl.songs()).toHaveLength(1)
    const now = ctrl.nowPlaying()!
    expect(now.position.sectionIndex).toBe(2)
    expect(now.song.form).toEqual(first.form)
  })

  it('moves to the next song from the last section', () => {
    const { ctrl, advanceTo } = harness()
    ctrl.start()
    const first = ctrl.songs()[0]!
    const lastStart = 1 + songBars(first) - first.form[first.form.length - 1]!.bars
    advanceTo(1 + songBars(first) / 2 + 0.1)
    advanceTo(lastStart + 0.5)
    ctrl.nextSection()
    expect(ctrl.songs()[1]!.number).toBe(2)
    expect(ctrl.songs()[1]!.startCycle).toBe(Math.floor(lastStart + 0.5) + 1)
  })

  it('compiles a song cut mid-section', () => {
    const { ctrl, advanceTo } = harness()
    ctrl.start()
    advanceTo(3.2)
    ctrl.nextSong()
    expect(() => compileTimeline(ctrl.songs() as PlannedSong[], 122)).not.toThrow()
  })
})

describe('Song history', () => {
  const record = (n: number, kept = false): SongRecord => ({
    number: n,
    startGeneration: n * 8,
    tempo: 122,
    root: 5,
    mode: 'dorian',
    form: [{ role: 'intro', bars: 8 }],
    formChanges: [],
    score: 0.9,
    kept,
    startedAt: n,
  })

  it('keeps the newest songs and never drops kept ones', () => {
    let h: SongRecord[] = [record(1, true)]
    for (let n = 2; n <= SONG_HISTORY_LIMIT + 10; n++) h = addToHistory(h, record(n))
    expect(h).toHaveLength(SONG_HISTORY_LIMIT)
    expect(h[0]!.number).toBe(SONG_HISTORY_LIMIT + 10)
    expect(h.some((r) => r.number === 1 && r.kept)).toBe(true)
  })

  it('records a played song without its genomes', () => {
    const ch = getChannel('trance')
    const personality = channelPersonality(ch)
    const state = createEvolutionState(channelSeed(ch), 2, { channelId: 'trance', personality })
    const composed = composeSong(state, { template: channelSongTemplate(ch), length: 'short', personality })
    const song: PlannedSong = {
      number: 1,
      startGeneration: composed.startGeneration,
      sections: composed.sections,
      form: composed.sections,
      firstSection: 0,
      formChanges: [],
      startCycle: 1,
    }
    const r = songRecord(song, 123)
    expect(r).toMatchObject({ number: 1, tempo: 138, kept: false, startedAt: 123 })
    expect(JSON.stringify(r)).not.toContain('notes')
  })

  it('saves per channel and clears with the channel', () => {
    const storage = new MemoryStorage()
    saveSongHistory(storage, 'house@v2', [record(1)])
    expect(loadSongHistory(storage, 'house@v2')).toEqual([record(1)])
    expect(loadSongHistory(storage, 'trance')).toEqual([])
    clearChannel(storage, 'house@v2')
    expect(loadSongHistory(storage, 'house@v2')).toEqual([])
  })
})
