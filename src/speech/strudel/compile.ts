/**
 * Speech as Strudel code: compile a SpeechPlan into a plain Strudel program that speaks when pasted
 * into the standard REPL (strudel.cc). Nothing is loaded: the voice is built from Strudel's own
 * oscillators, noise and band-pass filters, i.e. a parallel formant synthesiser played as patterns.
 *
 * How it maps:
 * - the formant backend's control frames (5 ms) give f0, F1–F4 with bandwidths, voicing, aspiration
 *   and frication bands; they are averaged into short slices (default 10 ms);
 * - each formant is one layer: a sawtooth at f0 through `bpf("F:Q")` with the gain the cascade
 *   filter would give at that formant (Strudel's sawtooth falls 6 dB/octave, a glottal pulse
 *   12 dB, so the gain also carries a 1/F tilt);
 * - frication is white noise through the formant backend's three parallel bands, aspiration is
 *   noise through F2 and F3;
 * - every layer merges runs of similar slices into one longer event (`value@k`), so steady vowels
 *   cost one event, and leaves silent stretches as rests;
 * - the whole utterance is one cycle (`setcps(1 / seconds)`), so it repeats like any pattern.
 *
 * Strudel sets parameters once per event, so formant movement is stepwise; short attack/release
 * ramps overlap neighbouring events to hide the steps.
 */
import type { SpeechPlan } from '../plan'
import type { SpeechVoice } from '../voice'
import { buildFrames } from '../backends/formant'
import { NASAL_POLE, type SynthFrame } from '../backends/formant/klatt'

export interface StrudelSpeechOptions {
  /** slice length in seconds (default 0.01) */
  step?: number
  /** text shown in the header comment */
  text?: string
  /** silence after the utterance before it repeats, seconds (default 0.6) */
  tail?: number
  /** experimental knobs (defaults are the measured best) */
  tune?: Partial<Tune>
}

export interface Tune {
  /** low-pass on each voiced layer at this multiple of its formant (0 = none) */
  lowpass: number
  /** high-pass on the F2–F4 layers (fixed corners just under each formant's range) */
  highpass: boolean
  /** peak gains of the voiced, aspiration and frication layers */
  voicedGain: number
  aspGain: number
  fricGain: number
  /** extra spectral tilt on the voiced layers: gain × (500/F)^tilt */
  tilt: number
  /** envelope overlap between neighbouring events, seconds */
  attack: number
  release: number
  /** merge tolerances (log ratio) for f0 and formant frequency */
  f0Tol: number
  fTol: number
  /** formant glides with filter envelopes (else steps) */
  glide: boolean
}

const TUNE: Tune = { lowpass: 1.4, voicedGain: 0.8, aspGain: 0.1, fricGain: 0.12, tilt: 0, highpass: true, attack: 0.008, release: 0.012, f0Tol: 0.012, fTol: 0.04, glide: true }


export interface StrudelSpeech {
  code: string
  /** cycle length in seconds (utterance + tail) */
  seconds: number
  /** total events per cycle, a rough cost measure */
  events: number
}

const FRAME = 0.005
/** bandwidths of the formant backend's nasal pole and zero (klatt.ts) */
const NASAL_BW = 100
const NASAL_ZERO_BW = 100

/** |H(f)| of a cascade of 2-pole resonators (Klatt), each normalised to unit gain at DC */
function cascadeGain(f: number, poles: [number, number][]): number {
  let g = 1
  for (const [fc, bw] of poles) {
    // magnitude of a 2-pole resonator normalised at 0 Hz, analogue approximation
    const a = fc * fc + (bw / 2) * (bw / 2)
    const re = a - f * f
    const im = f * bw
    g *= a / Math.sqrt(re * re + im * im)
  }
  return g
}

interface Slice {
  f0: number
  av: number
  ah: number
  af: number
  f: number[]
  b: number[]
  p: number[]
  pb: number[]
  pg: number[]
  /** nasal zero (Hz); equal to NASAL_POLE when the tract is oral */
  nz: number
  np: number
}

