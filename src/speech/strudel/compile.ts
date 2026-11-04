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
  /** fixed gain references for voiced, aspiration and frication (else each utterance's maxima) */
  scale: [number, number, number] | null
  /** attack of the noise layers, seconds */
  noiseAttack: number
  /** glottal-rate modulation of frication in voiced fricatives (Strudel tremolo at f0) */
  fricMod: boolean
  /** include Klatt's bypass path (flat frication) */
  bypass: boolean
  /** voiced events hold whole pitch periods so consecutive events start in phase */
  align: boolean
  /** largest gain spread (log ratio) inside one event */
  gainTol: number
}

const TUNE: Tune = { lowpass: 1.4, voicedGain: 0.8, aspGain: 0.07, fricGain: 0.075, tilt: 0, highpass: true, attack: 0.003, release: 0.005, f0Tol: 0.012, fTol: 0.06, glide: true, align: false, gainTol: 1.0, noiseAttack: 0.002, bypass: true, fricMod: true, scale: [13.3, 0.04, 1] }


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
  bypass: number
  fhp: number
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
    bypass: m((x) => x.bypass),
    fhp: m((x) => x.fhp ?? 0),
  }
}

export interface Ev {
  on: boolean
  /** [freq Hz (osc), filter Hz, Q, gain] */
  v: [number, number, number, number]
  /** noise layers: depth of the glottal-rate amplitude modulation (voiced fricatives), at v[0] Hz */
  d?: number
}

/** one layer's events → mini-notation strings sharing the same @-structure */
function layer(evs: Ev[], tol: (a: Ev['v'], b: Ev['v']) => boolean, noise = false) {
  const groups: { on: boolean; v: Ev['v']; d: number; n: number }[] = []
  for (const e of evs) {
    const g = groups[groups.length - 1]
    const d = e.d ?? 0
    if (g && g.on === e.on && (!e.on || (tol(g.v, e.v) && Math.abs(g.d - d) < 0.1 && near(g.v[0] || 1, e.v[0] || 1, 0.05)))) {
      g.n++
      continue
    }
    groups.push({ on: e.on, v: [...e.v] as Ev['v'], d, n: 1 })
  }
  const w = (s: string, n: number) => (n > 1 ? `${s}@${n}` : s)
  const freq: string[] = []
  const bpf: string[] = []
  const gain: string[] = []
  const trem: string[] = []
  const depth: string[] = []
  let count = 0
  let modulated = false
  for (const g of groups) {
    if (!g.on) {
      for (const a of [freq, bpf, gain, trem, depth]) a.push(w('~', g.n))
      continue
    }
    count++
    freq.push(w(noise ? 'white' : String(Math.round(g.v[0])), g.n))
    bpf.push(w(`${Math.round(g.v[1])}:${g.v[2].toFixed(1)}`, g.n))
    gain.push(w(g.v[3].toFixed(3), g.n))
    // tremolo at the voice's f0 with this depth (0 = steady noise)
    trem.push(w(g.d > 0 ? String(Math.round(g.v[0])) : '0', g.n))
    depth.push(w(g.d.toFixed(2), g.n))
    if (g.d > 0) modulated = true
  }
  return { freq: freq.join(' '), bpf: bpf.join(' '), gain: gain.join(' '), trem: modulated ? `.tremolo("${trem.join(' ')}").tremolodepth("${depth.join(' ')}")` : '', count }
}

/**
 * Gliding events for the voiced layers. Every event's band-pass moves from its start value to the
 * next event's start value with Strudel's filter envelope (`bpf("F:Q:octaves")` + `bpattack`,
 * sustain 1), and its pitch the same way with the pitch envelope (`penv` + `pattack`), so formant
 * and pitch tracks are piecewise exponential instead of steps.
 *
 * All voiced layers share one segmentation: an event is extended while straight glides stay within
 * tolerance for every layer. Shared boundaries mean the layers' sawtooths restart together, in
 * phase, so their sum behaves like one source through a bank of parallel formant filters instead
 * of several unrelated buzzes.
 */
