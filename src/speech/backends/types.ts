/**
 * The contract every synthesis backend implements: a SpeechPlan and a voice in, mono samples out.
 * Linguistic processing and prosody never change when a backend is added.
 */
import type { SpeechPlan } from '../plan'
import type { SpeechVoice } from '../voice'

export interface RenderOptions {
  /** Output sample rate, Hz (default 22050) */
  sampleRate?: number
  /** Seed for noise sources and jitter; same seed ⇒ identical samples */
  seed?: number
}

export interface SpeechBackend {
  id: string
  name: string
  description: string
  render(plan: SpeechPlan, voice: SpeechVoice, opts?: RenderOptions): Float32Array
}
