/**
 * Speech as a Strudel instrument: compile a SpeechPlan into a Strudel program that defines its own
 * voice sound (an AudioWorklet, see processor.ts) and plays the utterance through it.
 *
 * Unlike the pattern compiler (../compile.ts), which rebuilds the voice from many short oscillator
 * events and restarts them every few tens of milliseconds, this instrument is one continuous
 * sound per utterance: the glottal source keeps its phase and the tract filters keep their state,
 * while the articulation changes smoothly underneath. TypeScript only plans (phones, timing,
 * pitch, articulatory/acoustic targets); every sample is generated inside Strudel's audio graph.
 */
import type { SpeechPlan } from '../../plan'
import type { SpeechVoice } from '../../voice'
import { buildFrames } from '../../backends/formant'
import type { SynthFrame } from '../../backends/formant/klatt'
import { voiceProcessorModule } from './processor'
import { tractProcessorModule } from './tract-processor'
import { buildArticulation, type ArticFrame } from './articulation'
import { applyExpression, DEFAULT_EXPRESSION, type ExpressionSettings } from './expression'

const FRAME = 0.005

/** the order and integer scale must match decodeTrack() in processor.ts */
export const TRACK_KEYS = ['f0', 'av', 'ah', 'af', 'bp', 'rd', 'f1', 'f2', 'f3', 'f4', 'f5', 'b1', 'b2', 'b3', 'b4', 'b5', 'nz', 'p1', 'w1', 'g1', 'p2', 'w2', 'g2', 'p3', 'w3', 'g3', 'hp'] as const
type Key = (typeof TRACK_KEYS)[number]
const SCALE: Partial<Record<Key, number>> = { f0: 10, av: 1000, ah: 1000, af: 1000, bp: 1000, rd: 100, g1: 1000, g2: 1000, g3: 1000 }
/** how far a straight line between breakpoints may stray from the frames, in the parameter's units */
const TOL: Record<Key, (v: number) => number> = {
  f0: () => 0.6,
  av: () => 0.012,
  ah: () => 0.012,
  af: () => 0.012,
  bp: () => 0.012,
  rd: () => 0.02,
  f1: (v) => 0.012 * v,
  f2: (v) => 0.012 * v,
  f3: (v) => 0.012 * v,
  f4: (v) => 0.012 * v,
  f5: (v) => 0.012 * v,
  b1: (v) => 0.06 * v,
  b2: (v) => 0.06 * v,
  b3: (v) => 0.06 * v,
  b4: (v) => 0.06 * v,
  b5: (v) => 0.06 * v,
  nz: (v) => 0.012 * v,
  p1: (v) => 0.02 * v,
  w1: (v) => 0.06 * v,
  g1: () => 0.012,
  p2: (v) => 0.02 * v,
  w2: (v) => 0.06 * v,
  g2: () => 0.012,
  p3: (v) => 0.02 * v,
  w3: (v) => 0.06 * v,
  g3: () => 0.012,
  hp: () => 0.5,
}

export interface StrudelVoiceOptions {
  text?: string
  /** 'formant': Klatt-style resonators driven by formant tracks (V1); 'tract': a Kelly-Lochbaum
   *  waveguide driven by articulation (V2) */
  engine?: 'formant' | 'tract'
  /** voice quality, loudness and micro-pitch from stress and phrasing (expression.ts); off by default
   *  until the listening test decides, pass {} for the defaults */
  expression?: Partial<ExpressionSettings>
  /** silence after the utterance before the pattern repeats, seconds (default 0.6) */
  tail?: number
  /** output level inside Strudel, before Strudel's own gain (default 6) */
  gain?: number
  seed?: number
}

export interface StrudelVoice {
  code: string
  seconds: number
  /** length of the encoded control track, characters */
  trackChars: number
}