function average(frames: SynthFrame[]): Slice {
  const n = frames.length
  const m = (k: (x: SynthFrame) => number) => frames.reduce((s, x) => s + k(x), 0) / n
  // voiced-weighted f0 so a half-voiced slice keeps a sensible pitch
  const wv = frames.reduce((s, x) => s + x.av, 0)
  const f0 = wv > 0 ? frames.reduce((s, x) => s + x.f0 * x.av, 0) / wv : m((x) => x.f0)
  return {
    f0,
    av: m((x) => x.av),
    ah: m((x) => x.ah),
    af: m((x) => x.af),
    f: [m((x) => x.f1), m((x) => x.f2), m((x) => x.f3), m((x) => x.f4)],
    b: [m((x) => x.b1), m((x) => x.b2), m((x) => x.b3), m((x) => x.b4)],
    p: [m((x) => x.p1), m((x) => x.p2), m((x) => x.p3)],
    pb: [m((x) => x.pb1), m((x) => x.pb2), m((x) => x.pb3)],
    pg: [m((x) => x.pg1), m((x) => x.pg2), m((x) => x.pg3)],
    nz: m((x) => x.nz),
    np: m((x) => x.np ?? NASAL_POLE),
  }
}

interface Ev {
  on: boolean
  /** [freq Hz (osc), filter Hz, Q, gain] */
  v: [number, number, number, number]
}

/** one layer's events → mini-notation strings sharing the same @-structure */
function layer(evs: Ev[], tol: (a: Ev['v'], b: Ev['v']) => boolean): { freq: string; bpf: string; gain: string; count: number } {
  const groups: { on: boolean; v: Ev['v']; n: number }[] = []
  for (const e of evs) {
    const g = groups[groups.length - 1]
    if (g && g.on === e.on && (!e.on || tol(g.v, e.v))) {
      g.n++
      continue
    }
    groups.push({ on: e.on, v: [...e.v] as Ev['v'], n: 1 })
  }
  const w = (s: string, n: number) => (n > 1 ? `${s}@${n}` : s)
  const freq: string[] = []
  const bpf: string[] = []
  const gain: string[] = []
  let count = 0
  for (const g of groups) {
    if (!g.on) {
      freq.push(w('~', g.n))
      bpf.push(w('~', g.n))
      gain.push(w('~', g.n))
      continue
    }
    count++
    freq.push(w(String(Math.round(g.v[0])), g.n))
    bpf.push(w(`${Math.round(g.v[1])}:${g.v[2].toFixed(1)}`, g.n))
    gain.push(w(g.v[3].toFixed(3), g.n))
  }
  return { freq: freq.join(' '), bpf: bpf.join(' '), gain: gain.join(' '), count }
}

/**
 * One layer as gliding events: each event's band-pass moves from its start value to the next
 * event's start value with Strudel's filter envelope (`bpf("F:Q:octaves")` + `bpattack`, sustain 1),
 * so formant tracks are piecewise exponential instead of steps. An event is extended while a
 * straight (log-frequency) glide stays within `fTol` of every slice and f0 and gain stay close.
 */
