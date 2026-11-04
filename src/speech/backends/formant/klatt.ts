/**
 * A cascade/parallel formant synthesiser after Klatt (1980, "Software for a cascade/parallel
 * formant synthesizer", JASA 67(3)) and Klatt & Klatt (1990). Implemented natively from the papers.
 *
 * - Voicing (M2): the Liljencrants–Fant (LF) glottal flow derivative, shaped by one voice-quality
 *   parameter Rd (Fant 1995: 0.3 pressed … 1 modal … 2.7 breathy/lax), with jitter, shimmer and
 *   Klatt's flutter (slow quasi-random f0 drift). The Rd → (Ra, Rk, Rg) regression and the LF
 *   solution follow Pink Trombone's glottis (Neil Thapen, MIT; via chdh/pink-trombone-mod).
 *   Using the flow *derivative* folds lip radiation into the source, so no output differencing.
 *   Aspiration noise is gated by the glottal cycle (stronger while the glottis is open).
 * - Cascade branch (voicing + aspiration): nasal pole/zero pair, then five formant resonators.
 * - Parallel branch (frication and bursts): three band resonators with their own gains, plus a flat
 *   bypass path.
 * - Radiation: folded into the voicing source (flow derivative); noise sources are white, i.e.
 *   already flat after radiation, as in Klatt's own noise path.
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
  /** nasal zero and pole (pole defaults to NASAL_POLE; equal values cancel) */
  nz: number
  np?: number
  /** voice quality for this frame (LF Rd); defaults to the voice's */
  rd?: number
  /** high-pass corner of the frication noise, Hz (0 = none): the front-cavity cut-off */
  fhp?: number
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
  /** LF voice quality (Fant's Rd), 0.3 tense – 2.7 lax */
  rd: number
  jitter: number
  shimmer: number
  breathiness: number
  /** Extra one-pole low-pass on the source: 0 none – 1 strong */
  spectralTilt: number
  /** Klatt's flutter: slow f0 drift, 0–1 (1 ≈ ±1.5% of f0) */
  flutter: number
}

/**
 * Resonances above F5 for a tract of the given scale. A real vocal tract keeps resonating above
 * 5 kHz (roughly every 1.1 kHz for a 16 cm male tract); with only five cascade poles the response
 * falls ~60 dB/octave above F5 and vowels lose everything over ~5 kHz, which sounds muffled and
 * leaves recognisers' upper mel bands empty. Fant (1960) handles this with a "higher-pole
 * correction"; at 22–48 kHz it is simpler and more faithful to include the poles themselves,
 * with bandwidths widening with frequency (wall and radiation losses).
 */
export function higherPoles(formantScale: number): [number, number][] {
  return [5600, 6700, 7800, 8900, 10000].map((f, i) => [f * formantScale, 500 + 250 * i])
}

