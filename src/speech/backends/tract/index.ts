/**
 * Articulatory backend (experimental): SpeechPlan → vocal-tract shapes over time → Pink Trombone's
 * Kelly–Lochbaum waveguide (npm `pink-trombone-mod`, MIT; reused as is, not copied).
 *
 * The control model is ours:
 * - A vocalic substrate: every vowel has a tract shape fitted to its SSB formant targets
 *   (vowel-shapes.ts, fitted by scripts/speech/fit-tract.ts). Across consonants the substrate moves
 *   continuously from one vowel to the next (Öhman 1966: consonant gestures ride on a
 *   vowel-to-vowel movement), so coarticulation and formant transitions come from the physics,
 *   not from locus tables.
 * - Consonant gestures are superimposed constrictions (place = tract section, degree = diameter,
 *   with Pink Trombone's own cosine-shaped narrowing), ramped on and off over 15–25 ms.
 * - Velum opening for nasals; turbulence at narrow constrictions (Pink Trombone's turbulence
 *   points); a release transient when a closure opens.
 * - The glottal source is our LF/Rd pulse (shared with the formant backend), with aspiration
 *   noise for /h/ and voice onset after voiceless stops.
 *
 * The waveguide runs at TRACT_RATE × formantScale (44 sections ≈ 17 cm at 88.2 kHz) and is
 * low-passed and decimated to the output rate.
 */
import { Tract } from 'pink-trombone-mod/Tract.js'
import type { Glottis } from 'pink-trombone-mod/Glottis.js'
import { Rng } from '../../../lib/rng'
import { isVowel } from '../../phonemes'
import { PAUSE, pitchAt, type PlanSegment, type SpeechPlan } from '../../plan'
import type { SpeechVoice } from '../../voice'
import { LfPulse } from '../formant/klatt'
import type { RenderOptions, SpeechBackend } from '../types'
import { NOSE_N, shapeNose } from './acoustics'
import { LIP_START, N, neutral, shapeFromParams, TRACT_RATE } from './shapes'
import { VOWEL_SHAPES } from './vowel-shapes'

const FRAME = 0.005

/** A consonant constriction: tract section, diameter at full constriction (cm), and sources. */
interface Gesture {
  index: number
  diameter: number
  /** 0 voiceless … 1 fully voiced */
  voice: number
  /** glottal aspiration during the consonant (h) */
  aspiration?: number
  nasal?: boolean
  /** extra lip narrowing (rounding) during the consonant, diameter */
  lips?: number
  /** a second, weaker constriction (w: velar narrowing as well as lips) */
  second?: { index: number; diameter: number }
  stop?: boolean
}

// Places along the 44 sections (0 glottis, 43 lips). Fricative diameters sit where Pink Trombone's
// turbulence is strongest (0.3–0.7 cm); stops close fully; approximants stay above 0.7 (no noise).
const LABIAL = 41
const DENTAL = 38.5
const ALVEOLAR = 36
const SIBILANT = 37.5
const POSTALVEOLAR = 35
const PALATAL = 28
const VELAR_FRONT = 25
const VELAR_BACK = 21

const GESTURES: Record<string, Gesture> = {
  p: { index: LABIAL, diameter: 0, voice: 0, stop: true },
  b: { index: LABIAL, diameter: 0, voice: 0.6, stop: true },
  m: { index: LABIAL, diameter: 0, voice: 1, nasal: true },
  f: { index: LABIAL, diameter: 0.42, voice: 0 },
  v: { index: LABIAL, diameter: 0.42, voice: 0.7 },
  θ: { index: DENTAL, diameter: 0.45, voice: 0 },
  ð: { index: DENTAL, diameter: 0.45, voice: 0.7 },
  t: { index: ALVEOLAR, diameter: 0, voice: 0, stop: true },
  d: { index: ALVEOLAR, diameter: 0, voice: 0.6, stop: true },
  n: { index: ALVEOLAR, diameter: 0, voice: 1, nasal: true },
  s: { index: SIBILANT, diameter: 0.36, voice: 0 },
  z: { index: SIBILANT, diameter: 0.36, voice: 0.7 },
  ʃ: { index: POSTALVEOLAR, diameter: 0.4, voice: 0, lips: 1.0 },
  ʒ: { index: POSTALVEOLAR, diameter: 0.4, voice: 0.7, lips: 1.0 },
  tʃ: { index: POSTALVEOLAR, diameter: 0, voice: 0, stop: true, lips: 1.0 },
  dʒ: { index: POSTALVEOLAR, diameter: 0, voice: 0.6, stop: true, lips: 1.0 },
  k: { index: VELAR_FRONT, diameter: 0, voice: 0, stop: true },
  g: { index: VELAR_FRONT, diameter: 0, voice: 0.6, stop: true },
  ŋ: { index: VELAR_FRONT, diameter: 0, voice: 1, nasal: true },
  l: { index: ALVEOLAR, diameter: 0.85, voice: 1 },
  r: { index: 31, diameter: 0.9, voice: 1, lips: 0.9 },
  w: { index: LABIAL, diameter: 0.75, voice: 1, second: { index: VELAR_BACK, diameter: 1.0 } },
  j: { index: PALATAL, diameter: 0.8, voice: 1 },
  h: { index: 0, diameter: 99, voice: 0, aspiration: 1 },
}

