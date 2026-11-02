/**
 * Audio analysis of a rendered song: plain TypeScript DSP on mono PCM, no dependencies, so it
 * runs in Node or the browser. See docs/research/audio-analysis.md for why this exists instead
 * of Essentia.js (AGPL-3.0) and how it was cross-checked against Essentia.
 *
 * Measures: tempo (onset autocorrelation) and its stability, onsets and their density, pulse
 * clarity, timing of onsets against the song's own 16th grid, BS.1770-style loudness (integrated,
 * short-term, loudness range), crest factor, spectral centroid / rolloff / flatness, band energy
 * shares, chroma and key, and per-section / per-bar features for similarity and repetition.
 *
 * Numbers describe the audio; none of them is a quality score.
 */

export interface AudioSection {
  role: string
  bars: number
  material?: string
}

export interface FrameFeatures {
  rms: number
  centroid: number
  rolloff: number
  flatness: number
  flux: number
  bands: number[]
  chroma: number[]
}

export const BAND_EDGES = [20, 60, 250, 2000, 6000, 11000] as const
export const BAND_NAMES = ['sub', 'bass', 'lowMid', 'highMid', 'high'] as const

const r3 = (v: number) => Number(v.toFixed(3))
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const std = (xs: readonly number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const percentile = (xs: readonly number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]!
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b]! * cr - im[b]! * ci
        const ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

export interface FrameOptions {
  size?: number
  hop?: number
}

/** Short-time features, one row per hop. */
export function frameFeatures(x: Float32Array, sr: number, opts: FrameOptions = {}): { hop: number; frames: FrameFeatures[] } {
  const size = opts.size ?? 2048
  const hop = opts.hop ?? 512
  const win = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size))
  const bins = size / 2
  const freq = (k: number) => (k * sr) / size
  const bandOf = new Int8Array(bins).map((_, k) => {
    const f = freq(k)
    for (let b = 0; b < BAND_NAMES.length; b++) if (f >= BAND_EDGES[b]! && f < BAND_EDGES[b + 1]!) return b
    return -1
  })
  const chromaOf = new Int8Array(bins).map((_, k) => {
    const f = freq(k)
    if (f < 55 || f > 4000) return -1
    return ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12
  })
  let prev = new Float64Array(bins)
  const frames: FrameFeatures[] = []
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let start = 0; start + size <= x.length; start += hop) {
    let ss = 0
    for (let i = 0; i < size; i++) {
      const v = x[start + i]!
      ss += v * v
      re[i] = v * win[i]!
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float64Array(bins)
    let total = 0
    let wsum = 0
    let logSum = 0
    let flux = 0
    const bands = [0, 0, 0, 0, 0]
    const chroma = Array(12).fill(0)
    for (let k = 1; k < bins; k++) {
      const m = Math.hypot(re[k]!, im[k]!)
      mag[k] = m
      const p = m * m
      total += p
      wsum += p * freq(k)
      logSum += Math.log(p + 1e-12)
      const b = bandOf[k]!
      if (b >= 0) bands[b] += p
      const c = chromaOf[k]!
      if (c >= 0) chroma[c] += p
      // Log-compressed spectral flux (rectified)
      const d = Math.log1p(1000 * m) - Math.log1p(1000 * prev[k]!)
      if (d > 0) flux += d
    }
    let cum = 0
    let roll = 0
    for (let k = 1; k < bins; k++) {
      cum += mag[k]! * mag[k]!
      if (cum >= 0.85 * total) {
        roll = freq(k)
        break
      }
    }
    const geo = Math.exp(logSum / (bins - 1))
    const ar = total / (bins - 1)
    const csum = chroma.reduce((a, b) => a + b, 0) || 1
    frames.push({
      rms: Math.sqrt(ss / size),
      centroid: total > 0 ? wsum / total : 0,
      rolloff: roll,
      flatness: ar > 0 ? geo / ar : 0,
      flux,
      bands: bands.map((v) => v / (total || 1)),
      chroma: chroma.map((v) => v / csum),
    })
    prev = mag
  }
  return { hop, frames }
}

/** Onset times (s): peaks of the flux above a moving median. */
export function detectOnsets(frames: readonly FrameFeatures[], hopSec: number): { times: number[]; strengths: number[] } {
  const flux = frames.map((f) => f.flux)
  const times: number[] = []
  const strengths: number[] = []
  const w = Math.max(3, Math.round(0.1 / hopSec))
  const minGap = Math.round(0.045 / hopSec)
  const globalMean = mean(flux)
  let last = -minGap
  for (let i = 1; i < flux.length - 1; i++) {
    const v = flux[i]!
    if (v < flux[i - 1]! || v < flux[i + 1]!) continue
    const win = flux.slice(Math.max(0, i - w), i + w + 1).sort((a, b) => a - b)
    const med = win[Math.floor(win.length / 2)]!
    if (v > med * 1.5 + 0.1 * globalMean && i - last >= minGap) {
      times.push(i * hopSec)
      strengths.push(v)
      last = i
    }
  }
  return { times, strengths }
}

