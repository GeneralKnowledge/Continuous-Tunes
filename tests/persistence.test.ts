import { describe, expect, it, vi } from 'vitest'
import { createContinuousController } from '../src/evolution/continuous'
import { createEvolutionState, stepGeneration } from '../src/evolution/engine'
import { getSeed } from '../src/music/seeds'
import {
  MemoryStorage,
  saveChannelState,
  loadChannelState,
  saveSession,
  loadSession,
  clearAll,
} from '../src/persistence/session'

describe('Persistence', () => {
  it('saves and restores channel lineage', () => {
    const backend = new MemoryStorage()
    let state = createEvolutionState(getSeed('electronic'), 42, { channelId: 'electronic' })
    state = stepGeneration(state).state
    saveChannelState(backend, 'electronic', state)

    const loaded = loadChannelState(backend, 'electronic')
    expect(loaded).not.toBeNull()
    expect(loaded!.generationIndex).toBe(state.generationIndex)
    expect(loaded!.rngState).toBe(state.rngState)
  })

  it('saves and restores session', () => {
    const backend = new MemoryStorage()
    saveSession(backend, {
      version: 1,
      activeChannelId: 'house',
      rngSeed: 99,
      evolveEveryBars: 8,
      evolutionRunning: false,
    })
    const s = loadSession(backend)
    expect(s?.activeChannelId).toBe('house')
    expect(s?.rngSeed).toBe(99)
  })

  it('clearAll wipes keys', () => {
    const backend = new MemoryStorage()
    saveSession(backend, {
      version: 1,
      activeChannelId: 'minimal',
      rngSeed: 1,
      evolveEveryBars: 4,
      evolutionRunning: false,
    })
    clearAll(backend)
    expect(loadSession(backend)).toBeNull()
  })
})

describe('Continuous controller', () => {
  it('evolves on deadline with fake timers', () => {
    vi.useFakeTimers()
    let clock = 0
    let state = createEvolutionState(getSeed('minimal'), 5)
    let evolutions = 0

    const ctrl = createContinuousController({
      evolveEveryBars: 4,
      getTempo: () => 120, // 4 bars = 8 seconds at 120bpm
      getState: () => state,
      setState: (s) => {
        state = s
      },
      onEvolved: () => {
        evolutions++
      },
      now: () => clock,
      setTimeoutFn: (fn, ms) =>
        setTimeout(() => {
          clock += typeof ms === 'number' ? ms : 0
          if (typeof fn === 'function') fn()
        }, ms) as unknown as ReturnType<typeof setTimeout>,
      clearTimeoutFn: clearTimeout,
    })

    ctrl.start()
    expect(ctrl.isRunning()).toBe(true)

    // Advance enough fake time for at least one evolution
    // At 120bpm, 4 bars = 8000ms; our timer polls every 250ms
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(250)
    }

    expect(evolutions).toBeGreaterThanOrEqual(1)
    ctrl.stop()
    ctrl.dispose()
    vi.useRealTimers()
  })
})