function glideBounds(layers: Ev[][], step: number, T: Tune, maxLen = 0.25): [number, number, boolean][] {
  const n = layers[0]!.length
  const on = (i: number) => layers[0]![i]!.on
  const fitsLayer = (evs: Ev[], i: number, end: number) => {
    const a = Math.log(evs[i]!.v[1])
    const b = Math.log(evs[end]!.v[1])
    const pa = Math.log(evs[i]!.v[0])
    const pb = Math.log(evs[end]!.v[0])
    let glo = Infinity
    let ghi = 0
    for (let m = i; m <= end; m++) {
      const v = evs[m]!.v
      const u = (m - i) / Math.max(1, end - i)
      if (Math.abs(Math.log(v[1]) - (a + (b - a) * u)) > T.fTol) return false
      if (Math.abs(Math.log(v[0]) - (pa + (pb - pa) * u)) > T.f0Tol) return false
      glo = Math.min(glo, v[3])
      ghi = Math.max(ghi, v[3])
    }
    return Math.log((ghi + 1e-6) / (glo + 1e-6)) < T.gainTol
  }
  const out: [number, number, boolean][] = []
  let i = 0
  while (i < n) {
    let j = i + 1
    if (!on(i)) {
      while (j < n && !on(j)) j++
    } else {
      while (j < n && on(j) && (j - i + 1) * step <= maxLen && layers.every((l) => fitsLayer(l, i, j))) j++
    }
    out.push([i, j, on(i)])
    i = j
  }
  return out
}

const w = (x: string, k: number) => (Math.abs(k - 1) < 1e-9 ? x : `${x}@${+k.toFixed(2)}`)

/**
 * Event lengths (in slices, fractional) for a segmentation. When `align` is set, a voiced event
 * that runs into another one is stretched or shrunk by under half a pitch period so it holds a
 * whole number of glottal cycles. Strudel starts every event's oscillator at phase 0, so the next
 * event then starts in phase with the one fading out instead of beating against it.
 */
function eventWeights(evs: Ev[], bounds: [number, number, boolean][], step: number, align: boolean): number[] {
  const out: number[] = []
  let pos = 0
  bounds.forEach(([i, j, on], k) => {
    let end = j
    const next = bounds[k + 1]
    if (on && align && next && next[2]) {
      const p0 = Math.round(evs[i]!.v[0])
      const semis = +(12 * Math.log2(evs[j]!.v[0] / evs[i]!.v[0])).toFixed(2)
      const r = Math.pow(2, semis / 12)
      // cycles in a pitch glide (linear in cents) from p0 to p0·r over D seconds: p0·D·(r−1)/ln r
      const g = Math.abs(r - 1) < 1e-9 ? 1 : (r - 1) / Math.log(r)
      const nominal = (j - pos) * step
      const cycles = Math.max(1, Math.round(nominal * p0 * g))
      end = pos + cycles / (p0 * g) / step
      // never past the next event's own end
      end = Math.min(end, next[1] - 0.5)
    }
    end = Math.round(end * 100) / 100
    out.push(Math.round((end - pos) * 100) / 100)
    pos = end
  })
  return out
}

/** the shared timing and pitch strings for a segmentation */
function glideTiming(evs: Ev[], bounds: [number, number, boolean][], step: number, weights: number[]) {
  const freq: string[] = []
  const penv: string[] = []
  const att: string[] = []
  bounds.forEach(([i, j, on], k) => {
    const wt = weights[k]!
    if (!on) {
      for (const a of [freq, penv, att]) a.push(w('~', wt))
      return
    }
    const end = j < evs.length && evs[j]!.on ? j : j - 1
    // start at the first slice's pitch and glide (linear in cents) to the next event's start
    const p0 = evs[i]!.v[0]
    freq.push(w(String(Math.round(p0)), wt))
    penv.push(w((12 * Math.log2(evs[end]!.v[0] / p0)).toFixed(2), wt))
    att.push(w((wt * step).toFixed(4), wt))
  })
  return { freq: freq.join(' '), penv: penv.join(' '), att: att.join(' ') }
}

/**
 * A band-pass gliding from `from` Hz to `to` Hz over the event, as Strudel's `bpf("F:Q:env")`.
 * Strudel's filter envelope runs from F to F·2^|env| and is reversed when env < 0, so F is always
 * the lower end and the sign of env carries the direction (a downward glide is `to:Q:-octaves`).
 * An event without an env value would get Strudel's default of +1 octave, so one is always written.
 */
export function bpfGlide(from: number, to: number, q: number): string {
  const oct = Math.log2(to / from)
  const base = oct >= 0 ? from : to
  return `${Math.round(base)}:${q.toFixed(1)}:${Math.abs(oct) < 0.001 ? '0.001' : oct.toFixed(3)}`
}