/** Tempo from the autocorrelation of the onset envelope, 60–200 BPM, with pulse clarity. */
export function estimateTempo(flux: readonly number[], hopSec: number, lo = 60, hi = 200): { bpm: number; clarity: number } {
  const m = mean(flux)
  const env = flux.map((v) => Math.max(0, v - m))
  const ac = (lag: number) => {
    let s = 0
    for (let i = lag; i < env.length; i++) s += env[i]! * env[i - lag]!
    return s / (env.length - lag)
  }
  const zero = ac(0) || 1
  let best = 0
  let bestBpm = 120
  for (let bpm = lo; bpm <= hi; bpm += 0.5) {
    const lag = 60 / bpm / hopSec
    const l0 = Math.floor(lag)
    const frac = lag - l0
    const v = ac(l0) * (1 - frac) + ac(l0 + 1) * frac
    // A mild preference for 90–150, where these genres live (resolves half/double ambiguity)
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2)
    if (v * prior > best) {
      best = v * prior
      bestBpm = bpm
    }
  }
  const lag = Math.round(60 / bestBpm / hopSec)
  return { bpm: bestBpm, clarity: r3(ac(lag) / zero) }
}

/** Biquad filter (direct form I). */
function biquad(x: Float64Array, b: readonly number[], a: readonly number[]): Float64Array {
  const y = new Float64Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b[0]! * x[i]! + b[1]! * x1 + b[2]! * x2 - a[1]! * y1 - a[2]! * y2
    x2 = x1
    x1 = x[i]!
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

/** ITU-R BS.1770 K-weighting (pre-filter shelf + RLB high-pass), designed for any sample rate. */
function kWeight(x: Float32Array, sr: number): Float64Array {
  const shelf = (() => {
    const G = 3.99984385397, Q = 0.7071752369554193, fc = 1681.974450955533
    const K = Math.tan((Math.PI * fc) / sr), Vh = 10 ** (G / 20), Vb = Vh ** 0.499666774155
    const a0 = 1 + K / Q + K * K
    return { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] }
  })()
  const hp = (() => {
    const Q = 0.5003270373253953, fc = 38.13547087613982
    const K = Math.tan((Math.PI * fc) / sr)
    const a0 = 1 + K / Q + K * K
    return { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] }
  })()
  return biquad(biquad(Float64Array.from(x), shelf.b, shelf.a), hp.b, hp.a)
}

export interface Loudness {
  integrated: number
  /** Loudness range (EBU Tech 3342 style, from 3 s short-term values). */
  range: number
  shortTerm: number[]
  peakDb: number
  crestDb: number
  /** Share of samples at or past full scale (|x| ≥ 1): they clip on a fixed-point output. */
  overShare: number
}

/** Mono BS.1770 loudness (LUFS), gated; short-term values every second. */
export function loudness(x: Float32Array, sr: number): Loudness {
  const y = kWeight(x, sr)
  const blockMs = (ms: number, stepMs: number) => {
    const n = Math.round((ms / 1000) * sr)
    const step = Math.round((stepMs / 1000) * sr)
    const out: number[] = []
    for (let s = 0; s + n <= y.length; s += step) {
      let e = 0
      for (let i = s; i < s + n; i++) e += y[i]! * y[i]!
      out.push(e / n)
    }
    return out
  }
  const lufs = (ms: number) => -0.691 + 10 * Math.log10(ms + 1e-15)
  const gated = (blocks: number[], rel: number) => {
    const abs = blocks.filter((b) => lufs(b) > -70)
    const thr = lufs(mean(abs)) + rel
    return abs.filter((b) => lufs(b) > thr)
  }
  const momentary = blockMs(400, 100)
  const integrated = lufs(mean(gated(momentary, -10)))
  const st = blockMs(3000, 1000)
  const stG = gated(st, -20).map(lufs)
  let peak = 0
  let ss = 0
  let over = 0
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]!)
    if (a >= 1) over++
    if (a > peak) peak = a
    ss += x[i]! * x[i]!
  }
  const rms = Math.sqrt(ss / Math.max(1, x.length))
  return {
    integrated: r3(integrated),
    range: r3(percentile(stG, 95) - percentile(stG, 10)),
    shortTerm: st.map((b) => r3(lufs(b))),
    peakDb: r3(20 * Math.log10(peak + 1e-12)),
    crestDb: r3(20 * Math.log10((peak + 1e-12) / (rms + 1e-12))),
    overShare: Number((over / Math.max(1, x.length)).toPrecision(3)),
  }
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
export const PITCH_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

