/**
 * Speech panel settings, persisted under their own storage prefix so speech never touches the
 * music lineage keys (see src/persistence/session.ts for the StorageBackend interface).
 */
import type { StorageBackend } from '../persistence/session'
import { BACKENDS } from './backends'
import { VOICE_PRESETS } from './voice'

export const SPEECH_STORAGE_PREFIX = 'continuous-speech:'

export interface SpeechSettings {
  version: 1
  text: string
  voiceId: string
  backendId: string
  /** multipliers on the voice's own rate and pitch */
  rate: number
  pitch: number
}

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  version: 1,
  text: 'Hello. This is Continuous, speaking British English. Can you understand me?',
  voiceId: 'alder',
  backendId: 'formant',
  rate: 1,
  pitch: 1,
}

export const RATE_RANGE = [0.5, 2] as const
export const PITCH_RANGE = [0.6, 1.6] as const

const clamp = (x: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback

export function sanitizeSpeechSettings(raw: unknown): SpeechSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SpeechSettings>
  const d = DEFAULT_SPEECH_SETTINGS
  return {
    version: 1,
    text: typeof r.text === 'string' ? r.text.slice(0, 5000) : d.text,
    voiceId: VOICE_PRESETS.some((v) => v.id === r.voiceId) ? r.voiceId! : d.voiceId,
    backendId: BACKENDS.some((b) => b.id === r.backendId) ? r.backendId! : d.backendId,
    rate: clamp(r.rate, RATE_RANGE, d.rate),
    pitch: clamp(r.pitch, PITCH_RANGE, d.pitch),
  }
}

export function loadSpeechSettings(storage: StorageBackend): SpeechSettings {
  try {
    return sanitizeSpeechSettings(JSON.parse(storage.getItem('settings') ?? 'null'))
  } catch {
    return DEFAULT_SPEECH_SETTINGS
  }
}

export function saveSpeechSettings(storage: StorageBackend, settings: SpeechSettings): void {
  storage.setItem('settings', JSON.stringify(settings))
}
