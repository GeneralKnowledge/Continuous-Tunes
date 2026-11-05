/**
 * The Speech tab's neural Strudel voice: text → our front end → Kokoro (in the browser) → MP3 →
 * a Strudel program that carries the audio and plays it as a registered sound
 * (strudel/recorded.ts). The network loads once, on first use (about 120 MB).
 */
import { analyzeText } from '../linguistic'
import type { Lexicon } from '../lexicon'
import { compileStrudelWords, ONSET_LEVEL } from '../strudel/recorded'
import { Kokoro, KOKORO_HOP, KOKORO_RATE, type WordSpan } from './kokoro'
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
  const { audio, words } = await k.speakWords(analyzeText(text, { lexicon }), opts.speed ?? 1)
  return neuralWordsCode(audio, words, text, opts.kbps)
}

/** Strudel code for rendered Kokoro speech and its word spans (samples at KOKORO_RATE). */
export function neuralWordsCode(audio: Float32Array, words: WordSpan[], text?: string, kbps = 48): { code: string; seconds: number } {
  let first = 0
  while (first < audio.length && Math.abs(audio[first]!) < ONSET_LEVEL) first++
  return compileStrudelWords({
    audio: toBase64(encodeMp3(audio, KOKORO_RATE, kbps)),
    words: cutPoints(audio, words),
    frame: KOKORO_HOP / KOKORO_RATE,
    lead: first / KOKORO_RATE,
    text,
    source: 'Kokoro neural voice, bm_george',
  })
}

/**
 * Word spans in frames, each start moved to the quietest frame boundary near it. The network's
 * frame boundaries run about 50 ms late against its audio (a word's first sound starts before its
 * first frame), so a cut at the boundary itself clips onsets: Whisper heard "seat" as "steat".
 */
export function cutPoints(audio: Float32Array, words: WordSpan[]): { word: string; start: number; end: number }[] {
  const level = (f: number) => {
    let e = 0
    for (let i = f * KOKORO_HOP - 240; i < f * KOKORO_HOP + 240; i++) e += (audio[i] ?? 0) ** 2
    return e
  }
  let prev = -Infinity
  return words.map((w) => {
    const at = w.start / KOKORO_HOP
    let best = at
    for (let f = Math.max(at - 3, prev + 1, 0); f <= at + 1; f++) if (level(f) < level(best)) best = f
    prev = best
    return { word: w.word, start: best, end: w.end / KOKORO_HOP }
  })
}
