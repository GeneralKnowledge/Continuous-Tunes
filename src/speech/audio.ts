/**
 * Audio utilities shared by every backend: WAV encoding, resampling, mixing, normalisation.
 */

/** 16-bit PCM mono WAV (RIFF), as bytes. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buf)
}

/** Parse a 16-bit PCM mono/stereo WAV back into samples (first channel). For tests and tools. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file')
  let pos = 12
  let sampleRate = 0
  let channels = 1
  let bits = 16
  while (pos + 8 <= bytes.length) {
    const id = tag(pos)
    const size = view.getUint32(pos + 4, true)
    if (id === 'fmt ') {
      channels = view.getUint16(pos + 10, true)
      sampleRate = view.getUint32(pos + 12, true)
      bits = view.getUint16(pos + 22, true)
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`Unsupported WAV bit depth ${bits}`)
      const frames = size / (2 * channels)
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) samples[i] = view.getInt16(pos + 8 + i * 2 * channels, true) / 0x8000
      return { samples, sampleRate }
    }
    pos += 8 + size + (size % 2)
  }
  throw new Error('WAV has no data chunk')
}

/** Band-limited resampling with a Hann-windowed sinc (16 zero crossings). */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples.slice()
  const ratio = to / from
  const out = new Float32Array(Math.round(samples.length * ratio))
  const cutoff = Math.min(1, ratio) // low-pass at the lower Nyquist
  const half = 16 / cutoff
  for (let i = 0; i < out.length; i++) {
    const center = i / ratio
    const lo = Math.ceil(center - half)
    const hi = Math.floor(center + half)
    let acc = 0
    let norm = 0
    for (let j = lo; j <= hi; j++) {
      if (j < 0 || j >= samples.length) continue
      const x = (j - center) * cutoff
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const w = 0.5 + 0.5 * Math.cos((Math.PI * (j - center)) / half)
      const k = sinc * w
      acc += samples[j]! * k
      norm += k
    }
    out[i] = norm ? acc / norm : 0
  }
  return out
}

/** Scale so the peak sits at `peak` (default −1 dBFS). Silence is returned unchanged. */
export function normalizePeak(samples: Float32Array, peak = 0.89): Float32Array {
  let max = 0
  for (const s of samples) max = Math.max(max, Math.abs(s))
  if (max < 1e-9) return samples
  const g = peak / max
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! * g
  return out
}

/** Mix `b` into `a` starting at `offset` samples, with gain. Returns a new buffer long enough for both. */
export function mixInto(a: Float32Array, b: Float32Array, offset = 0, gain = 1): Float32Array {
  const out = new Float32Array(Math.max(a.length, offset + b.length))
  out.set(a)
  for (let i = 0; i < b.length; i++) out[offset + i]! += b[i]! * gain
  return out
}

export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let acc = 0
  for (let i = from; i < to; i++) acc += samples[i]! * samples[i]!
  return Math.sqrt(acc / Math.max(1, to - from))
}
