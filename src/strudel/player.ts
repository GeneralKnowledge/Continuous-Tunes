/**
 * Browser Strudel player.
 * Verified against @strudel/web@1.3.0: initStrudel, evaluate, hush, samples.
 */
import { initStrudel, evaluate, hush, samples } from '@strudel/web'
import { compileGenome } from './compiler'
import type { MusicGenome } from '../music/genome'

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'error'

export interface StrudelPlayer {
  status: () => PlayerStatus
  error: () => string | null
  init: () => Promise<void>
  playGenome: (genome: MusicGenome) => Promise<string>
  playCode: (code: string) => Promise<void>
  stop: () => void
  isPlaying: () => boolean
}

export function createStrudelPlayer(): StrudelPlayer {
  let status: PlayerStatus = 'idle'
  let error: string | null = null
  let playing = false
  let initPromise: Promise<void> | null = null

  async function init(): Promise<void> {
    if (status === 'ready' || status === 'playing') return
    if (initPromise) return initPromise

    status = 'loading'
    initPromise = (async () => {
      try {
        // initStrudel returns a Promise in 1.3.0 (initDone)
        await initStrudel({
          prebake: async () => {
            await samples('github:tidalcycles/dirt-samples')
          },
        })
        status = 'ready'
        error = null
      } catch (e) {
        status = 'error'
        error = e instanceof Error ? e.message : String(e)
        initPromise = null
        throw e
      }
    })()

    return initPromise
  }

  async function playCode(code: string): Promise<void> {
    await init()
    await evaluate(code)
    playing = true
    status = 'playing'
  }

  async function playGenome(genome: MusicGenome): Promise<string> {
    const code = compileGenome(genome)
    await playCode(code)
    return code
  }

  function stop(): void {
    try {
      hush()
    } catch {
      // hush before init is harmless to ignore
    }
    playing = false
    if (status === 'playing') status = 'ready'
  }

  return {
    status: () => status,
    error: () => error,
    init,
    playGenome,
    playCode,
    stop,
    isPlaying: () => playing,
  }
}
