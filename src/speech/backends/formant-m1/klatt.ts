/**
 * FROZEN: the M1 formant backend as merged in PR #14. Do not edit; it exists so every later change
 * can be A/B-compared against the baseline with identical plans and voices.
 *
 * A cascade/parallel formant synthesiser after Klatt (1980, "Software for a cascade/parallel
 * formant synthesizer", JASA 67(3)) and Klatt & Klatt (1990). Implemented natively from the papers.
 *
 * - Voicing: a KLGLOTT88-style polynomial glottal flow pulse (open quotient, jitter, shimmer), with
 *   an extra spectral-tilt low-pass; aspiration noise is added in the open phase for breathiness.
 * - Cascade branch (voicing + aspiration): nasal pole/zero pair, then five formant resonators.
 * - Parallel branch (frication and bursts): three band resonators with their own gains, plus a flat
 *   bypass path.
 * - Radiation: first difference of the summed output (+6 dB/octave).
 *
 * Parameters arrive as frames (Klatt used 5 ms); resonator coefficients change per frame and
 * amplitudes are interpolated per sample, so nothing clicks at frame edges.
 */
import { Rng } from '../../../lib/rng'

export interface SynthFrame {
  f0: number
  /** voicing, aspiration, frication and bypass amplitudes, 0–1 */
  av: number
  ah: number
  af: number
  bypass: number
  f1: number
  f2: number
  f3: number
  f4: number
  f5: number
  b1: number
  b2: number
  b3: number
  b4: number
  b5: number
  /** nasal zero; the nasal pole is fixed at NASAL_POLE (equal values cancel) */
  nz: number
  /** parallel bands: [hz, bw, gain] × 3 */
  p1: number
  pb1: number
  pg1: number
  p2: number
  pb2: number
  pg2: number
  p3: number
  pb3: number
  pg3: number
}

export interface SourceSettings {
  openQuotient: number
  jitter: number
  shimmer: number
  breathiness: number
  spectralTilt: number
}

export const NASAL_POLE = 270
const NASAL_POLE_BW = 100
const NASAL_ZERO_BW = 100

