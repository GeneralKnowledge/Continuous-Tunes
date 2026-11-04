/**
 * Articulation planner for the waveguide voice (tract-processor.ts): SpeechPlan → articulatory
 * control frames every 5 ms. Nothing here makes sound.
 *
 * The model:
 * - A vowel substrate. Every vowel has a tube shape, given as four mode weights fitted to its
 *   formant targets (backends/tract/vowel-shapes.ts). Across consonants the substrate moves
 *   continuously from one vowel to the next (Öhman 1966; Story 2005).
 * - Consonant gestures superimposed on it: place (tract section), degree (diameter) and an
 *   activation that ramps on before the segment and off after it, so neighbouring gestures
 *   overlap (anticipatory coarticulation). Each gesture keeps one of three constriction slots for
 *   its whole life, so the encoded tracks never jump between gestures.
 * - Lip narrowing (rounding) and velum opening as their own channels.
 * - Sources: voicing, aspiration (h, voice onset after voiceless stops) and turbulence at the
 *   constriction for fricatives and affricate releases.
 */
import { isVowel } from '../../phonemes'
import { PAUSE, pitchAt, type PlanSegment, type SpeechPlan } from '../../plan'
import type { SpeechVoice } from '../../voice'
import { VOWEL_SHAPES } from '../../backends/tract/vowel-shapes'

export const FRAME = 0.005

export interface ArticFrame {
  f0: number
  av: number
  ah: number
  rd: number
  q1: number
  q2: number
  q3: number
  ql: number
  i1: number
  d1: number
  a1: number
  w1: number
  i2: number
  d2: number
  a2: number
  w2: number
  i3: number
  d3: number
  a3: number
  w3: number
  lt: number
  la: number
  ve: number
  ti: number
  td: number
  tn: number
}

interface Gesture {
  index: number
  diameter: number
  /** scale on Pink Trombone's constriction width (fitted, places.ts) */
  width?: number
  /** a second, weaker constriction (w: lips and velar narrowing) */
  second?: { index: number; diameter: number }
  /** 0 voiceless … 1 fully voiced */
  voice: number
  aspiration?: number
  nasal?: boolean
  /** lip diameter to narrow towards (rounding) */
  lips?: number
  stop?: boolean
}

// places along the 44 sections (0 glottis, 43 lips), as in the articulatory backend (Pink
// Trombone's own constriction widths). A fit of place and width to the formant voice's locus
// equations (Nov 2026) reached only ~1 Bark and made every class worse; see strudel-voice.md.
const LABIAL = 41
const DENTAL = 38.5
const ALVEOLAR = 36
const SIBILANT = 37.5
const POSTALVEOLAR = 35
const PALATAL = 28
const VELAR_FRONT = 25
const VELAR_BACK = 21

