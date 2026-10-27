import { describe, expect, it } from 'vitest'
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

  it('rejects a saved channel whose genome is corrupt', () => {
    const backend = new MemoryStorage()
    const state = createEvolutionState(getSeed('electronic'), 42, { channelId: 'electronic' })
    saveChannelState(backend, 'electronic', state)
    const snap = JSON.parse(backend.getItem('channel:electronic')!)
    snap.state.genome.bass.octave = '1"); alert(1); ("'
    backend.setItem('channel:electronic', JSON.stringify(snap))
    expect(loadChannelState(backend, 'electronic')).toBeNull()
  })

  it('rejects a saved session pointing at an unknown channel', () => {
    const backend = new MemoryStorage()
    saveSession(backend, {
      version: 1,
      activeChannelId: 'no-such-channel',
      rngSeed: 1,
      songLength: 'medium',
      evolutionRunning: false,
    })
    expect(loadSession(backend)).toBeNull()
  })

  it('saves and restores session', () => {
    const backend = new MemoryStorage()
    saveSession(backend, {
      version: 1,
      activeChannelId: 'house',
      rngSeed: 99,
      songLength: 'medium',
      evolutionRunning: false,
    })
    const s = loadSession(backend)
    expect(s?.activeChannelId).toBe('house')
    expect(s?.rngSeed).toBe(99)
  })

  it('migrates a session saved before songs (evolve every N bars)', () => {
    const backend = new MemoryStorage()
    backend.setItem(
      'session',
      JSON.stringify({
        version: 1,
        activeChannelId: 'house',
        rngSeed: 3,
        evolveEveryBars: 8,
        evolutionRunning: true,
      }),
    )
    expect(loadSession(backend)).toEqual({
      version: 1,
      activeChannelId: 'house',
      rngSeed: 3,
      songLength: 'medium',
      evolutionRunning: true,
    })
  })

  it('clearAll wipes keys', () => {
    const backend = new MemoryStorage()
    saveSession(backend, {
      version: 1,
      activeChannelId: 'minimal',
      rngSeed: 1,
      songLength: 'short',
      evolutionRunning: false,
    })
    clearAll(backend)
    expect(loadSession(backend)).toBeNull()
  })
})
