/**
 * Backend registry. Only working backends are listed; the diphone backend joins in M2.
 */
import { formantBackend } from './formant'
import type { SpeechBackend } from './types'

export const BACKENDS: readonly SpeechBackend[] = [formantBackend]

export function getBackend(id: string): SpeechBackend {
  const b = BACKENDS.find((x) => x.id === id)
  if (!b) throw new Error(`Unknown speech backend: ${id}`)
  return b
}

export type { SpeechBackend, RenderOptions } from './types'