/** Two-pole digital resonator (Klatt 1980, eq. 2): y = A x + B y1 + C y2, unity gain at DC. */
class Resonator {
  /** Unity gain at the centre frequency instead of at DC (used in the parallel branch). */
  readonly peakNormalised: boolean
  constructor(peakNormalised = false) {
    this.peakNormalised = peakNormalised
  }
  a = 1
  b = 0
  c = 0
  y1 = 0
  y2 = 0
  set(f: number, bw: number, sr: number) {
    const nyq = sr * 0.49
    const freq = Math.min(f, nyq)
    const r = Math.exp((-Math.PI * bw) / sr)
    this.c = -r * r
    this.b = 2 * r * Math.cos((2 * Math.PI * freq) / sr)
    this.a = 1 - this.b - this.c
    if (this.peakNormalised) {
      // |H(e^jw)| = A / |1 - B e^-jw - C e^-2jw| at the centre frequency
      const w = (2 * Math.PI * freq) / sr
      const re = 1 - this.b * Math.cos(w) - this.c * Math.cos(2 * w)
      const im = this.b * Math.sin(w) + this.c * Math.sin(2 * w)
      this.a = Math.hypot(re, im)
    }
  }
  step(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/** Anti-resonator (Klatt 1980, eq. 3): the inverse filter of a resonator. */
class AntiResonator {
  a = 1
  b = 0
  c = 0
  x1 = 0
  x2 = 0
  set(f: number, bw: number, sr: number) {
    const r = Math.exp((-Math.PI * bw) / sr)
    const c = -r * r
    const b = 2 * r * Math.cos((2 * Math.PI * Math.min(f, sr * 0.49)) / sr)
    const a = 1 - b - c
    this.a = 1 / a
    this.b = -b / a
    this.c = -c / a
  }
  step(x: number): number {
    const y = this.a * x + this.b * this.x1 + this.c * this.x2
    this.x2 = this.x1
    this.x1 = x
    return y
  }
}

/** Approximately Gaussian noise from the project's deterministic RNG (sum of uniforms). */
function gauss(rng: Rng): number {
  return (rng.next() + rng.next() + rng.next() + rng.next() - 2) * 0.866
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u

// Relative gains of the three sources, calibrated so a sustained /s/ sits ~10 dB under /ɑː/.
const VOICE_GAIN = 1
const ASPIRATION_GAIN = 0.05
const FRICATION_GAIN = 0.055

/**
 * Render frames (each `frameSeconds` long) to mono samples. Deterministic for a given seed.
 */
export function synthesizeFrames(
  frames: readonly SynthFrame[],
  frameSeconds: number,
  sampleRate: number,
  source: SourceSettings,
  seed = 1,
): Float32Array {
  const rng = new Rng(seed)
  const perFrame = frameSeconds * sampleRate
  const total = Math.ceil(frames.length * perFrame)
  const out = new Float32Array(total)
  if (frames.length === 0) return out

  const np = new Resonator()
  const nz = new AntiResonator()
  const r1 = new Resonator()
  const r2 = new Resonator()
  const r3 = new Resonator()
  const r4 = new Resonator()
  const r5 = new Resonator()
  const q1 = new Resonator(true)
  const q2 = new Resonator(true)
  const q3 = new Resonator(true)
  np.set(NASAL_POLE, NASAL_POLE_BW, sampleRate)

  // Glottal pulse state
  let periodPos = 0 // samples into the current period
  let period = sampleRate / Math.max(40, frames[0]!.f0)
  let ampJitter = 1
  let tiltY = 0
  const tiltA = 0.1 + 0.75 * Math.min(1, Math.max(0, source.spectralTilt))
  let noiseLp = 0
  let prevOut = 0

  let frameIndex = -1
  for (let n = 0; n < total; n++) {
    const fpos = n / perFrame
    const fi = Math.min(frames.length - 1, Math.floor(fpos))
    const cur = frames[fi]!
    const nxt = frames[Math.min(frames.length - 1, fi + 1)]!
    const u = fpos - fi
    if (fi !== frameIndex) {
      frameIndex = fi
      r1.set(cur.f1, cur.b1, sampleRate)
      r2.set(cur.f2, cur.b2, sampleRate)
      r3.set(cur.f3, cur.b3, sampleRate)
      r4.set(cur.f4, cur.b4, sampleRate)
      r5.set(cur.f5, cur.b5, sampleRate)
      nz.set(cur.nz, NASAL_ZERO_BW, sampleRate)
      q1.set(cur.p1, cur.pb1, sampleRate)
      q2.set(cur.p2, cur.pb2, sampleRate)
      q3.set(cur.p3, cur.pb3, sampleRate)
    }
    const av = lerp(cur.av, nxt.av, u)
    const ah = lerp(cur.ah, nxt.ah, u)
    const af = lerp(cur.af, nxt.af, u)
    const bypass = lerp(cur.bypass, nxt.bypass, u)

    // --- voicing source
    if (periodPos >= period) {
      periodPos -= period
      const f0 = Math.max(40, lerp(cur.f0, nxt.f0, u))
      period = (sampleRate / f0) * (1 + source.jitter * gauss(rng))
      ampJitter = 1 + source.shimmer * gauss(rng)
    }
    const open = source.openQuotient * period
    let flow = 0
    let inOpen = false
    if (periodPos < open) {
      const tau = periodPos / open
      flow = 6.75 * tau * tau * (1 - tau) // peak 1 at tau = 2/3
      inOpen = true
    }
    periodPos++
    tiltY = (1 - tiltA) * flow + tiltA * tiltY
    const voicing = tiltY * av * ampJitter * VOICE_GAIN

    // --- noise sources
    const white = gauss(rng)
    noiseLp = 0.5 * white + 0.5 * noiseLp // gentle low-pass (Klatt filters his noise similarly)
    const breath = source.breathiness * av * (inOpen ? 1 : 0.35)
    const aspiration = noiseLp * (ah + breath) * ASPIRATION_GAIN

    // --- cascade: nasal pole/zero, then formants
    let x = voicing + aspiration
    x = np.step(x)
    x = nz.step(x)
    x = r5.step(x)
    x = r4.step(x)
    x = r3.step(x)
    x = r2.step(x)
    x = r1.step(x)

    // --- parallel: frication bands and bypass
    const fric = white * af * FRICATION_GAIN
    let p = 0
    if (af > 1e-4) {
      p =
        q1.step(fric) * lerp(cur.pg1, nxt.pg1, u) +
        q2.step(fric) * lerp(cur.pg2, nxt.pg2, u) +
        q3.step(fric) * lerp(cur.pg3, nxt.pg3, u) +
        fric * bypass
    } else {
      // keep the band filters ringing down rather than freezing their state
      q1.step(0)
      q2.step(0)
      q3.step(0)
    }

    // --- radiation characteristic
    const sum = x + p
    out[n] = sum - prevOut
    prevOut = sum
  }
  return out
}
