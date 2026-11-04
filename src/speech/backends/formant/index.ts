/**
 * Formant backend: SpeechPlan → parameter frames → Klatt synthesiser.
 *
 * Each plan segment becomes one or more phases (a stop is closure + burst; a voiceless stop before
 * a stressed vowel aspirates the start of that vowel). Formant tracks move from the boundary value
 * (a locus-equation blend of consonant and vowel) to each phase's target and back, so consonants
 * are heard mostly through the transitions they impose on vowels, as in natural speech.
 */
import { isVowel } from '../../phonemes'
import { PAUSE, pitchAt, type PlanSegment, type SpeechPlan } from '../../plan'
import type { SpeechVoice } from '../../voice'
import type { RenderOptions, SpeechBackend } from '../types'
import { higherPoles, synthesizeFrames, NASAL_POLE, type SynthFrame } from './klatt'
import { SCHWA, targetFor, type ConsonantTarget, type FricBand, type Formants } from './targets'

const FRAME = 0.005

interface Phase {
  start: number
  end: number
  /** formant target at the phase centre (for diphthongs, the start) */
  formants: Formants
  glideTo?: Formants
  /** nasal zero target */
  nz: number
  av: number
  ah: number
  af: number
  bypass: number
  fric: readonly FricBand[]
  fricHp?: number
  /** stop releases: the frication decays from a transient instead of holding level */
  burst?: boolean
  /** consonant data for boundary blending, if this phase is a consonant */
  cons?: ConsonantTarget
  vowel: boolean
  silent: boolean
  /** seconds of aspiration at the start of this phase (after a voiceless stop) */
  aspiration: number
  /** stops: closure and burst share formants, so no transition between them */
  group: number
}

const VOICELESS_STOPS = new Set(['p', 't', 'k', 'tʃ'])

function mixFormants(a: Formants, b: Formants, u: number): Formants {
  return {
    f1: a.f1 + (b.f1 - a.f1) * u,
    f2: a.f2 + (b.f2 - a.f2) * u,
    f3: a.f3 + (b.f3 - a.f3) * u,
    b1: a.b1 + (b.b1 - a.b1) * u,
    b2: a.b2 + (b.b2 - a.b2) * u,
    b3: a.b3 + (b.b3 - a.b3) * u,
  }
}

function nextVowelFormants(segs: readonly PlanSegment[], i: number, dir: 1 | -1): Formants | null {
  for (let k = i + dir; k >= 0 && k < segs.length; k += dir) {
    const p = segs[k]!.phone
    if (p === PAUSE) return null
    if (isVowel(p)) return targetFor(p).formants
  }
  return null
}

/** Turn plan segments into acoustic phases. */
export function buildPhases(plan: SpeechPlan, voice: SpeechVoice): Phase[] {
  const phases: Phase[] = []
  const segs = plan.segments
  const strength = voice.articulation.consonantStrength
  let group = 0
  segs.forEach((seg, i) => {
    group++
    const start = seg.start
    const end = seg.start + seg.duration
    if (seg.phone === PAUSE) {
      const near = nextVowelFormants(segs, i, 1) ?? nextVowelFormants(segs, i, -1) ?? SCHWA
      phases.push({ start, end, formants: near, nz: NASAL_POLE, av: 0, ah: 0, af: 0, bypass: 0, fric: [], vowel: false, silent: true, aspiration: 0, group })
      return
    }
    const target = targetFor(seg.phone)
    if (target.kind === 'vowel') {
      // undershoot: short unstressed vowels drift towards schwa
      const u = seg.stress === 0 ? voice.articulation.coarticulation * Math.max(0, 1 - seg.duration / 0.12) : 0
      const formants = mixFormants(target.formants, SCHWA, u)
      const glideTo = target.glideTo ? mixFormants(target.glideTo, SCHWA, u) : undefined
      const prev = segs[i - 1]
      const prevPrev = segs[i - 2]
      // aspiration after a voiceless stop (not after /s/: "spin", "stop")
      let aspiration = 0
      if (prev && VOICELESS_STOPS.has(prev.phone) && prev.phone !== 'tʃ' && !(prevPrev?.phone === 's' && prevPrev.word === prev.word)) {
        aspiration = (voice.articulation.aspirationMs / 1000) * (seg.stress === 0 ? 0.45 : 1) / Math.sqrt(voice.timing.rate)
        aspiration = Math.min(aspiration, seg.duration * 0.45)
      }
      phases.push({ start, end, formants, ...(glideTo ? { glideTo } : {}), nz: NASAL_POLE, av: 1, ah: 0, af: 0, bypass: 0, fric: [], vowel: true, silent: false, aspiration, group })
      return
    }
    // consonants
    const following = nextVowelFormants(segs, i, 1) ?? nextVowelFormants(segs, i, -1) ?? SCHWA
    const formants = target.followsVowel ? following : target.formants
    const base = {
      formants,
      nz: target.nasalZero ?? NASAL_POLE,
      cons: target,
      vowel: false,
      silent: false,
      aspiration: 0,
      group,
    }
    if (target.stop) {
      const burst = Math.min(target.stop.burstMs / 1000, seg.duration * 0.5)
      // velar bursts take their frequency from the following vowel's F2 (front vowels: higher)
      const fric: FricBand[] = target.fric.map((b, k) =>
        k === 0 && (seg.phone === 'k' || seg.phone === 'g')
          ? [Math.min(3000, Math.max(1500, following.f2 * 1.05)), b[1], b[2]]
          : b,
      )
      // Word-final stops before a pause are released weakly or not at all in British English
      // (often glottally reinforced); a full release there is heard as an affricate.
      const finalRelease = seg.phraseFinal && seg.wordFinal && !target.af ? 0.35 : 1
      const af = (target.af || target.stop.burstGain) * strength * finalRelease
      phases.push({ ...base, start, end: end - burst, av: target.av, ah: 0, af: 0, bypass: 0, fric, fricHp: target.fricHp })
      phases.push({ ...base, start: end - burst, end, av: target.av, ah: 0, af, bypass: target.bypass, fric, fricHp: target.fricHp, burst: !target.af })
      return
    }
    phases.push({
      ...base,
      start,
      end,
      av: target.av,
      ah: target.ah * Math.min(1.4, strength),
      af: target.af * strength,
      bypass: target.bypass,
      fric: target.fric,
      fricHp: target.fricHp,
    })
  })
  return phases
}

