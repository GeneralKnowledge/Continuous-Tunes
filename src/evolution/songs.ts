/**
 * Song controller: keeps the current song and the next one on the Strudel timeline.
 * Section and song changes happen on the audio clock (compiled into one arrange()),
 * so JS timers only need to fire some time in the second half of a song to queue the next one.
 */
import type { EvolutionConfig, EvolutionState } from './engine'
import { composeNextSong, composeSong, evaluateSong, positionInSong, type SongPosition } from './song'
import type { SongLength, SongTemplate } from '../music/form'
import type { SoundKit } from '../music/kits'
import type { Personality } from '../music/personality'
import {
  compileTimeline,
  songBars,
  songCycles,
  tempoRatio,
  type LayerMutes,
  type ScheduledSong,
  type SongSection,
} from '../strudel/compiler'

export interface PlannedSong extends ScheduledSong {
  /** 1-based count of songs since playback started. */
  number: number
  startGeneration: number
  /** Every section of the song; `sections` is what is still scheduled after a skip. */
  form: SongSection[]
  /** Index in `form` of the first scheduled section (more than 0 after Next section). */
  firstSection: number
  /** How the form differs from the genre's template plan. */
  formChanges: string[]
}

/** A played song, as the song history keeps it (no genomes, so it stays small). */
export interface SongRecord {
  number: number
  startGeneration: number
  tempo: number
  root: number
  mode: string
  /** Section roles and lengths, in order. */
  form: { role: string; bars: number; material?: 'A' | 'B' }[]
  formChanges: string[]
  /** Song-level score (0–1). */
  score: number
  kept: boolean
  startedAt: number
}

export const SONG_HISTORY_LIMIT = 30

export function songRecord(song: PlannedSong, startedAt: number): SongRecord {
  const theme = song.form[0]!.genome
  return {
    number: song.number,
    startGeneration: song.startGeneration,
    tempo: theme.tempo,
    root: theme.scale.root,
    mode: theme.scale.mode,
    form: song.form.map(({ role, bars, material }) => ({ role, bars, ...(material ? { material } : {}) })),
    formChanges: song.formChanges,
    score: evaluateSong(song.form).score,
    kept: false,
    startedAt,
  }
}

/** Newest first, at most SONG_HISTORY_LIMIT songs; kept songs are never dropped for newer ones. */
export function addToHistory(history: readonly SongRecord[], record: SongRecord): SongRecord[] {
  const out = [record, ...history]
  while (out.length > SONG_HISTORY_LIMIT) {
    const i = out.map((r) => r.kept).lastIndexOf(false)
    if (i <= 0) break
    out.splice(i, 1)
  }
  return out
}

export interface SongControllerOptions {
  getState: () => EvolutionState
  setState: (state: EvolutionState) => void
  /** Current playback position in cycles (Strudel scheduler). */
  now: () => number
  play: (code: string) => Promise<unknown>
  template: () => SongTemplate
  length: () => SongLength
  personality: () => Personality | undefined
  config: () => Partial<EvolutionConfig> | undefined
  mutes: () => LayerMutes
  /** The channel's sounds; the default kit when left out. */
  kit?: () => SoundKit
  /** Called after a song is composed (its sections are new generations). */
  onComposed?: (song: PlannedSong, state: EvolutionState) => void
  /** Called when a song starts playing. */
  onSongStart?: (song: PlannedSong, startedAt: number) => void
  onError?: (e: unknown) => void
  clock?: () => number
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void
}

export interface NowPlaying {
  song: PlannedSong
  position: SongPosition
}

export interface SongController {
  /** Start playing songs; the first is numbered `firstNumber` (1 by default). */
  start: (firstNumber?: number) => void
  stop: () => void
  isRunning: () => boolean
  /** Re-send the timeline (e.g. after mutes change). */
  refresh: () => void
  nowPlaying: () => NowPlaying | null
  songs: () => readonly PlannedSong[]
  /** Skip to the next song at the next bar. */
  nextSong: () => void
  /** Skip to the next section at the next bar (the next song from the last section). */
  nextSection: () => void
  dispose: () => void
}