function glideLayer(evs: Ev[], step: number, T: Tune, maxLen = 0.25): { freq: string; bpf: string; att: string; gain: string; count: number } {
  const n = evs.length
  const out = { freq: [] as string[], bpf: [] as string[], att: [] as string[], gain: [] as string[], count: 0 }
  const w = (x: string, k: number) => (k > 1 ? `${x}@${k}` : x)
  const lf = (i: number) => Math.log(evs[i]!.v[1])
  let i = 0
  while (i < n) {
    if (!evs[i]!.on) {
      let j = i
      while (j < n && !evs[j]!.on) j++
      for (const a of [out.freq, out.bpf, out.att, out.gain]) a.push(w('~', j - i))
      i = j
      continue
    }
    let j = i + 1
    const fits = (end: number) => {
      // glide from slice i to slice `end` (inclusive) must pass near every slice in between
      const a = lf(i)
      const b = lf(end)
      let f0lo = Infinity
      let f0hi = 0
      let glo = Infinity
      let ghi = 0
      for (let m = i; m <= end; m++) {
        const v = evs[m]!.v
        const at = a + ((b - a) * (m - i)) / Math.max(1, end - i)
        if (Math.abs(Math.log(v[1]) - at) > T.fTol) return false
        f0lo = Math.min(f0lo, v[0])
        f0hi = Math.max(f0hi, v[0])
        glo = Math.min(glo, v[3])
        ghi = Math.max(ghi, v[3])
      }
      return Math.log(f0hi / f0lo) < 2 * T.f0Tol && Math.log((ghi + 1e-6) / (glo + 1e-6)) < 0.5
    }
    while (j < n && evs[j]!.on && (j - i + 1) * step <= maxLen && fits(j)) j++
    // event covers slices i..j-1 and glides towards slice j (the next event's start) when voiced on
    const endIdx = j < n && evs[j]!.on ? j : j - 1
    const seg = evs.slice(i, j)
    const f0 = seg.reduce((s2, e) => s2 + e.v[0], 0) / seg.length
    const g = seg.reduce((s2, e) => s2 + e.v[3], 0) / seg.length
    const q = seg.reduce((s2, e) => s2 + e.v[2], 0) / seg.length
    const fa = evs[i]!.v[1]
    const fb = evs[endIdx]!.v[1]
    const oct = Math.log2(fb / fa)
    const base = oct >= 0 ? fa : fb
    // Strudel's envelope runs from F to F·2^|env|, reversed when env < 0, so the base is the lower end
    // an event with no env value would get Strudel's default of +1 octave, so always write one
    const env = `:${Math.abs(oct) < 0.001 ? '0.001' : oct.toFixed(3)}`
    out.freq.push(w(String(Math.round(f0)), j - i))
    out.bpf.push(w(`${Math.round(base)}:${q.toFixed(1)}${env}`, j - i))
    out.att.push(w(((j - i) * step).toFixed(3), j - i))
    out.gain.push(w(g.toFixed(3), j - i))
    out.count++
    i = j
  }
  return { freq: out.freq.join(' '), bpf: out.bpf.join(' '), att: out.att.join(' '), gain: out.gain.join(' '), count: out.count }
}

const near = (a: number, b: number, r: number) => Math.abs(Math.log(a / b)) < r