const AFFRICATES = new Set(['tʃ', 'dʒ'])
const VOICELESS_STOPS = new Set(['p', 't', 'k', 'tʃ'])

/** Pink Trombone's constriction profile: narrow `d` towards `diameter` around `index`. */
function constrict(d: Float64Array, index: number, diameter: number, amount: number): void {
  if (amount <= 0) return
  const width = index < 25 ? 10 : index >= 32 ? 5 : 10 - (5 * (index - 25)) / 7
  for (let i = -Math.ceil(width) - 1; i < width + 1; i++) {
    const p = Math.round(index) + i
    if (p < 0 || p >= N) continue
    const rel = Math.abs(p - index) - 0.5
    const shrink = rel <= 0 ? 0 : rel > width ? 1 : 0.5 * (1 - Math.cos((Math.PI * rel) / width))
    const target = diameter + (d[p]! - diameter) * shrink
    if (target < d[p]!) d[p] = d[p]! + (target - d[p]!) * amount
  }
}

function vowelShape(phone: string, end = false): Float64Array {
  const p = VOWEL_SHAPES[end ? phone + '>' : phone] ?? VOWEL_SHAPES[phone] ?? VOWEL_SHAPES['ə']!
  return shapeFromParams(p)
}

const smooth = (u: number) => {
  const x = Math.min(1, Math.max(0, u))
  return x * x * (3 - 2 * x)
}

interface Track {
  /** vocalic substrate at time t */
  substrate(t: number): Float64Array
}

/** The vowel-to-vowel substrate: vowel shapes held over their vowels, interpolated across consonants. */
function buildSubstrate(segs: readonly PlanSegment[]): Track {
  // anchor points (time, shape): start/end of each vowel (diphthongs glide inside)
  const anchors: { t: number; shape: Float64Array }[] = []
  for (const s of segs) {
    if (!isVowel(s.phone)) continue
    const a = vowelShape(s.phone)
    const b = VOWEL_SHAPES[s.phone + '>'] ? vowelShape(s.phone, true) : a
    anchors.push({ t: s.start + s.duration * 0.25, shape: a })
    anchors.push({ t: s.start + s.duration * (b === a ? 0.75 : 0.85), shape: b })
  }
  const rest = vowelShape('ə')
  if (anchors.length === 0) anchors.push({ t: 0, shape: rest })
  return {
    substrate(t: number) {
      if (t <= anchors[0]!.t) return anchors[0]!.shape
      for (let k = 0; k < anchors.length - 1; k++) {
        const a = anchors[k]!, b = anchors[k + 1]!
        if (t <= b.t) {
          const u = smooth((t - a.t) / Math.max(1e-6, b.t - a.t))
          const out = new Float64Array(N)
          for (let i = 0; i < N; i++) out[i] = a.shape[i]! + (b.shape[i]! - a.shape[i]!) * u
          return out
        }
      }
      return anchors[anchors.length - 1]!.shape
    },
  }
}

/** Velar place depends on the neighbouring vowels (fronted next to front vowels). */
function velarIndex(segs: readonly PlanSegment[], i: number): number {
  const near = [segs[i + 1], segs[i - 1]].find((s) => s && isVowel(s.phone))
  if (!near) return VELAR_FRONT
  const front = ['iː', 'ɪ', 'i', 'e', 'eɪ', 'æ', 'ɪə', 'eə', 'aɪ'].includes(near.phone)
  return front ? VELAR_FRONT + 1 : VELAR_BACK + 1
}

interface FrameState {
  diameters: Float64Array
  velum: number
  voice: number
  aspiration: number
  turbulence: { position: number; diameter: number }[]
  f0: number
}