export function createSongController(options: SongControllerOptions): SongController {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const clock = options.clock ?? (() => Date.now())

  let running = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let songs: PlannedSong[] = []
  let baseTempo = 120
  let count = 0

  const cps = () => baseTempo / 60 / 4

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeoutFn(timer)
      timer = null
    }
  }

  function send(): void {
    const code = compileTimeline(songs, baseTempo, options.mutes(), options.kit?.())
    options.play(code).catch((e: unknown) => options.onError?.(e))
  }

  /** Run `fn` once playback reaches `cycle`, re-checking because timers drift or get throttled. */
  function at(cycle: number, fn: () => void): void {
    clearTimer()
    const wait = (): void => {
      if (!running) return
      const remaining = cycle - options.now()
      if (remaining <= 0.001) {
        timer = null
        fn()
        return
      }
      timer = setTimeoutFn(wait, Math.max(50, (remaining / cps()) * 1000))
    }
    wait()
  }

  function compose(after: PlannedSong | null, startCycle?: number): PlannedSong {
    const composeOptions = {
      template: options.template(),
      length: options.length(),
      personality: options.personality(),
      config: options.config(),
      now: clock(),
    }
    const state = options.getState()
    const composed = after ? composeNextSong(state, composeOptions) : composeSong(state, composeOptions)
    count++
    const song: PlannedSong = {
      number: count,
      startGeneration: composed.startGeneration,
      sections: composed.sections,
      form: composed.sections,
      firstSection: 0,
      formChanges: composed.formChanges,
      startCycle: startCycle ?? (after ? endOf(after) : Math.floor(options.now()) + 1),
    }
    options.setState(composed.state)
    options.onComposed?.(song, composed.state)
    return song
  }

  function endOf(song: PlannedSong): number {
    return song.startCycle + songCycles(song, baseTempo)
  }

  /** When `next` starts, drop the songs before it and plan the one after. */
  function startAt(next: PlannedSong): void {
    at(next.startCycle, () => {
      songs = [next]
      options.onSongStart?.(next, clock())
      scheduleNext(next)
    })
  }

  /** Halfway through the current song, queue the next; when it starts, drop the old one. */
  function scheduleNext(current: PlannedSong): void {
    at(current.startCycle + songCycles(current, baseTempo) / 2, () => {
      const next = compose(current)
      songs = [current, next]
      send()
      startAt(next)
    })
  }

  /** The song playing now, or the first scheduled one. */
  function current(): PlannedSong | null {
    const now = options.now()
    return songs.find((s) => now >= s.startCycle && now < endOf(s)) ?? songs[0] ?? null
  }

  /** The next song after `song` on the timeline, if one is queued. */
  function queuedAfter(song: PlannedSong): PlannedSong | undefined {
    return songs.find((s) => s.number !== song.number && s.startCycle > song.startCycle)
  }

  /**
   * `song` cut off at its next bar line (the song's own bars, which differ from cycles when its
   * tempo has moved), and the cycle that bar starts on. Its last bar plays the lead-in fill.
   */
  function cutAtNextBar(song: PlannedSong): { cut: PlannedSong; at: number } {
    const ratio = tempoRatio(song, baseTempo)
    const bar = Math.max(1, Math.floor((options.now() - song.startCycle) * ratio + 0.001) + 1)
    const sections: SongSection[] = []
    let left = bar
    for (const sec of song.sections) {
      if (left <= 0) break
      sections.push(sec.bars <= left ? sec : { ...sec, bars: left })
      left -= sec.bars
    }
    return { cut: { ...song, sections }, at: song.startCycle + Math.min(bar, songBars(song)) / ratio }
  }

  function skipToNextSong(): void {
    const playing = current()
    if (!playing) return
    const { cut, at: start } = cutAtNextBar(playing)
    // A song already queued after this one starts early; otherwise compose it now
    const queued = queuedAfter(playing)
    const next = queued ? { ...queued, startCycle: start } : compose(playing, start)
    songs = [cut, next]
    send()
    startAt(next)
  }

  function skipToNextSection(): void {
    const playing = current()
    if (!playing) return
    const now = options.now()
    // Pressed again before the skip lands: skip one more section of the pending rest
    const pending = songs.find((s) => s.number === playing.number && s.startCycle > now)
    let cut: PlannedSong
    let rest: PlannedSong
    if (pending) {
      if (pending.sections.length <= 1) return skipToNextSong()
      cut = playing
      rest = { ...pending, sections: pending.sections.slice(1), firstSection: pending.firstSection + 1 }
    } else {
      const position = positionInSong(playing, (now - playing.startCycle) * tempoRatio(playing, baseTempo))
      const from = (position?.sectionIndex ?? 0) + 1
      if (!position || from >= playing.sections.length) return skipToNextSong()
      const next = cutAtNextBar(playing)
      cut = next.cut
      rest = {
        ...playing,
        sections: playing.sections.slice(from),
        firstSection: playing.firstSection + from,
        startCycle: next.at,
      }
    }
    const queued = queuedAfter(playing)
    const after = queued ? { ...queued, startCycle: endOf(rest) } : null
    songs = after ? [cut, rest, after] : [cut, rest]
    send()
    at(rest.startCycle, () => {
      if (after) {
        songs = [rest, after]
        startAt(after)
      } else {
        songs = [rest]
        scheduleNext(rest)
      }
    })
  }

  return {
    start(firstNumber = 1) {
      if (running) return
      running = true
      count = firstNumber - 1
      baseTempo = options.getState().genome.tempo
      songs = []
      const first = compose(null)
      songs = [first]
      send()
      options.onSongStart?.(first, clock())
      scheduleNext(first)
    },
    stop() {
      running = false
      clearTimer()
      songs = []
    },
    isRunning: () => running,
    refresh() {
      if (running && songs.length > 0) send()
    },
    nowPlaying() {
      const now = options.now()
      for (const song of songs) {
        if (now < song.startCycle || now >= endOf(song)) continue
        const position = positionInSong(song, (now - song.startCycle) * tempoRatio(song, baseTempo))
        // Positions count from the start of the whole form, also after a skipped section
        if (position) return { song, position: { ...position, sectionIndex: position.sectionIndex + song.firstSection } }
      }
      return null
    },
    songs: () => songs,
    nextSong() {
      if (running) skipToNextSong()
    },
    nextSection() {
      if (running) skipToNextSection()
    },
    dispose() {
      running = false
      clearTimer()
    },
  }
}
