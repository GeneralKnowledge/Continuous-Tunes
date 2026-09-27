/**
 * Continuous evolution controller.
 * Deadline-based polling (not fragile per-bar setInterval alone).
 * Screen Wake Lock while playing; re-schedule on visibilitychange.
 */
import type { EvolutionState } from '../evolution/engine'
import { stepGeneration } from '../evolution/engine'
import type { Personality } from '../music/personality'
import type { MusicGenome } from '../music/genome'
import type { EvolutionConfig } from '../evolution/engine'

export interface ContinuousControllerOptions {
  /** Bars between evolution steps. */
  evolveEveryBars: number
  getTempo: () => number
  getState: () => EvolutionState
  setState: (state: EvolutionState) => void
  onEvolved: (state: EvolutionState, codeNeedsRefresh: boolean) => void
  personality?: () => Personality | undefined
  config?: () => Partial<EvolutionConfig> | undefined
  /** Injected clock for tests. */
  now?: () => number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

export interface ContinuousController {
  start: () => void
  stop: () => void
  isRunning: () => boolean
  getBarsRemaining: () => number
  getWakeLockActive: () => boolean
  /** Call when tempo / evolve interval changes while running. */
  reschedule: () => void
  /** Manual mutate-once (does not require continuous mode). */
  mutateOnce: () => EvolutionState
  dispose: () => void
}

function barsToMs(bars: number, tempoBpm: number): number {
  // 1 bar = 4 beats at given BPM
  const msPerBar = (60_000 / tempoBpm) * 4
  return bars * msPerBar
}

export function createContinuousController(
  options: ContinuousControllerOptions,
): ContinuousController {
  const now = options.now ?? (() => Date.now())
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout

  let running = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let deadline = 0
  let wakeLock: WakeLockSentinel | null = null
  let barsRemaining = 0
  let disposed = false

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeoutFn(timer)
      timer = null
    }
  }

  async function requestWakeLock(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen')
        wakeLock.addEventListener('release', () => {
          wakeLock = null
        })
      }
    } catch {
      // Wake Lock may be denied — non-fatal
      wakeLock = null
    }
  }

  async function releaseWakeLock(): Promise<void> {
    try {
      await wakeLock?.release()
    } catch {
      // ignore
    }
    wakeLock = null
  }

  function schedule(): void {
    clearTimer()
    if (!running || disposed) return

    const tempo = Math.max(40, options.getTempo())
    const every = Math.max(1, options.evolveEveryBars)
    const ms = barsToMs(every, tempo)
    deadline = now() + ms
    barsRemaining = every

    const tick = (): void => {
      if (!running || disposed) return
      const remaining = deadline - now()
      if (remaining <= 0) {
        evolveStep()
        schedule()
        return
      }
      // Update bars-remaining estimate
      const tempoNow = Math.max(40, options.getTempo())
      const msPerBar = (60_000 / tempoNow) * 4
      barsRemaining = Math.max(0, Math.ceil(remaining / msPerBar))
      // Poll at a coarse interval; deadline is the source of truth
      timer = setTimeoutFn(tick, Math.min(remaining, 250))
    }

    timer = setTimeoutFn(tick, Math.min(ms, 250))
  }

  function evolveStep(): void {
    const state = options.getState()
    const result = stepGeneration(state, {
      personality: options.personality?.(),
      config: options.config?.(),
      now: now(),
    })
    options.setState(result.state)
    options.onEvolved(result.state, result.accepted)
  }

  function onVisibility(): void {
    if (!running) return
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void requestWakeLock()
      // Re-schedule from remaining deadline so we don't drift badly
      clearTimer()
      const remaining = Math.max(0, deadline - now())
      if (remaining <= 0) {
        evolveStep()
        schedule()
      } else {
        timer = setTimeoutFn(() => {
          evolveStep()
          schedule()
        }, remaining)
      }
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }

  return {
    start() {
      if (running) return
      running = true
      void requestWakeLock()
      schedule()
    },
    stop() {
      running = false
      clearTimer()
      void releaseWakeLock()
      barsRemaining = 0
    },
    isRunning: () => running,
    getBarsRemaining: () => barsRemaining,
    getWakeLockActive: () => wakeLock !== null,
    reschedule() {
      if (running) schedule()
    },
    mutateOnce() {
      const state = options.getState()
      const result = stepGeneration(state, {
        personality: options.personality?.(),
        config: options.config?.(),
        now: now(),
      })
      options.setState(result.state)
      options.onEvolved(result.state, result.accepted)
      return result.state
    },
    dispose() {
      disposed = true
      running = false
      clearTimer()
      void releaseWakeLock()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    },
  }
}

/** Compile helper type re-export for UI. */
export type { MusicGenome }
