/**
 * Continuous Speech: text → Utterance → SpeechPlan → samples.
 *
 *   linguistic.ts  normalisation, lexicon lookup, G2P fallback, syllables, stress
 *   prosody.ts     durations (Klatt's rules), pauses, intonation
 *   plan.ts        the shared acoustic representation every backend reads
 *   backends/      synthesis (formant now; diphone in M2)
 *   audio.ts       WAV, resampling, mixing
 *
 * Independent of the music system: nothing here imports from src/music or src/evolution.
 */
import { normalizePeak } from './audio'
import { getBackend } from './backends'
import { analyzeText, type Utterance } from './linguistic'
import { EMPTY_LEXICON, type Lexicon } from './lexicon'
import type { SpeechPlan } from './plan'
import { planProsody } from './prosody'
import { validateVoice, type SpeechVoice } from './voice'

export interface SpeakOptions {
  lexicon?: Lexicon
  sampleRate?: number
  seed?: number
  /** Override the voice's backend */
  backend?: string
}

export interface SpeechResult {
  utterance: Utterance
  plan: SpeechPlan
  samples: Float32Array
  sampleRate: number
  voice: SpeechVoice
  /** voice fields that were clamped or adjusted */
  voiceIssues: string[]
  backend: string
}

export function speak(text: string, voiceIn: SpeechVoice, opts: SpeakOptions = {}): SpeechResult {
  const { voice, issues } = validateVoice(voiceIn)
  const sampleRate = opts.sampleRate ?? 22050
  const backendId = opts.backend ?? voice.backend
  const utterance = analyzeText(text, { lexicon: opts.lexicon ?? EMPTY_LEXICON, connectedSpeech: voice.frontend !== 'm1' })
  const plan = planProsody(utterance, voice)
  const raw = getBackend(backendId).render(plan, voice, { sampleRate, seed: opts.seed ?? 1 })
  return {
    utterance,
    plan,
    samples: normalizePeak(raw),
    sampleRate,
    voice,
    voiceIssues: issues,
    backend: backendId,
  }
}

export { analyzeText } from './linguistic'
export { planProsody } from './prosody'
export { encodeWav } from './audio'
export { BACKENDS } from './backends'
export { VOICE_PRESETS, DEFAULT_VOICE, M1_VOICE, getVoicePreset, validateVoice, withControls } from './voice'
export type { SpeechVoice } from './voice'
export type { SpeechPlan } from './plan'
export type { Utterance } from './linguistic'
