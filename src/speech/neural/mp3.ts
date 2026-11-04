/**
 * MP3 encoding for speech carried inside Strudel code (lamejs, LGPL-3.0): mono, any rate lame
 * supports (24 kHz for Kokoro). MP3 because every browser's decodeAudioData reads it.
 */
import { Mp3Encoder } from '@breezystack/lamejs'

export function encodeMp3(samples: Float32Array, sampleRate: number, kbps = 48): Uint8Array {
  const enc = new Mp3Encoder(1, sampleRate, kbps)
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767)))
  const chunks: Uint8Array[] = []
  for (let i = 0; i < pcm.length; i += 1152 * 8) chunks.push(new Uint8Array(enc.encodeBuffer(pcm.subarray(i, i + 1152 * 8))))
  chunks.push(new Uint8Array(enc.flush()))
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