const value = (fr: SynthFrame, k: Key, rd: number): number => {
  switch (k) {
    case 'bp':
      return fr.bypass
    case 'rd':
      return fr.rd ?? rd
    case 'nz':
      return fr.nz
    case 'p1':
    case 'p2':
    case 'p3':
      return fr[k]
    case 'w1':
      return fr.pb1
    case 'w2':
      return fr.pb2
    case 'w3':
      return fr.pb3
    case 'g1':
      return fr.pg1
    case 'g2':
      return fr.pg2
    case 'g3':
      return fr.pg3
    case 'hp':
      return fr.fhp ?? 0
    default:
      return fr[k]
  }
}

/** Greedy piecewise-linear fit: breakpoint indices such that every frame lies within tol of the line. */
export function breakpoints(v: ArrayLike<number>, tol: (x: number) => number): number[] {
  const out = [0]
  let a = 0
  while (a < v.length - 1) {
    let b = a + 1
    for (let c = a + 2; c < v.length; c++) {
      let ok = true
      for (let m = a + 1; m < c; m++) {
        const lin = v[a]! + ((v[c]! - v[a]!) * (m - a)) / (c - a)
        if (Math.abs(lin - v[m]!) > tol(Math.abs(v[m]!))) {
          ok = false
          break
        }
      }
      if (!ok) break
      b = c
    }
    out.push(b)
    a = b
  }
  return out
}

/** One parameter as breakpoints "v" or "d:v" (d frames after the previous breakpoint), integers. */
function encodeLine(raw: readonly number[], sc: number, tol: (x: number) => number): string {
  const v = raw.map((x) => Math.round(x * sc) / sc)
  const bp = breakpoints(v, tol)
  return bp.map((i, j) => (j === 0 || i - bp[j - 1]! === 1 ? `${Math.round(v[i]! * sc)}` : `${i - bp[j - 1]!}:${Math.round(v[i]! * sc)}`)).join(' ')
}

/** Encode formant frames as the formant processor's track string. */
export function encodeTrack(frames: readonly SynthFrame[], rd: number): string {
  return TRACK_KEYS.map((k) => encodeLine(frames.map((f) => value(f, k, rd)), SCALE[k] ?? 1, TOL[k])).join('|')
}

/** order and integer scale must match tract-processor.ts */
export const ARTIC_KEYS = ['f0', 'av', 'ah', 'rd', 'q1', 'q2', 'q3', 'ql', 'i1', 'd1', 'a1', 'w1', 'i2', 'd2', 'a2', 'w2', 'i3', 'd3', 'a3', 'w3', 'lt', 'la', 've', 'ti', 'td', 'tn'] as const
const ARTIC_SCALE: Record<string, number> = { f0: 10, av: 1000, ah: 1000, rd: 100, q1: 1000, q2: 1000, q3: 1000, ql: 1000, i1: 10, d1: 100, a1: 1000, w1: 100, i2: 10, d2: 100, a2: 1000, w2: 100, i3: 10, d3: 100, a3: 1000, w3: 100, lt: 100, la: 1000, ve: 1000, ti: 10, td: 100, tn: 1000 }
const ARTIC_TOL: Record<string, (v: number) => number> = { f0: () => 0.6, q1: () => 0.01, q2: () => 0.01, q3: () => 0.01, ql: () => 0.01, i1: () => 0.05, i2: () => 0.05, i3: () => 0.05, ti: () => 0.05, d1: () => 0.01, d2: () => 0.01, d3: () => 0.01, td: () => 0.01, lt: () => 0.01, ve: () => 0.004 }

/** Encode articulation frames as the tract processor's track string. */
export function encodeArticulation(frames: readonly ArticFrame[]): string {
  return ARTIC_KEYS.map((k) => encodeLine(frames.map((f) => f[k]), ARTIC_SCALE[k] ?? 1, ARTIC_TOL[k] ?? (() => 0.012))).join('|')
}

