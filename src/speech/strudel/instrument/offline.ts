/**
 * Run the voice instrument's worklet processor outside a browser, block by block, exactly as the
 * AudioWorklet would. For tests and fast parameter searches; the browser render
 * (scripts/speech/strudel-render.mjs) remains the reference for anything reported.
 */
import { voiceProcessorModule } from './processor'

type Ctor = new (init: { processorOptions: Record<string, unknown> }) => {
  process(i: Float32Array[][], o: Float32Array[][]): boolean
  port: { postMessage(m: unknown): void }
}

export function renderOffline(options: Record<string, unknown>, sampleRate = 48000, maxSeconds = 60): Float32Array {
  const g = globalThis as unknown as Record<string, unknown>
  const saved = { sampleRate: g.sampleRate, currentFrame: g.currentFrame, AudioWorkletProcessor: g.AudioWorkletProcessor, registerProcessor: g.registerProcessor }
  let Proc: Ctor | null = null
  g.sampleRate = sampleRate
  g.currentFrame = 0
  g.AudioWorkletProcessor = class {
    port = { postMessage: () => {} }
  }
  g.registerProcessor = (_n: string, c: Ctor) => {
    Proc = c
  }
  try {
    voiceProcessorModule('offline')
    const p = new Proc!({ processorOptions: { start: 0, ...options } })
    const chunks: Float32Array[] = []
    for (let n = 0; n < maxSeconds * sampleRate; n += 128) {
      g.currentFrame = n
      const buf = new Float32Array(128)
      const alive = p.process([], [[buf]])
      chunks.push(buf)
      if (!alive) break
    }
    const out = new Float32Array(chunks.length * 128)
    chunks.forEach((c, i) => out.set(c, i * 128))
    return out
  } finally {
    Object.assign(g, saved)
  }
}
