/**
 * Song controller: keeps the current song and the next one on the Strudel timeline.
 * Section and song changes happen on the audio clock (compiled into one arrange()),
 * so JS timers only need to fire some time in the second half of a song to queue the next one.
 */
import type { EvolutionConfig, EvolutionState } from './engine'
import { composeNextSong, composeSong, positionInSong, type SongPosition } from './song'
import type { SongLength, SongTemplate } from '../music/form'
import type { Personality } from '../music/personality'
import {
  compileTimeline,
  songCycles,
  tempoRatio,
  type LayerMutes,
  type ScheduledSong,
} from '../strudel/compiler'

export interface PlannedSong extends ScheduledSong {
  /** 1-based count of songs since playback started. */
  number: number
  startGeneration: number
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
  /** Called after a song is composed (its sections are new generations). */
  onComposed?: (song: PlannedSong, state: EvolutionState) => void
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
  start: () => void
  stop: () => void
  isRunning: () => boolean
  /** Re-send the timeline (e.g. after mutes change). */
  refresh: () => void
  nowPlaying: () => NowPlaying | null
  songs: () => readonly PlannedSong[]
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
    const code = compileTimeline(songs, baseTempo, options.mutes())
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

  function compose(after: PlannedSong | null): PlannedSong {
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
      startCycle: after
        ? after.startCycle + songCycles(after, baseTempo)
        : Math.floor(options.now()) + 1,
    }
    options.setState(composed.state)
    options.onComposed?.(song, composed.state)
    return song
  }

  function endOf(song: PlannedSong): number {
    return song.startCycle + songCycles(song, baseTempo)
  }

  /** Halfway through the current song, queue the next; when it starts, drop the old one. */
  function scheduleNext(current: PlannedSong): void {
    at(current.startCycle + songCycles(current, baseTempo) / 2, () => {
      const next = compose(current)
      songs = [current, next]
      send()
      at(next.startCycle, () => {
        songs = [next]
        scheduleNext(next)
      })
    })
  }

  return {
    start() {
      if (running) return
      running = true
      count = 0
      baseTempo = options.getState().genome.tempo
      songs = []
      const first = compose(null)
      songs = [first]
      send()
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
        if (position) return { song, position }
      }
      return null
    },
    songs: () => songs,
    dispose() {
      running = false
      clearTimer()
    },
  }
}
