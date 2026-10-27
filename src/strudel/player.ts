/**
 * Browser Strudel player.
 * Verified against @strudel/web@1.3.0: initStrudel, evaluate, hush, samples.
 * @strudel/web is loaded lazily on first play so it stays out of the initial bundle.
 */
import { compileGenome, type LayerMutes } from './compiler'
import type { MusicGenome } from '../music/genome'

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'error'

export interface PlayResult {
  code: string
  recovered: boolean
}

export interface StrudelPlayer {
  status: () => PlayerStatus
  error: () => string | null
  lastGoodCode: () => string | null
  init: () => Promise<void>
  playGenome: (genome: MusicGenome, mutes?: LayerMutes) => Promise<PlayResult>
  playCode: (code: string) => Promise<PlayResult>
  stop: () => void
  isPlaying: () => boolean
  /** Playback position in cycles (bars at the playing tempo); 0 before init. */
  now: () => number
}

type StrudelModule = typeof import('@strudel/web')

export function createStrudelPlayer(): StrudelPlayer {
  let strudel: StrudelModule | null = null
  let repl: { scheduler: { now(): number } } | null = null
  let status: PlayerStatus = 'idle'
  let error: string | null = null
  let playing = false
  let initPromise: Promise<void> | null = null
  let lastGood: string | null = null

  async function init(): Promise<void> {
    if (status === 'ready' || status === 'playing') return
    if (initPromise) return initPromise

    status = 'loading'
    initPromise = (async () => {
      try {
        const mod = await import('@strudel/web')
        repl = await mod.initStrudel({
          prebake: async () => {
            await mod.samples('github:tidalcycles/dirt-samples')
          },
        })
        strudel = mod
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

  async function playCode(code: string): Promise<PlayResult> {
    await init()
    const { evaluate, hush } = strudel!
    try {
      await evaluate(code)
      lastGood = code
      playing = true
      status = 'playing'
      error = null
      return { code, recovered: false }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      try {
        hush()
      } catch {
        // ignore
      }
      if (lastGood) {
        try {
          await evaluate(lastGood)
          playing = true
          status = 'playing'
          return { code: lastGood, recovered: true }
        } catch {
          playing = false
          status = 'error'
        }
      } else {
        playing = false
        status = 'error'
      }
      throw e
    }
  }

  async function playGenome(genome: MusicGenome, mutes?: LayerMutes): Promise<PlayResult> {
    const code = compileGenome(genome, mutes)
    return playCode(code)
  }

  function stop(): void {
    try {
      strudel?.hush()
    } catch {
      // hush before init is harmless to ignore
    }
    playing = false
    if (status === 'playing') status = 'ready'
  }

  return {
    status: () => status,
    error: () => error,
    lastGoodCode: () => lastGood,
    init,
    playGenome,
    playCode,
    stop,
    isPlaying: () => playing,
    now: () => {
      try {
        return repl?.scheduler.now() ?? 0
      } catch {
        return 0
      }
    },
  }
}