/** One period of the LF flow-derivative model, normalised so its negative peak (Ee) is −1. */
export class LfPulse {
  alpha = 0
  e0 = 0
  epsilon = 0
  shift = 0
  delta = 0
  te = 0
  omega = 0
  /** set the pulse shape from Rd (clamped to the regression's valid range 0.3–2.7) */
  setRd(rdIn: number) {
    const rd = Math.min(2.7, Math.max(0.3, rdIn))
    const ra = -0.01 + 0.048 * rd
    const rk = 0.224 + 0.118 * rd
    const rg = ((rk / 4) * (0.5 + 1.2 * rk)) / (0.11 * rd - ra * (0.5 + 1.2 * rk))
    const ta = ra
    const tp = 1 / (2 * rg)
    const te = tp + tp * rk
    const epsilon = 1 / ta
    const shift = Math.exp(-epsilon * (1 - te))
    const delta = 1 - shift
    const rhsIntegral = ((1 / epsilon) * (shift - 1) + (1 - te) * shift) / delta
    const totalLowerIntegral = rhsIntegral - (te - tp) / 2
    const totalUpperIntegral = -totalLowerIntegral
    const omega = Math.PI / tp
    const s = Math.sin(omega * te)
    const y = (-Math.PI * s * totalUpperIntegral) / (tp * 2)
    const z = Math.log(y)
    const alpha = z / (tp / 2 - te)
    this.e0 = -1 / (s * Math.exp(alpha * te))
    this.alpha = alpha
    this.epsilon = epsilon
    this.shift = shift
    this.delta = delta
    this.te = te
    this.omega = omega
  }
  /** flow derivative at phase t ∈ [0, 1) */
  at(t: number): number {
    if (t > this.te) return (-Math.exp(-this.epsilon * (t - this.te)) + this.shift) / this.delta
    return this.e0 * Math.exp(this.alpha * t) * Math.sin(this.omega * t)
  }
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

/** RBJ-cookbook biquad high-pass; two in series with Q 0.54 and 1.31 make a 4th-order Butterworth. */
class HighPass {
  b0 = 1
  b1 = 0
  b2 = 0
  a1 = 0
  a2 = 0
  x1 = 0
  x2 = 0
  y1 = 0
  y2 = 0
  readonly q: number
  constructor(q: number) {
    this.q = q
  }
  set(fc: number, sr: number) {
    if (fc <= 0) {
      this.b0 = 1
      this.b1 = this.b2 = this.a1 = this.a2 = 0
      return
    }
    const w = (2 * Math.PI * Math.min(fc, sr * 0.45)) / sr
    const alpha = Math.sin(w) / (2 * this.q)
    const cw = Math.cos(w)
    const a0 = 1 + alpha
    this.b0 = (1 + cw) / 2 / a0
    this.b1 = -(1 + cw) / a0
    this.b2 = (1 + cw) / 2 / a0
    this.a1 = (-2 * cw) / a0
    this.a2 = (1 - alpha) / a0
  }
  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/** Approximately Gaussian noise from the project's deterministic RNG (sum of uniforms). */
function gauss(rng: Rng): number {
  return (rng.next() + rng.next() + rng.next() + rng.next() - 2) * 0.866
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u

// Relative gains of the three sources, calibrated so a sustained /s/ sits ~10 dB under /ɑː/.
const VOICE_GAIN = 0.026
// 0.95 brings sustained vowels within ~3 dB of Peterson & Barney's (1952) formant amplitudes but the
// extra buzz above 3 kHz was heard as affrication ("mat" → "match") by every recogniser; 0.6 is the
// measured compromise (see docs/speech/m2-audit-and-plan.md).
const HPC = 0.6
const ASPIRATION_GAIN = 0.004
const FRICATION_GAIN = 0.0055

/**
 * Render frames (each `frameSeconds` long) to mono samples. Deterministic for a given seed.
 */
export function synthesizeFrames(
  frames: readonly SynthFrame[],
  frameSeconds: number,
  sampleRate: number,
  source: SourceSettings,
  seed = 1,
  /** Fixed resonances above F5 ([hz, bw] pairs), e.g. from higherPoles(); none = Klatt's five */
  highPoles: readonly (readonly [number, number])[] = [],
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
  const hp = highPoles
    .filter(([f]) => f < sampleRate * 0.45)
    .map(([f, bw]) => {
      const r = new Resonator()
      r.set(f, bw, sampleRate)
      return r
    })
  const q1 = new Resonator(true)
  const q2 = new Resonator(true)
  const q3 = new Resonator(true)
  np.set(NASAL_POLE, NASAL_POLE_BW, sampleRate)
  const hpA = new HighPass(0.54)
  const hpB = new HighPass(1.31)
  let hpFc = -1

  // Glottal pulse state
  const pulse = new LfPulse()
  let phase = 0 // position in the current period, 0–1
  let periodSamples = sampleRate / Math.max(40, frames[0]!.f0)
  pulse.setRd(frames[0]!.rd ?? source.rd)
  let ampJitter = 1
  let tiltY = 0
  const tiltA = 0.6 * Math.min(1, Math.max(0, source.spectralTilt))
  let noiseLp = 0
  let prevFlow = 0
  const flutterDepth = 0.015 * source.flutter

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
      np.set(cur.np ?? NASAL_POLE, NASAL_POLE_BW, sampleRate)
      nz.set(cur.nz, NASAL_ZERO_BW, sampleRate)
      q1.set(cur.p1, cur.pb1, sampleRate)
      q2.set(cur.p2, cur.pb2, sampleRate)
      q3.set(cur.p3, cur.pb3, sampleRate)
      const fc = cur.fhp ?? 0
      if (fc !== hpFc) {
        hpFc = fc
        hpA.set(fc, sampleRate)
        hpB.set(fc, sampleRate)
      }
    }
    const av = lerp(cur.av, nxt.av, u)
    const ah = lerp(cur.ah, nxt.ah, u)
    const af = lerp(cur.af, nxt.af, u)
    const bypass = lerp(cur.bypass, nxt.bypass, u)

    // --- voicing source: one LF pulse per period, shape and length fixed at the period start
    if (phase >= 1) {
      phase -= 1
      const t = n / sampleRate
      const flutter = 1 + flutterDepth * (Math.sin(2 * Math.PI * 12.7 * t) + Math.sin(2 * Math.PI * 7.1 * t) + Math.sin(2 * Math.PI * 4.7 * t)) / 3
      const f0 = Math.max(40, lerp(cur.f0, nxt.f0, u) * flutter)
      periodSamples = (sampleRate / f0) * (1 + source.jitter * gauss(rng))
      ampJitter = 1 + source.shimmer * gauss(rng)
      pulse.setRd(lerp(cur.rd ?? source.rd, nxt.rd ?? source.rd, u))
    }
    const dflow = pulse.at(phase)
    const inOpen = phase < pulse.te
    phase += 1 / periodSamples
    // higher-pole correction: the five-resonator cascade lacks the poles above F5 that lift a real
    // tract's response above ~2 kHz (Fant 1960); a first-order emphasis stands in for them
    const emph = dflow - HPC * prevFlow
    prevFlow = dflow
    tiltY = (1 - tiltA) * emph + tiltA * tiltY
    const voicing = tiltY * av * ampJitter * VOICE_GAIN

    // --- noise sources (white = flat after radiation)
    const white = gauss(rng)
    noiseLp = 0.5 * white + 0.5 * noiseLp // gentle low-pass for aspiration (Klatt 1980)
    const breath = source.breathiness * av * (inOpen ? 1 : 0.35)
    const aspiration = noiseLp * (ah + breath) * ASPIRATION_GAIN

    // --- cascade: nasal pole/zero, then formants
    let x = voicing + aspiration
    x = np.step(x)
    x = nz.step(x)
    for (const r of hp) x = r.step(x)
    x = r5.step(x)
    x = r4.step(x)
    x = r3.step(x)
    x = r2.step(x)
    x = r1.step(x)

    // --- parallel: frication bands and bypass. In voiced fricatives the noise is modulated by the
    // glottal cycle (Klatt 1980: turbulence is stronger while air flows through the open glottis).
    const mod = av > 0.05 ? 1 - Math.min(0.5, av) * (inOpen ? 0 : 1) : 1
    const fric = hpB.step(hpA.step(gauss(rng))) * af * FRICATION_GAIN * mod
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

    out[n] = x + p
  }
  return out
}