/** one voiced layer's filter and gain strings for a segmentation */
function glideFilter(evs: Ev[], bounds: [number, number, boolean][], weights: number[]) {
  const bpf: string[] = []
  const gain: string[] = []
  for (const [k, [i, j, on]] of bounds.entries()) {
    const wt = weights[k]!
    if (!on) {
      bpf.push(w('~', wt))
      gain.push(w('~', wt))
      continue
    }
    const end = j < evs.length && evs[j]!.on ? j : j - 1
    const seg = evs.slice(i, j)
    const g = seg.reduce((s2, e) => s2 + e.v[3], 0) / seg.length
    const q = seg.reduce((s2, e) => s2 + e.v[2], 0) / seg.length
    bpf.push(w(bpfGlide(evs[i]!.v[1], evs[end]!.v[1], q), wt))
    gain.push(w(g.toFixed(3), wt))
  }
  return { bpf: bpf.join(' '), gain: gain.join(' ') }
}

const near = (a: number, b: number, r: number) => Math.abs(Math.log(a / b)) < r

/** The synthesiser's layers (10 ms slices, gains on the output scale), before they are written as code. */
export function buildStrudelLayers(plan: SpeechPlan, voice: SpeechVoice, opts: StrudelSpeechOptions = {}) {
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
  const bypass: Ev[] = []
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
      asp[k]!.push({ on: s.ah > 0.02, v: [s.f0, F, Math.max(2, F / s.b[k + 1]! / 2), g] })
    }
    // Klatt 1980: in voiced fricatives the turbulence pulses with the glottal cycle (the engine
    // halves the noise while the glottis is closed); Strudel's tremolo at f0 does the same
    const voicedMod = T.fricMod && s.av > 0.05 ? Math.min(0.5, s.av) : 0
    for (let k = 0; k < 3; k++) {
      const g = s.af * s.pg[k]!
      fric[k]!.push({ on: s.af > 0.02 && s.pg[k]! > 0.01, v: [s.f0, s.p[k]!, Math.max(1.5, s.p[k]! / s.pb[k]!), g], d: voicedMod })
    }
    // Klatt's bypass path: flat frication noise above the front-cavity cut-off (bursts, /f θ h/)
    bypass.push({ on: s.af > 0.02 && s.bypass > 0.01, v: [s.f0, Math.max(300, s.fhp), 0.7, s.af * s.bypass], d: voicedMod })
  }
  // gains on a fixed scale (not per utterance), so a weak /f/ stays weaker than an /s/ elsewhere
  const vmax = T.scale ? T.scale[0] : Math.max(1e-9, ...voiced.flat().filter((e) => e.on).map((e) => e.v[3]))
  for (const e of [...voiced.flat(), ...nasalLayer]) e.v[3] = (T.voicedGain * e.v[3]) / vmax
  const amax = T.scale ? T.scale[1] : Math.max(1e-9, ...asp.flat().filter((e) => e.on).map((e) => e.v[3]))
  for (const e of asp.flat()) e.v[3] = (T.aspGain * e.v[3]) / amax
  const fmax = T.scale ? T.scale[2] : Math.max(1e-9, ...[...fric.flat(), ...bypass].filter((e) => e.on).map((e) => e.v[3]))
  for (const e of [...fric.flat(), ...bypass]) e.v[3] = (T.fricGain * e.v[3]) / fmax
  // inaudible noise or murmur events cost voices and code: drop them
  for (const e of [...nasalLayer, ...asp.flat(), ...fric.flat(), ...bypass]) if (e.v[3] < 5e-4) e.on = false
  for (const l of [...voiced, nasalLayer, ...asp, ...fric, bypass]) for (let i = 0; i < pad; i++) l.push({ on: false, v: [0, 0, 0, 0] })

  return { T, voiced, nasalLayer, asp, fric, bypass, realStep, seconds, slices }
}

