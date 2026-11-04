/**
 * The Speech tab's neural Strudel voice: text → our front end → Kokoro (in the browser) → MP3 →
 * a Strudel program that carries the audio and plays it as a registered sound
 * (strudel/recorded.ts). The network loads once, on first use (about 120 MB).
 */
import { analyzeText } from '../linguistic'
import type { Lexicon } from '../lexicon'
import { compileStrudelRecording } from '../strudel/recorded'
import { Kokoro, KOKORO_RATE } from './kokoro'
import { encodeMp3, toBase64 } from './mp3'

let loading: Promise<Kokoro> | null = null

export function loadKokoro(base: string): Promise<Kokoro> {
  loading ??= (async () => {
    const ort = await import('onnxruntime-web')
    ort.env.wasm.numThreads = 1
    return Kokoro.load(base + 'kokoro/')
  })().catch((e) => {
    loading = null
    throw e
  })
  return loading
}

export async function neuralStrudelCode(text: string, lexicon: Lexicon, opts: { base: string; speed?: number; kbps?: number }): Promise<{ code: string; seconds: number }> {
  const k = await loadKokoro(opts.base)
  const audio = await k.speak(analyzeText(text, { lexicon }), opts.speed ?? 1)
  const mp3 = encodeMp3(audio, KOKORO_RATE, opts.kbps ?? 48)
  return compileStrudelRecording({ audio: toBase64(mp3), seconds: audio.length / KOKORO_RATE, text, source: 'Kokoro neural voice, bm_george' })
}