export function compileStrudelSpeech(plan: SpeechPlan, voice: SpeechVoice, opts: StrudelSpeechOptions = {}): StrudelSpeech {
  const T: Tune = { ...TUNE, ...opts.tune }
  const step = opts.step ?? 0.01
  const tail = opts.tail ?? 0.6
  const frames = buildFrames(plan, voice, 22050)
  const per = Math.max(1, Math.round(step / FRAME))
  const slices: Slice[] = []
  for (let i = 0; i < frames.length; i += per) slices.push(average(frames.slice(i, i + per)))
  const realStep = per * FRAME
  const seconds = slices.length * realStep + tail
  const pad = Math.round(tail / realStep)

  // voiced formant layers
  const voiced: Ev[][] = [[], [], [], []]
  const nasalLayer: Ev[] = []
  const asp: Ev[][] = [[], []]
  const fric: Ev[][] = [[], [], []]
  for (const s of slices) {
    const poles = s.f.map((f, k) => [f, s.b[k]!] as [number, number])
    // nasal pole/zero pair of the cascade (they cancel when the velum is closed)
    const nasal = Math.abs(s.nz - s.np) > 15
    const nasalGain = (f: number) => (nasal ? cascadeGain(f, [[s.np, NASAL_BW]]) / cascadeGain(f, [[s.nz, NASAL_ZERO_BW]]) : 1)
    const gainAt = (f: number) => cascadeGain(f, poles) * nasalGain(f)
    for (let k = 0; k < 4; k++) {
      const F = s.f[k]!
      const q = Math.min(30, Math.max(2, F / s.b[k]!))
      // cascade gain at the formant × (f0/F) tilt correction; normalised later
      // the sawtooth already falls 6 dB/octave, the net slope of glottal source + lip radiation
      const g = s.av * gainAt(F) * Math.pow(500 / F, T.tilt)
      voiced[k]!.push({ on: s.av > 0.02, v: [s.f0, F, q, g] })
    }
    // the nasal murmur: an extra low resonance only while the velum is open
    nasalLayer.push({ on: nasal && s.av > 0.02, v: [s.f0, s.np, s.np / NASAL_BW, s.av * gainAt(s.np)] })
    for (let k = 0; k < 2; k++) {
      const F = s.f[k + 1]!
      const g = s.ah * cascadeGain(F, poles) * 0.02
      asp[k]!.push({ on: s.ah > 0.02, v: [0, F, Math.max(2, F / s.b[k + 1]! / 2), g] })
    }
    for (let k = 0; k < 3; k++) {
      const g = s.af * s.pg[k]!
      fric[k]!.push({ on: s.af > 0.02 && s.pg[k]! > 0.01, v: [0, s.p[k]!, Math.max(1.5, s.p[k]! / s.pb[k]!), g] })
    }
  }
  // normalise voiced gains so the loudest formant layer peaks at 0.8
  const vmax = Math.max(1e-9, ...voiced.flat().filter((e) => e.on).map((e) => e.v[3]))
  for (const e of [...voiced.flat(), ...nasalLayer]) e.v[3] = (T.voicedGain * e.v[3]) / vmax
  const amax = Math.max(1e-9, ...asp.flat().filter((e) => e.on).map((e) => e.v[3]))
  for (const e of asp.flat()) e.v[3] = (T.aspGain * e.v[3]) / amax
  const fmax = Math.max(1e-9, ...fric.flat().filter((e) => e.on).map((e) => e.v[3]))
  for (const e of fric.flat()) e.v[3] = (T.fricGain * e.v[3]) / fmax
  for (const l of [...voiced, nasalLayer, ...asp, ...fric]) for (let i = 0; i < pad; i++) l.push({ on: false, v: [0, 0, 0, 0] })

  const vt = (a: Ev['v'], b: Ev['v']) => near(a[0], b[0], T.f0Tol) && near(a[1], b[1], T.fTol) && Math.abs(Math.log(a[3] / b[3])) < 0.25
  const nt = (a: Ev['v'], b: Ev['v']) => near(a[1], b[1], 0.06) && Math.abs(Math.log(a[3] / b[3])) < 0.3
  const lines: string[] = []
  let events = 0
  const env = `.attack(${T.attack}).decay(0).sustain(1).release(${T.release})`
  voiced.forEach((l, k) => {
    const lp = T.lowpass > 0 ? `.lpf(${Math.round(Math.min(9000, T.lowpass * [700, 1800, 2800, 3600][k]!))})` : ''
    const hp = T.highpass && k > 0 ? `.hpf(${[0, 750, 1500, 2500][k]})` : ''
    if (T.glide) {
      const x = glideLayer(l, realStep, T)
      events += x.count
      lines.push(`  // F${k + 1}\n  freq("${x.freq}").s("sawtooth")\n    .bpf("${x.bpf}").bpattack("${x.att}").bpdecay(0).bpsustain(1).bprelease(10)${lp}${hp}\n    .gain("${x.gain}")${env}`)
      return
    }
    const x = layer(l, vt)
    events += x.count
        lines.push(`  // F${k + 1}\n  freq("${x.freq}").s("sawtooth").bpf("${x.bpf}")${lp}${hp}.gain("${x.gain}")${env}`)
  })
  if (nasalLayer.some((e) => e.on)) {
    const x = layer(nasalLayer, vt)
    events += x.count
    lines.push(`  // nasal murmur\n  freq("${x.freq}").s("sawtooth").bpf("${x.bpf}").lpf(800).gain("${x.gain}")${env}`)
  }
  asp.forEach((l, k) => {
    const x = layer(l, nt)
    if (!x.count) return
    events += x.count
    lines.push(`  // aspiration through F${k + 2}\n  s("${x.freq.replace(/\b0\b/g, 'white')}").bpf("${x.bpf}").gain("${x.gain}")${env}`)
  })
  fric.forEach((l, k) => {
    const x = layer(l, nt)
    if (!x.count) return
    events += x.count
    lines.push(`  // frication band ${k + 1}\n  s("${x.freq.replace(/\b0\b/g, 'white')}").bpf("${x.bpf}").gain("${x.gain}")${env}`)
  })
  const header = [
    `// "${(opts.text ?? '').replace(/\s+/g, ' ').trim()}" — spoken by Strudel itself: oscillators, noise and formant filters`,
    `// Continuous-Tunes speech (voice ${voice.id}), ${slices.length} slices of ${Math.round(realStep * 1000)} ms, ${events} events per cycle`,
    `setcps(${(1 / seconds).toFixed(4)})`,
  ]
  const code = `${header.join('\n')}\nstack(\n${lines.join(',\n')}\n)\n`
  return { code, seconds, events }
}