export const GESTURES: Record<string, Gesture> = {
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
const FRONT = new Set(['iː', 'ɪ', 'i', 'e', 'eɪ', 'æ', 'ɪə', 'eə', 'aɪ'])

const smooth = (u: number) => {
  const x = Math.min(1, Math.max(0, u))
  return x * x * (3 - 2 * x)
}
const shapeOf = (phone: string, end = false) => VOWEL_SHAPES[end ? phone + '>' : phone] ?? VOWEL_SHAPES[phone] ?? VOWEL_SHAPES['ə']!

/** The vowel-to-vowel substrate (mode weights) at time t. */
function substrate(segs: readonly PlanSegment[]): (t: number) => readonly number[] {
  const anchors: { t: number; q: readonly number[] }[] = []
  for (const s of segs) {
    if (!isVowel(s.phone)) continue
    const a = shapeOf(s.phone)
    const b = VOWEL_SHAPES[s.phone + '>'] ? shapeOf(s.phone, true) : a
    anchors.push({ t: s.start + s.duration * 0.25, q: a })
    anchors.push({ t: s.start + s.duration * (b === a ? 0.75 : 0.85), q: b })
  }
  if (anchors.length === 0) anchors.push({ t: 0, q: shapeOf('ə') })
  return (t) => {
    if (t <= anchors[0]!.t) return anchors[0]!.q
    for (let k = 0; k < anchors.length - 1; k++) {
      const a = anchors[k]!
      const b = anchors[k + 1]!
      if (t <= b.t) {
        const u = smooth((t - a.t) / Math.max(1e-6, b.t - a.t))
        return a.q.map((v, j) => v + (b.q[j]! - v) * u)
      }
    }
    return anchors[anchors.length - 1]!.q
  }
}

/** Velar place depends on the neighbouring vowel (fronted next to front vowels). */
function velarIndex(segs: readonly PlanSegment[], i: number): number {
  const near = [segs[i + 1], segs[i - 1]].find((s) => s && isVowel(s.phone))
  if (!near) return VELAR_FRONT
  return FRONT.has(near.phone) ? VELAR_FRONT + 1 : VELAR_BACK + 1
}

/** Articulatory control frames for the whole plan. */
export function buildArticulation(plan: SpeechPlan, voice: SpeechVoice): ArticFrame[] {
  const segs = plan.segments
  const sub = substrate(segs)
  const rate = Math.sqrt(voice.timing.rate)
  const strength = voice.articulation.consonantStrength
  const n = Math.ceil(plan.duration / FRAME) + 1

  // consonant gestures with their time spans and a stable slot each
  interface Live {
    g: Gesture
    seg: PlanSegment
    from: number
    to: number
    ramp: number
    slot: number
    phone: string
  }
  const live: Live[] = []
  let next = 0
  segs.forEach((s, i) => {
    if (s.phone === PAUSE || isVowel(s.phone)) return
    const g0 = GESTURES[s.phone]
    if (!g0) return
    const g = s.phone === 'k' || s.phone === 'g' || s.phone === 'ŋ' ? { ...g0, index: velarIndex(segs, i) } : g0
    const ramp = 0.022 / rate
    // w's second constriction and the main one take two slots
    live.push({ g, seg: s, from: s.start - ramp, to: s.start + s.duration + ramp, ramp, slot: next % 3, phone: s.phone })
    next++
  })

  const frames: ArticFrame[] = []
  for (let k = 0; k < n; k++) {
    const t = k * FRAME
    const q = sub(t)
    const slots = [
      { i: 0, d: 0, a: 0, w: 1 },
      { i: 0, d: 0, a: 0, w: 1 },
      { i: 0, d: 0, a: 0, w: 1 },
    ]
    // idle slots already hold the place and degree of their next gesture, so nothing slides
    for (const L of live) {
      if (L.to < t) continue
      const sl = slots[L.slot]!
      if (sl.i === 0 && L.g.diameter < 50) {
        sl.i = L.g.index
        sl.d = L.g.diameter
        sl.w = L.g.width ?? 1
      }
    }
    let lt = 3
    let la = 0
    let velum = 0.01
    let voicing = 0
    let aspiration = 0
    let ti = 0
    let td = 1
    let tn = 0
    for (const s of segs) {
      if (isVowel(s.phone) && t >= s.start && t <= s.start + s.duration) voicing = 1
    }
    for (const L of live) {
      if (t < L.from || t > L.to) continue
      const { g, seg: s } = L
      const on = smooth((t - L.from) / L.ramp)
      const off = 1 - smooth((t - (s.start + s.duration)) / L.ramp)
      const amount = Math.min(on, off)
      const inside = t >= s.start && t <= s.start + s.duration
      if (g.diameter < 50) {
        const sl = slots[L.slot]!
        sl.i = g.index
        sl.d = g.diameter
        sl.w = g.width ?? 1
        sl.a = Math.max(sl.a, amount)
      }
      if (g.second) {
        // the velar narrowing of w rides in the next slot
        const sl = slots[(L.slot + 1) % 3]!
        if (sl.a < amount) {
          sl.i = g.second.index
          sl.d = g.second.diameter
          sl.w = 1
          sl.a = amount
        }
      }
      if (g.lips !== undefined && amount > la) {
        lt = g.lips
        la = amount
      }
      if (g.nasal) velum = Math.max(velum, 0.01 + 0.39 * amount)
      if (inside) {
        const u = (t - s.start) / Math.max(1e-3, s.duration)
        voicing = Math.max(voicing, g.stop && g.voice < 1 ? g.voice * (1 - 0.7 * u) : g.voice)
        if (g.aspiration) aspiration = Math.max(aspiration, g.aspiration)
        if (!g.stop && g.diameter > 0 && g.diameter < 0.7) {
          ti = g.index
          td = g.diameter / Math.max(0.5, strength)
          tn = 1
        }
        if (AFFRICATES.has(L.phone) && u > 0.55) {
          ti = g.index
          td = 0.4
          tn = 1
        }
      }
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
    frames.push({
      f0: pitchAt(plan.pitch, t),
      av: voicing,
      ah: aspiration,
      rd: voice.source.rd,
      q1: q[0]!,
      q2: q[1]!,
      q3: q[2]!,
      ql: q[3]!,
      i1: slots[0]!.i,
      d1: slots[0]!.d,
      a1: slots[0]!.a,
      w1: slots[0]!.w,
      i2: slots[1]!.i,
      d2: slots[1]!.d,
      a2: slots[1]!.a,
      w2: slots[1]!.w,
      i3: slots[2]!.i,
      d3: slots[2]!.d,
      a3: slots[2]!.a,
      w3: slots[2]!.w,
      lt,
      la,
      ve: velum,
      ti,
      td,
      tn,
    })
  }
  return frames
}