/** Articulatory state every 5 ms. */
export function buildTractFrames(plan: SpeechPlan, voice: SpeechVoice): FrameState[] {
  const segs = plan.segments
  const sub = buildSubstrate(segs)
  const rate = Math.sqrt(voice.timing.rate)
  const strength = voice.articulation.consonantStrength
  const frames: FrameState[] = []
  const n = Math.ceil(plan.duration / FRAME) + 1
  for (let k = 0; k < n; k++) {
    const t = k * FRAME
    const d = Float64Array.from(sub.substrate(t))
    let velum = 0.01
    let voicing = 0
    let aspiration = 0
    const turbulence: { position: number; diameter: number }[] = []
    // every consonant whose gesture (with its ramps) covers t contributes
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!
      const ramp = (s.phone === PAUSE ? 0.03 : 0.022) / rate
      if (t < s.start - ramp || t > s.start + s.duration + ramp) continue
      const inside = t >= s.start && t <= s.start + s.duration
      if (s.phone === PAUSE) continue
      if (isVowel(s.phone)) {
        if (inside) voicing = Math.max(voicing, 1)
        continue
      }
      const g0 = GESTURES[s.phone]
      if (!g0) continue
      const g = s.phone === 'k' || s.phone === 'g' || s.phone === 'ŋ' ? { ...g0, index: velarIndex(segs, i) } : g0
      // gesture activation: ramps up before the segment, holds, releases after it
      const on = smooth((t - (s.start - ramp)) / ramp)
      const off = 1 - smooth((t - (s.start + s.duration)) / ramp)
      const amount = Math.min(on, off)
      if (g.diameter < 50) constrict(d, g.index, g.diameter, amount)
      if (g.second) constrict(d, g.second.index, g.second.diameter, amount)
      if (g.lips !== undefined) for (let j = LIP_START; j < N; j++) d[j] = Math.min(d[j]!, d[j]! + (g.lips - d[j]!) * amount)
      if (g.nasal) velum = Math.max(velum, 0.01 + 0.39 * amount)
      if (inside) {
        // voiced stops: voicing dies away through the closure as pressure builds
        const u = (t - s.start) / Math.max(1e-3, s.duration)
        voicing = Math.max(voicing, g.stop && g.voice < 1 ? g.voice * (1 - 0.7 * u) : g.voice)
        if (g.aspiration) aspiration = Math.max(aspiration, g.aspiration)
        if (!g.stop && g.diameter > 0 && g.diameter < 0.7) turbulence.push({ position: g.index, diameter: g.diameter / Math.max(0.5, strength) })
      }
      // affricates: frication through the release
      if (AFFRICATES.has(s.phone) && t > s.start + s.duration * 0.55 && inside) turbulence.push({ position: g.index, diameter: 0.4 })
    }
    // aspiration after a voiceless stop, into a following vowel (voice onset time)
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i]!
      const prev = segs[i - 1]!
      if (!isVowel(s.phone) || !VOICELESS_STOPS.has(prev.phone)) continue
      const vot = ((voice.articulation.aspirationMs / 1000) * (s.stress === 0 ? 0.45 : 1)) / rate
      if (t >= s.start && t < s.start + vot) {
        aspiration = Math.max(aspiration, 0.8 * (1 - (t - s.start) / vot))
        voicing = Math.min(voicing, (t - s.start) / vot)
      }
    }
    frames.push({ diameters: d, velum, voice: voicing, aspiration, turbulence, f0: pitchAt(plan.pitch, t) })
  }
  return frames
}

/** Biquad low-pass (RBJ) for decimation. */
class LowPass {
  private b0 = 0; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0
  constructor(fc: number, rate: number, q = Math.SQRT1_2) {
    const w = (2 * Math.PI * fc) / rate
    const alpha = Math.sin(w) / (2 * q)
    const c = Math.cos(w)
    const a0 = 1 + alpha
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0
    this.a1 = (-2 * c) / a0; this.a2 = (1 - alpha) / a0
  }
  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y
    return y
  }
}