export function compileStrudelSpeech(plan: SpeechPlan, voice: SpeechVoice, opts: StrudelSpeechOptions = {}): StrudelSpeech {
  const { T, voiced, nasalLayer, asp, fric, bypass, realStep, seconds, slices } = buildStrudelLayers(plan, voice, opts)
  const vt = (a: Ev['v'], b: Ev['v']) => near(a[0], b[0], T.f0Tol) && near(a[1], b[1], T.fTol) && Math.abs(Math.log(a[3] / b[3])) < 0.25
  const nt = (a: Ev['v'], b: Ev['v']) => near(a[1], b[1], 0.06) && Math.abs(Math.log(a[3] / b[3])) < 0.3
  const lines: string[] = []
  let events = 0
  const env = `.attack(${T.attack}).decay(0).sustain(1).release(${T.release})`
  // noise starts sharply so stop bursts keep their transient
  const envN = `.attack(${T.noiseAttack}).decay(0).sustain(1).release(${T.release})`
  const preamble: string[] = []
  if (T.glide) {
    const bounds = glideBounds(voiced, realStep, T)
    const weights = eventWeights(voiced[0]!, bounds, realStep, T.align)
    const t = glideTiming(voiced[0]!, bounds, realStep, weights)
    events += 4 * bounds.filter((b) => b[2]).length
    preamble.push(`const f0 = "${t.freq}"`, `const glide = "${t.penv}"`, `const len = "${t.att}"`)
    // one sawtooth per formant, all restarting together; pitch and filter glide over each event
    preamble.push('const tract = (f, g) => freq(f0).s("sawtooth").penv(glide).pattack(len).panchor(0).psustain(1).prelease(10)\n  .bpf(f).bpattack(len).bpdecay(0).bpsustain(1).bprelease(10).gain(g)' + env)
    voiced.forEach((l, k) => {
      const x = glideFilter(l, bounds, weights)
      const lp = T.lowpass > 0 ? `.lpf(${Math.round(Math.min(9000, T.lowpass * [700, 1800, 2800, 3600][k]!))})` : ''
      const hp = T.highpass && k > 0 ? `.hpf(${[0, 750, 1500, 2500][k]})` : ''
      lines.push(`  // F${k + 1}\n  tract("${x.bpf}", "${x.gain}")${lp}${hp}`)
    })
  } else
    voiced.forEach((l, k) => {
      const x = layer(l, vt)
      events += x.count
      const lp = T.lowpass > 0 ? `.lpf(${Math.round(Math.min(9000, T.lowpass * [700, 1800, 2800, 3600][k]!))})` : ''
      const hp = T.highpass && k > 0 ? `.hpf(${[0, 750, 1500, 2500][k]})` : ''
      lines.push(`  // F${k + 1}\n  freq("${x.freq}").s("sawtooth").bpf("${x.bpf}")${lp}${hp}.gain("${x.gain}")${env}`)
    })
  if (nasalLayer.some((e) => e.on)) {
    const x = layer(nasalLayer, vt)
    events += x.count
    lines.push(`  // nasal murmur\n  freq("${x.freq}").s("sawtooth").bpf("${x.bpf}").lpf(800).gain("${x.gain}")${env}`)
  }
  asp.forEach((l, k) => {
    const x = layer(l, nt, true)
    if (!x.count) return
    events += x.count
    lines.push(`  // aspiration through F${k + 2}\n  s("${x.freq}").bpf("${x.bpf}").gain("${x.gain}")${envN}`)
  })
  fric.forEach((l, k) => {
    const x = layer(l, nt, true)
    if (!x.count) return
    events += x.count
    const tr = x.trem
    lines.push(`  // frication band ${k + 1}\n  s("${x.freq}").bpf("${x.bpf}")${tr}.gain("${x.gain}")${envN}`)
  })
  if (T.bypass && bypass.some((e) => e.on)) {
    const x = layer(bypass, nt, true)
    events += x.count
    const tr = x.trem
    lines.push(`  // frication bypass (flat, above the front-cavity cut-off)\n  s("${x.freq}").hpf("${x.bpf}")${tr}.gain("${x.gain}")${envN}`)
  }
  const header = [
    `// "${(opts.text ?? '').replace(/\s+/g, ' ').trim()}" — spoken by Strudel itself: oscillators, noise and formant filters`,
    `// Continuous-Tunes speech (voice ${voice.id}), ${slices.length} slices of ${Math.round(realStep * 1000)} ms, ${events} events per cycle`,
    `setcps(${(1 / seconds).toFixed(4)})`,
  ]
  const code = `${[...header, ...preamble].join('\n')}\nstack(\n${lines.join(',\n')}\n)\n`
  return { code, seconds, events }
}