/** Boundary formants between two phases: locus-equation blend at consonant/vowel edges. */
function boundaryFormants(a: Phase, b: Phase): Formants {
  const cv = (c: Phase, v: Phase): Formants => {
    const k = c.cons!.slope
    const L = c.cons!.followsVowel ? v.formants : c.cons!.locus
    const V = v.vowel ? v.formants : v.formants
    return {
      f1: L.f1 + k * (V.f1 - L.f1),
      f2: L.f2 + k * (V.f2 - L.f2),
      f3: L.f3 + k * (V.f3 - L.f3),
      b1: (L.b1 + V.b1) / 2,
      b2: (L.b2 + V.b2) / 2,
      b3: (L.b3 + V.b3) / 2,
    }
  }
  const aEnd = a.glideTo ?? a.formants
  if (a.silent) return b.formants
  if (b.silent) return aEnd
  if (a.cons && !b.cons) return cv(a, b)
  if (b.cons && !a.cons) return cv(b, { ...a, formants: aEnd })
  return mixFormants(aEnd, b.formants, 0.5)
}

/** Transition time on each side of the boundary between phases a and b, seconds. */
function transitionSides(a: Phase, b: Phase, voice: SpeechVoice): [number, number] {
  const scale = voice.articulation.transitionMs / 50 / Math.sqrt(voice.timing.rate)
  const consSide = (c: Phase) => {
    const m = c.cons!
    const sonorant = m.av >= 0.5
    return (sonorant ? m.transitionMs * 0.5 : 12) / 1000
  }
  if (a.silent || b.silent) return [0.01, 0.01]
  if (a.group === b.group) return [0, 0]
  if (a.cons && b.cons) return [0.02, 0.02]
  if (a.cons) return [consSide(a), (a.cons.transitionMs / 1000) * scale]
  if (b.cons) return [(b.cons.transitionMs / 1000) * scale, consSide(b)]
  return [0.04 * scale, 0.04 * scale]
}

const smooth = (u: number) => u * u * (3 - 2 * u)

/** The phase's own formants at time t (diphthongs glide between their two targets). */
function steady(p: Phase, t: number): Formants {
  if (!p.glideTo) return p.formants
  const u = (t - p.start) / Math.max(1e-6, p.end - p.start)
  return mixFormants(p.formants, p.glideTo, smooth(Math.min(1, Math.max(0, (u - 0.2) / 0.65))))
}