/** Krumhansl–Kessler key estimate from a mean chroma vector. */
export function estimateKey(chroma: readonly number[]): { key: string; mode: 'major' | 'minor'; strength: number } {
  const c = (a: readonly number[], b: readonly number[]) => {
    const ma = mean(a), mb = mean(b)
    let n = 0, da = 0, db = 0
    for (let i = 0; i < 12; i++) {
      n += (a[i]! - ma) * (b[i]! - mb)
      da += (a[i]! - ma) ** 2
      db += (b[i]! - mb) ** 2
    }
    return n / Math.sqrt(da * db || 1)
  }
  let best = { key: 'C', mode: 'major' as 'major' | 'minor', strength: -2 }
  for (let r = 0; r < 12; r++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - r + 12) % 12]!)
    const maj = c(chroma, rot(MAJOR_PROFILE))
    const min = c(chroma, rot(MINOR_PROFILE))
    if (maj > best.strength) best = { key: PITCH_NAMES[r]!, mode: 'major', strength: maj }
    if (min > best.strength) best = { key: PITCH_NAMES[r]!, mode: 'minor', strength: min }
  }
  return { ...best, strength: r3(best.strength) }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let n = 0, da = 0, db = 0
  for (let i = 0; i < a.length; i++) {
    n += a[i]! * b[i]!
    da += a[i]! ** 2
    db += b[i]! ** 2
  }
  return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0
}

export interface SectionAudio {
  role: string
  material: string
  start: number
  end: number
  lufs: number
  onsetsPerSecond: number
  centroid: number
  flatness: number
  bands: Record<string, number>
  /** Mean cosine similarity between this section's bars (1 = every bar sounds the same). */
  barSelfSimilarity: number
  /** Onset timing against the 16th grid: spread in ms of onsets within ±30% of a 16th. */
  gridSpreadMs: number
  /** Spread of onset strengths (coefficient of variation): accents vs. flat hits. */
  accentSpread: number
}

export interface AudioAnalysis {
  seconds: number
  offset: number
  tempo: { bpm: number; expected: number | null; error: number | null; clarity: number; windowStd: number }
  onsets: { count: number; perSecond: number; strengthSpread: number }
  loudness: Omit<Loudness, 'shortTerm'>
  spectrum: { centroid: number; centroidStd: number; rolloff: number; flatness: number; bands: Record<string, number> }
  key: { key: string; mode: string; strength: number }
  sections: SectionAudio[]
  /** Section × section cosine similarity of their mean feature vectors. */
  sectionSimilarity: number[][]
  /** Share of bar pairs (non-adjacent, both sounding) that are near-identical (cosine > 0.995). */
  barRepetition: number
  /** Mean loudness change between adjacent sections, LU (dynamic shape of the song). */
  sectionLoudnessStep: number
}

/**
 * Analyse a mono recording. `sections` and `tempo` place the song's sections in time; the
 * recording's start offset (latency before the first sound) is found from the signal.
 */