export function renderTract(plan: SpeechPlan, voice: SpeechVoice, opts: RenderOptions = {}): Float32Array {
  const sampleRate = opts.sampleRate ?? 22050
  const rng = new Rng(opts.seed ?? 1)
  const frames = buildTractFrames(plan, voice)
  const tractRate = TRACT_RATE * voice.tract.formantScale
  const gauss = () => (rng.next() + rng.next() + rng.next() + rng.next() - 2) * 0.866

  // glottis: our LF pulse; the tract asks it how strongly turbulence is modulated by the voicing
  const pulse = new LfPulse()
  pulse.setRd(voice.source.rd)
  let phase = 0
  let inOpen = true
  let curVoice = 0
  const glottis = {
    getNoiseModulator: () => (curVoice > 0.1 ? (inOpen ? 1 : 0.4) : 1),
  } as unknown as Glottis
  const tract = new Tract(glottis, tractRate)
  for (let i = 0; i < N; i++) tract.diameter[i] = frames[0]?.diameters[i] ?? neutral(i)
  shapeNose(tract, 0.4)
  tract.calculateNoseReflections() // nose reflections once, with the velum open (as Pink Trombone does)
  shapeNose(tract, 0.01)
  // Deterministic frication noise, white apart from a DC block: the cavity in front of the
  // constriction shapes it (Pink Trombone's own source is a 1 kHz band-pass of Math.random).
  let dc = 0
  ;(tract as unknown as { fricationNoiseSource: () => number }).fricationNoiseSource = () => {
    const x = gauss()
    dc = 0.99 * dc + 0.01 * x
    return x - dc
  }
  tract.calculateNewBlockParameters()
  tract.calculateNewBlockParameters()

  const perFrame = FRAME * tractRate
  const totalTract = Math.ceil(frames.length * perFrame)
  const lp1 = new LowPass(sampleRate * 0.45, tractRate)
  const lp2 = new LowPass(sampleRate * 0.45, tractRate)
  const ratio = tractRate / sampleRate
  const out = new Float32Array(Math.ceil(totalTract / ratio))
  let prevSample = 0
  let outIndex = 0
  let nextOut = 0
  let lastClosure = -1
  let frameIndex = -1
  let noiseLp = 0
  for (let n = 0; n < totalTract; n++) {
    const fpos = n / perFrame
    const fi = Math.min(frames.length - 1, Math.floor(fpos))
    const f = frames[fi]!
    if (fi !== frameIndex) {
      frameIndex = fi
      for (let i = 0; i < N; i++) tract.diameter[i] = f.diameters[i]!
      tract.noseDiameter[0] = f.velum
      // release transient when a full closure opens (as Pink Trombone's TractShaper does)
      let closure = -1
      for (let i = 0; i < N; i++) if (f.diameters[i]! <= 0.02) closure = i
      if (lastClosure > -1 && closure === -1 && f.velum < 0.223) {
        tract.transients.push({ position: lastClosure, startTime: tract.time, lifeTime: 0.2, strength: 0.3 * voice.articulation.consonantStrength, exponent: 200 })
      }
      lastClosure = closure
      tract.turbulencePoints = f.turbulence.map((p) => ({ position: p.position, diameter: p.diameter, startTime: tract.time - 1, endTime: NaN }))
      tract.calculateNewBlockParameters()
    }
    const lambda = fpos - fi
    // glottal source
    const next = frames[Math.min(frames.length - 1, fi + 1)]!
    const f0 = f.f0 + (next.f0 - f.f0) * lambda
    if (phase >= 1) {
      phase -= 1
      pulse.setRd(voice.source.rd)
    }
    curVoice = f.voice + (next.voice - f.voice) * lambda
    const flow = pulse.at(phase)
    inOpen = phase < pulse.te
    phase += f0 / tractRate
    noiseLp = 0.6 * gauss() + 0.4 * noiseLp
    const asp = (f.aspiration + (next.aspiration - f.aspiration) * lambda) * noiseLp * 0.35 + voice.source.breathiness * curVoice * noiseLp * (inOpen ? 0.25 : 0.08)
    const glottal = flow * curVoice * 0.5 + asp
    const y = lp2.step(lp1.step(tract.step(glottal, lambda)))
    // fractional decimation (linear interpolation between tract samples)
    while (nextOut <= n && outIndex < out.length) {
      const u = 1 - (n - nextOut)
      out[outIndex++] = prevSample + (y - prevSample) * u
      nextOut += ratio
    }
    prevSample = y
  }
  return out.subarray(0, Math.ceil(plan.duration * sampleRate))
}

export const tractBackend: SpeechBackend = {
  id: 'tract',
  name: 'Articulatory (Pink Trombone waveguide)',
  description: 'Experimental: vocal-tract shapes from the plan through a Kelly–Lochbaum waveguide',
  render: renderTract,
}

export { NOSE_N }