/** single-quoted JS string literal (Strudel reads double quotes and backticks as mini-notation) */
const sq = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`

/** a short stable hash, so a changed instrument registers under a new worklet name */
function hash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/** The instrument's worklet source, as loaded by the program. */
export function processorSource(name: string, engine: 'formant' | 'tract' = 'formant'): string {
  const mod = engine === 'tract' ? tractProcessorModule : voiceProcessorModule
  // __name: esbuild's keepNames helper (tsx, dev builds) is referenced from inside the function
  return `var __name = (f) => f;\n(${mod.toString()})('${name}')`.replace(/[^\t\n\x20-\x7e]/g, '?')
}

/** The instrument's processor options for a plan: the encoded control track and its settings. */
export function strudelVoiceOptions(plan: SpeechPlan, voice: SpeechVoice, opts: StrudelVoiceOptions = {}): { engine: 'formant' | 'tract'; track: string; settings: Record<string, number> } {
  const engine = opts.engine ?? 'formant'
  let track: string
  if (engine === 'tract') track = encodeArticulation(buildArticulation(plan, voice))
  else {
    const frames = buildFrames(plan, voice, 48000)
    if (opts.expression) applyExpression(frames, plan, voice.source.rd, FRAME, { ...DEFAULT_EXPRESSION, ...opts.expression })
    track = encodeTrack(frames, voice.source.rd)
  }
  const common = {
    frameSeconds: FRAME,
    rd: voice.source.rd,
    jitter: voice.source.jitter,
    shimmer: voice.source.shimmer,
    breath: voice.source.breathiness,
    flutter: voice.source.flutter,
    seed: opts.seed ?? 1,
  }
  const settings =
    engine === 'tract'
      ? { ...common, gain: opts.gain ?? 0.15, tractRate: 88200 * voice.tract.formantScale, burst: 0.3 * voice.articulation.consonantStrength, wall: 0, fricLp: 0.35 }
      : { ...common, tilt: 0.6 * Math.min(1, Math.max(0, voice.source.spectralTilt)), gain: opts.gain ?? 6, scale: voice.tract.formantScale }
  return { engine, track, settings }
}

export function compileStrudelVoice(plan: SpeechPlan, voice: SpeechVoice, opts: StrudelVoiceOptions = {}): StrudelVoice {
  const tail = opts.tail ?? 0.6
  const seconds = plan.duration + tail
  const { engine, track, settings } = strudelVoiceOptions(plan, voice, opts)
  const src0 = processorSource('NAME', engine)
  const name = `ct-${engine}-${hash(src0)}`
  const src = processorSource(name, engine)
  const header = opts.text ? `// "${opts.text.replace(/\n/g, ' ')}": spoken by Strudel itself\n` : ''
  const code = `${header}// Continuous-Tunes voice instrument (${voice.id}): a glottal source and vocal tract running inside
// Strudel as a registered sound, one continuous voice per utterance. Paste into strudel.cc.
const ac = getAudioContext()
ac.ctVoice ??= {}
ac.ctVoice[${sq(name)}] ??= ac.audioWorklet.addModule('data:text/javascript;base64,' + btoa(${sq(src)}))
await ac.ctVoice[${sq(name)}]
const speech = [${sq(track)}]
const settings = { ${Object.entries(settings).map(([k, v]) => `${k}: ${v}`).join(', ')} }
registerSound('ctvoice', (t, value, onended) => {
  const node = new AudioWorkletNode(ac, ${sq(name)}, { numberOfInputs: 0, outputChannelCount: [1],
    processorOptions: { ...settings, start: Math.round(t * ac.sampleRate), track: speech[value.n ?? 0] } })
  node.port.onmessage = () => { node.disconnect(); onended() }
  return { node, stop: () => {} }
}, { type: 'synth' })

setcps(${(1 / seconds).toFixed(4)})
s("ctvoice")
`
  return { code, seconds, trackChars: track.length }
}