export function analyseAudio(x: Float32Array, sr: number, opts: { tempo?: number; sections?: readonly AudioSection[] } = {}): AudioAnalysis {
  const { hop, frames } = frameFeatures(x, sr)
  const hopSec = hop / sr
  // Where the music starts: the first frame within 40 dB of the loudest
  const peakRms = Math.max(...frames.map((f) => f.rms))
  const firstIdx = frames.findIndex((f) => f.rms > peakRms * 0.01)
  const offset = Math.max(0, firstIdx) * hopSec
  const { times, strengths } = detectOnsets(frames, hopSec)
  const seconds = x.length / sr
  const tempo = estimateTempo(frames.map((f) => f.flux), hopSec)
  // Tempo in 12 s windows: how stable the pulse is
  const winFrames = Math.round(12 / hopSec)
  const winBpm: number[] = []
  for (let s = 0; s + winFrames <= frames.length; s += winFrames) {
    const t = estimateTempo(frames.slice(s, s + winFrames).map((f) => f.flux), hopSec)
    if (t.clarity > 0.05) winBpm.push(t.bpm)
  }
  const expected = opts.tempo ?? null
  // Fold octave errors before comparing
  const fold = (b: number) => {
    if (!expected) return b
    let best = b
    for (const k of [0.5, 2, 2 / 3, 1.5]) if (Math.abs(b * k - expected) < Math.abs(best - expected)) best = b * k
    return best
  }
  const loud = loudness(x, sr)
  const bandsMean = (fs: readonly FrameFeatures[]) => Object.fromEntries(BAND_NAMES.map((n, i) => [n, r3(mean(fs.map((f) => f.bands[i]!)))]))
  const voiced = frames.filter((f) => f.rms > peakRms * 0.01)
  const chroma = Array.from({ length: 12 }, (_, i) => mean(voiced.map((f) => f.chroma[i]! * f.rms)))

  // Sections and bars
  const secAudio: SectionAudio[] = []
  const vectors: number[][] = []
  const barVecs: number[][] = []
  if (opts.sections && opts.tempo) {
    const barSec = (4 * 60) / opts.tempo
    const s16 = barSec / 16
    let bar = 0
    for (const sec of opts.sections) {
      const start = offset + bar * barSec
      const end = start + sec.bars * barSec
      const fs = frames.slice(Math.floor(start / hopSec), Math.floor(end / hopSec))
      const on = times.filter((t) => t >= start && t < end)
      const onStr = strengths.filter((_, i) => times[i]! >= start && times[i]! < end)
      const devs = on.map((t) => {
        const g = (t - offset) / s16
        return (g - Math.round(g)) * s16 * 1000
      }).filter((d) => Math.abs(d) < s16 * 300)
      const bars: number[][] = []
      for (let b = 0; b < sec.bars; b++) {
        const bf = frames.slice(Math.floor((start + b * barSec) / hopSec), Math.floor((start + (b + 1) * barSec) / hopSec))
        if (!bf.length) continue
        const v = barVector(bf)
        bars.push(v)
        barVecs.push(v)
      }
      const sims: number[] = []
      for (let i = 0; i < bars.length; i++) for (let j = i + 1; j < bars.length; j++) sims.push(cosine(bars[i]!, bars[j]!))
      const sl = loudness(x.subarray(Math.floor(start * sr), Math.min(x.length, Math.floor(end * sr))), sr)
      secAudio.push({
        role: sec.role,
        material: sec.material ?? 'A',
        start: r3(start),
        end: r3(end),
        lufs: sl.integrated,
        onsetsPerSecond: r3(on.length / (end - start)),
        centroid: Math.round(mean(fs.map((f) => f.centroid))),
        flatness: r3(mean(fs.map((f) => f.flatness))),
        bands: bandsMean(fs),
        barSelfSimilarity: r3(mean(sims)),
        gridSpreadMs: r3(std(devs)),
        accentSpread: r3(std(onStr) / Math.max(1e-9, mean(onStr))),
      })
      vectors.push(fs.length ? barVector(fs) : [])
      bar += sec.bars
    }
  }
  const sectionSimilarity = vectors.map((a) => vectors.map((b) => r3(a.length && b.length ? cosine(a, b) : 0)))
  let near = 0
  let pairs = 0
  for (let i = 0; i < barVecs.length; i++) {
    for (let j = i + 2; j < barVecs.length; j++) {
      pairs++
      if (cosine(barVecs[i]!, barVecs[j]!) > 0.995) near++
    }
  }
  const steps = secAudio.slice(1).map((s, i) => Math.abs(s.lufs - secAudio[i]!.lufs)).filter(Number.isFinite)
  return {
    seconds: r3(seconds),
    offset: r3(offset),
    tempo: {
      bpm: r3(fold(tempo.bpm)),
      expected,
      error: expected ? r3(fold(tempo.bpm) - expected) : null,
      clarity: tempo.clarity,
      windowStd: r3(std(winBpm.map(fold))),
    },
    onsets: { count: times.length, perSecond: r3(times.length / seconds), strengthSpread: r3(std(strengths) / Math.max(1e-9, mean(strengths))) },
    loudness: { integrated: loud.integrated, range: loud.range, peakDb: loud.peakDb, crestDb: loud.crestDb, overShare: loud.overShare },
    spectrum: {
      centroid: Math.round(mean(voiced.map((f) => f.centroid))),
      centroidStd: Math.round(std(voiced.map((f) => f.centroid))),
      rolloff: Math.round(mean(voiced.map((f) => f.rolloff))),
      flatness: r3(mean(voiced.map((f) => f.flatness))),
      bands: bandsMean(voiced),
    },
    key: estimateKey(chroma),
    sections: secAudio,
    sectionSimilarity,
    barRepetition: r3(pairs ? near / pairs : 0),
    sectionLoudnessStep: r3(mean(steps)),
  }
}

/** Mean timbre, band balance, chroma, loudness and activity of a stretch of frames. */
function barVector(fs: readonly FrameFeatures[]): number[] {
  const m = (f: (x: FrameFeatures) => number) => mean(fs.map(f))
  return [
    ...BAND_NAMES.map((_, i) => m((f) => f.bands[i]!)),
    ...Array.from({ length: 12 }, (_, i) => m((f) => f.chroma[i]!) * 0.5),
    m((f) => f.rms) * 4,
    m((f) => f.centroid) / 4000,
    m((f) => f.flux) / 200,
  ]
}