/** Parameter frames for the whole plan. */
export function buildFrames(plan: SpeechPlan, voice: SpeechVoice, sampleRate: number): SynthFrame[] {
  const phases = buildPhases(plan, voice)
  const n = Math.ceil(plan.duration / FRAME) + 1
  const frames: SynthFrame[] = []
  if (phases.length === 0) return frames
  const fs = voice.tract.formantScale
  const bs = voice.tract.bandwidthScale
  const nasality = voice.tract.nasality
  const nyq = sampleRate * 0.45

  // boundaries and their transition sides
  const bounds = phases.slice(1).map((b, i) => {
    const a = phases[i]!
    const [left, right] = transitionSides(a, b, voice)
    const fm = boundaryFormants(a, b)
    // nasal coupling spreads into neighbouring vowels by `nasality`
    const nasalA = a.nz !== NASAL_POLE
    const nasalB = b.nz !== NASAL_POLE
    let nz = (a.nz + b.nz) / 2
    if (nasalA !== nasalB) {
      const nasalNz = nasalA ? a.nz : b.nz
      nz = NASAL_POLE + (nasalNz - NASAL_POLE) * (0.3 + 0.6 * nasality)
    }
    return {
      t: b.start,
      left: Math.min(left, (a.end - a.start) * 0.45),
      right: Math.min(right, (b.end - b.start) * 0.45),
      fm,
      nz,
    }
  })

  let pi = 0
  for (let k = 0; k < n; k++) {
    const t = k * FRAME
    while (pi < phases.length - 1 && t >= phases[pi]!.end) pi++
    const p = phases[pi]!
    const before = pi > 0 ? bounds[pi - 1]! : null
    const after = pi < bounds.length ? bounds[pi]! : null

    let fm = steady(p, t)
    let nz = p.nz
    if (before && t < p.start + before.right && before.right > 0) {
      const u = smooth((t - p.start) / before.right)
      const target = steady(p, p.start + before.right)
      fm = mixFormants(before.fm, target, u)
      nz = before.nz + (p.nz - before.nz) * u
    } else if (after && t > p.end - after.left && after.left > 0) {
      const u = smooth((t - (p.end - after.left)) / after.left)
      fm = mixFormants(steady(p, p.end - after.left), after.fm, u)
      nz = p.nz + (after.nz - p.nz) * u
    }

    // amplitudes: crossfade 6 ms either side of a boundary
    const amp = (q: Phase, time: number) => {
      let av = q.av
      let ah = q.ah
      if (q.aspiration > 0 && time < q.start + q.aspiration) {
        const u = (time - q.start) / q.aspiration
        av = q.av * Math.max(0, (u - 0.6) / 0.4)
        ah = 0.6 * (1 - u * 0.7)
      }
      // A release is a transient: noise peaks at the release and decays (time constant a third of
      // the burst) into the aspiration, rather than a flat block of frication, which is heard as
      // an affricate ("cat" → "catch"). Affricates (af set on the target) keep their flat frication.
      let af = q.af
      if (q.burst) af *= 1.6 * Math.exp((-3 * (time - q.start)) / Math.max(1e-3, q.end - q.start))
      return { av, ah, af, bypass: q.bypass }
    }
    let a = amp(p, t)
    const XF = 0.006
    if (before && t - p.start < XF) {
      const prev = phases[pi - 1]!
      const u = 0.5 + (t - p.start) / (2 * XF)
      const b = amp(prev, prev.end - 1e-6)
      a = { av: b.av + (a.av - b.av) * u, ah: b.ah + (a.ah - b.ah) * u, af: b.af + (a.af - b.af) * u, bypass: b.bypass + (a.bypass - b.bypass) * u }
    } else if (after && p.end - t < XF) {
      const next = phases[pi + 1]!
      const u = 0.5 - (p.end - t) / (2 * XF)
      const b = amp(next, next.start)
      a = { av: a.av + (b.av - a.av) * u, ah: a.ah + (b.ah - a.ah) * u, af: a.af + (b.af - a.af) * u, bypass: a.bypass + (b.bypass - a.bypass) * u }
    }

    const band = (i: number): FricBand => p.fric[i] ?? [3000, 500, 0]
    const [p1, pb1, pg1] = band(0)
    const [p2, pb2, pg2] = band(1)
    const [p3, pb3, pg3] = band(2)
    const fScale = Math.sqrt(fs) // frication spectra move less than formants with tract length
    frames.push({
      f0: pitchAt(plan.pitch, t),
      av: a.av,
      ah: a.ah,
      af: a.af,
      bypass: a.bypass,
      f1: fm.f1 * fs,
      f2: fm.f2 * fs,
      f3: fm.f3 * fs,
      f4: Math.min(nyq, 3500 * fs),
      f5: Math.min(nyq, 4500 * fs),
      b1: fm.b1 * bs,
      b2: fm.b2 * bs,
      b3: fm.b3 * bs,
      b4: 250 * bs,
      b5: 300 * bs,
      nz: nz * fs,
      p1: Math.min(nyq, p1 * fScale),
      pb1,
      pg1,
      p2: Math.min(nyq, p2 * fScale),
      pb2,
      pg2,
      p3: Math.min(nyq, p3 * fScale),
      pb3,
      pg3,
      // vowels borrow a neighbour's corner so frication cross-fading into them stays shaped
      fhp: (p.fricHp || phases[pi + 1]?.fricHp || phases[pi - 1]?.fricHp || 0) * fScale,
    })
  }
  return frames
}

export const formantBackend: SpeechBackend = {
  id: 'formant',
  name: 'Formant (Klatt-style)',
  description: 'Cascade/parallel formant synthesis from phoneme targets and locus transitions',
  render(plan: SpeechPlan, voice: SpeechVoice, opts: RenderOptions = {}): Float32Array {
    const sampleRate = opts.sampleRate ?? 22050
    const frames = buildFrames(plan, voice, sampleRate)
    const samples = synthesizeFrames(frames, FRAME, sampleRate, voice.source, opts.seed ?? 1, higherPoles(voice.tract.formantScale))
    return samples.subarray(0, Math.ceil(plan.duration * sampleRate))
  },
}
