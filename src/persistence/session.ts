/**
 * Session / lineage persistence.
 * Uses localStorage now; designed so a SQLite adapter can replace StorageBackend later.
 */
import type { EvolutionState, EvolutionSnapshot } from '../evolution/engine'
import { snapshotOf, restoreSnapshot } from '../evolution/engine'
import type { MusicGenome } from '../music/genome'
import { CHANNELS } from '../music/channels'
import { SONG_LENGTHS, type SongLength } from '../music/form'

export interface StorageBackend {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  keys(): string[]
}

export class MemoryStorage implements StorageBackend {
  private data = new Map<string, string>()

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  keys(): string[] {
    return [...this.data.keys()]
  }
}

export class LocalStorageBackend implements StorageBackend {
  private prefix: string

  constructor(prefix = 'evo-strudel:') {
    this.prefix = prefix
  }

  private full(key: string): string {
    return this.prefix + key
  }

  getItem(key: string): string | null {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(this.full(key))
  }

  setItem(key: string, value: string): void {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(this.full(key), value)
    } catch {
      // Quota exceeded or storage disabled (e.g. private mode) — persistence is best-effort
    }
  }

  removeItem(key: string): void {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(this.full(key))
  }

  keys(): string[] {
    if (typeof localStorage === 'undefined') return []
    const out: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(this.prefix)) out.push(k.slice(this.prefix.length))
    }
    return out
  }
}

export interface AppSession {
  version: 1
  activeChannelId: string
  rngSeed: number
  songLength: SongLength
  evolutionRunning: boolean
}

const SESSION_KEY = 'session'
const channelKey = (id: string) => `channel:${id}`

export function saveSession(backend: StorageBackend, session: AppSession): void {
  backend.setItem(SESSION_KEY, JSON.stringify(session))
}

export function loadSession(backend: StorageBackend): AppSession | null {
  const raw = backend.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AppSession>
    if (
      !parsed ||
      parsed.version !== 1 ||
      !CHANNELS.some((c) => c.id === parsed.activeChannelId) ||
      typeof parsed.rngSeed !== 'number' ||
      !Number.isFinite(parsed.rngSeed) ||
      typeof parsed.evolutionRunning !== 'boolean'
    ) {
      return null
    }
    // Sessions saved before songs had "evolve every N bars" instead of a song length
    const songLength = (SONG_LENGTHS as readonly string[]).includes(parsed.songLength ?? '')
      ? parsed.songLength!
      : 'medium'
    return {
      version: 1,
      activeChannelId: parsed.activeChannelId!,
      rngSeed: parsed.rngSeed,
      songLength,
      evolutionRunning: parsed.evolutionRunning,
    }
  } catch {
    return null
  }
}

export function saveChannelState(backend: StorageBackend, channelId: string, state: EvolutionState): void {
  const snap = snapshotOf(state)
  backend.setItem(channelKey(channelId), JSON.stringify(snap))
}

export function loadChannelState(backend: StorageBackend, channelId: string): EvolutionState | null {
  const raw = backend.getItem(channelKey(channelId))
  if (!raw) return null
  try {
    return restoreSnapshot(JSON.parse(raw) as EvolutionSnapshot)
  } catch {
    return null
  }
}

export function clearChannel(backend: StorageBackend, channelId: string): void {
  backend.removeItem(channelKey(channelId))
}

export function clearAll(backend: StorageBackend): void {
  for (const k of backend.keys()) {
    backend.removeItem(k)
  }
}

/** Future SQLite tree adapter would implement StorageBackend + ancestry queries. */
export interface LineageNode {
  generationIndex: number
  genome: MusicGenome
  fitness: number
  parentIndex: number | null
  mutationName: string
}
