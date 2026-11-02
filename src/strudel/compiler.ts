import type { MusicGenome, NoteLayer, PatternGene, PatternTarget } from '../music/genome'
import { noteHolds } from '../music/context'
import { DEFAULT_KIT, type SoundKit, type SynthVoice } from '../music/kits'
import { barChords, chordVoicings } from '../music/harmony'
import { accentAt, getStyle, type Accents, type FillKind, type GenreStyle } from '../music/styles'
import { chordTypeIntervals, degreeToMidi } from '../music/theory'

export type { FillKind } from '../music/styles'

const NOTE_NAMES = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'] as const

/** UI mutes — do not alter the genome, only compilation. */
export interface LayerMutes {
  drums?: boolean
  bass?: boolean
  melody?: boolean
  chords?: boolean
  arp?: boolean
  counter?: boolean
}

/** MIDI note → Strudel note name (c4 = 60). */
function midiNote(midi: number): string {
  return `${NOTE_NAMES[midi % 12]!}${Math.floor(midi / 12) - 1}`
}

/** Scale degree → note name; degrees past the end of the scale move up an octave, so lines always ascend. */
function scaleDegreeNote(genome: MusicGenome, degree: number, octave: number): string {
  return midiNote(degreeToMidi(genome.scale, degree, octave))
}

function boolTokens(steps: boolean[], hit: string): string[] {
  return steps.map((on) => (on ? hit : '~'))
}

/** Hold tokens (`_`) after each onset for its length; rests stay rests. */
function withHolds(tokens: string[], holds: readonly number[]): string[] {
  const out = [...tokens]
  tokens.forEach((t, i) => {
    if (t === '~') return
    for (let k = 1; k < holds[i]! && i + k < out.length && tokens[i + k] === '~'; k++) out[i + k] = '_'
  })
  return out
}

function noteTokens(genome: MusicGenome, layer: Pick<NoteLayer, 'notes' | 'octave' | 'gate'>): string[] {
  const tokens = layer.notes.map((d) => (d === null ? '~' : scaleDegreeNote(genome, d, layer.octave)))
  return withHolds(tokens, noteHolds(layer.notes, layer.gate))
}

/**
 * Chord layer tokens: each bar's voice-led voicing on the chord rhythm, or (pads) one chord
 * held for the whole bar with `_`.
 */
function chordTokens(genome: MusicGenome, pads = false): string[] {
  const voicings = chordVoicings(genome)
  const spb = genome.stepsPerBar
  const tokens: string[] = []
  for (let bar = 0; bar < genome.bars; bar++) {
    const token = `[${voicings[bar]!.map(midiNote).join(',')}]`
    for (let s = 0; s < spb; s++) {
      if (pads) tokens.push(s === 0 ? token : '_')
      else tokens.push(genome.chords.rhythm[bar * spb + s] ? token : '~')
    }
  }
  if (pads || genome.chords.gate === undefined) return tokens
  const hits = genome.chords.rhythm.map((h) => (h ? 0 : null))
  return withHolds(tokens, noteHolds(hits, genome.chords.gate))
}

/**
 * Arp layer tokens: each index picks a tone of the bar's chord, stacked up from the root in the
 * arp's octave (indices past the last tone climb an octave).
 */
function arpTokens(genome: MusicGenome): string[] {
  const arp = genome.arp
  if (!arp) return []
  const spb = genome.stepsPerBar
  const chords = barChords(genome)
  return arp.pattern.map((idx, i) => {
    if (idx === null) return '~'
    const chord = chords[Math.floor(i / spb) % genome.bars]!
    const ivs = [...new Set(chordTypeIntervals(chord.type).map((x) => x % 12))].sort((a, b) => a - b)
    const base = 12 * (arp.octave + 1) + chord.root
    return midiNote(base + ivs[idx % ivs.length]! + 12 * Math.floor(idx / ivs.length))
  })
}

/** How a section renders the theme: which layers play and how open the filters are. */
export interface RenderOptions {
  drums: 'off' | 'light' | 'mid' | 'full'
  bass: boolean
  melody: boolean
  chords: boolean
  /** The arpeggio plays (mid energy and up, builds and breakdowns). */
  arp: boolean
  /** The counter-melody plays where the genome has one switched on. */
  counter?: boolean
  /** Chords held as pads for the whole bar instead of the stab rhythm. */
  pads: boolean
  /** Bass low-pass cutoff in Hz. */
  bassLpf: number
  chordGain: number
  /** Whole-section filter sweep (builds, fades): cutoff from → to in Hz. */
  sweep?: { from: number; to: number; bars: number }
  /** Section loudness as a velocity (multiplies every layer's gain), ramping from → to. */
  level?: { from: number; to: number }
}

export const FULL_RENDER: RenderOptions = {
  drums: 'full',
  bass: true,
  melody: true,
  chords: true,
  arp: true,
  counter: true,
  pads: false,
  bassLpf: 800,
  chordGain: 0.35,
}

/** One section of a song: the genome to play and how loud / full to play it. */
export interface SongSection {
  role: string
  bars: number
  energy: number
  energyEnd?: number
  genome: MusicGenome
  /** Theme (A) or contrast material (B, drops and choruses). */
  material?: 'A' | 'B'
}

/** A song placed on the timeline, starting at an absolute cycle (1 cycle = 1 bar at the base tempo). */
export interface ScheduledSong {
  startCycle: number
  sections: SongSection[]
}

function cutoffForEnergy(e: number): number {
  return Math.round(300 + 4200 * e * e)
}

/** Energy → velocity: full energy plays at 1, energy 0.3 about 7.5 dB quieter. */
export function levelForEnergy(e: number): number {
  return Number((0.3 + 0.7 * Math.pow(Math.max(0, Math.min(1, e)), 1.5)).toFixed(3))
}

/**
 * Energy → arrangement. Low energy thins drums and drops layers; breakdowns lose kick and bass.
 * Ramping sections render at their higher energy and sweep the filter across the section.
 */
export function renderForSection(
  role: string,
  energy: number,
  energyEnd: number | undefined,
  bars: number,
  style: GenreStyle = getStyle(undefined),
): RenderOptions {
  const e = Math.max(energy, energyEnd ?? energy)
  const breakdown = role === 'breakdown'
  const opts: RenderOptions = {
    drums: breakdown ? (e >= 0.3 ? 'light' : 'off') : e < 0.2 ? 'off' : e < 0.45 ? 'light' : e < 0.7 ? 'mid' : 'full',
    // Some genres take the bass out of a build, so the drop lands with it
    bass: !breakdown && e >= 0.3 && !(role === 'build' && style.arrange.buildWithoutBass),
    melody: breakdown || e >= 0.55,
    chords: true,
    arp: breakdown || role === 'build' || e >= 0.45,
    counter: breakdown || e >= 0.55,
    pads: style.padRoles.includes(role),
    bassLpf: Math.round(300 + 900 * e),
    chordGain: Number((0.2 + 0.2 * e).toFixed(2)),
  }
  if (energyEnd !== undefined && energyEnd !== energy) {
    opts.sweep = { from: cutoffForEnergy(energy), to: cutoffForEnergy(energyEnd), bars }
  }
  opts.level = { from: levelForEnergy(energy), to: levelForEnergy(energyEnd ?? energy) }
  return opts
}

function thin(arr: boolean[], keep: (stepInBar: number) => boolean, spb: number): boolean[] {
  return arr.map((on, i) => on && keep(i % spb))
}

function layerOn(
  genome: MusicGenome,
  layer: keyof MusicGenome['activeLayers'],
  mutes: LayerMutes | undefined,
  opts: RenderOptions,
): boolean {
  if (!genome.activeLayers[layer] || mutes?.[layer]) return false
  if (layer === 'arp') return genome.arp !== undefined && opts.arp
  if (layer === 'counter') return genome.counter !== undefined && opts.counter === true
  return layer === 'drums' ? opts.drums !== 'off' : opts[layer]
}

/**
 * One layer from its step tokens, `cycles` bars long (the tokens cover the whole loop and the
 * layer is slowed so one cycle is one bar). Swing delays the off-beat steps (odd grid steps) by
 * `swingDelay` of the token string; Strudel's swingBy() doubles notes that fill a whole
 * half-slice, so the off-beat notes (with their holds) go into a separate, delayed pattern.
 * `genes` (Strudel pattern transforms) apply after the slow, so they count in bars.
 */
function layer(
  ctor: 's' | 'note',
  tokens: string[],
  suffix: string,
  swingDelay: number,
  late = 0,
  cycles = 1,
  genes = '',
): string {
  const shift = late > 0 ? `.late(${num(late)})` : late < 0 ? `.early(${num(-late)})` : ''
  const slow = cycles !== 1 ? `.slow(${cycles})` : ''
  // The onset each step belongs to (holds belong to the note before them), or -1 in a rest
  const owner: number[] = []
  let cur = -1
  tokens.forEach((t, i) => {
    if (t !== '_') cur = t === '~' ? -1 : i
    owner.push(cur)
  })
  const offbeats = tokens.some((t, i) => i % 2 === 1 && t !== '~' && t !== '_')
  if (swingDelay <= 0 || !offbeats) return `${ctor}("${tokens.join(' ')}")${shift}${suffix}${slow}${genes}`
  const lane = (odd: boolean) =>
    tokens.map((t, i) => (owner[i]! >= 0 && owner[i]! % 2 === (odd ? 1 : 0) ? t : '~')).join(' ')
  return `stack(${ctor}("${lane(false)}"), ${ctor}("${lane(true)}").late(${num(swingDelay)}))${shift}${suffix}${slow}${genes}`
}

/** One pattern gene as a Strudel transform (amounts in steps become bars: one cycle is one bar). */
function geneCode(gene: PatternGene, spb: number): string {
  let f: string
  switch (gene.op) {
    case 'degrade':
      f = `x.degradeBy(${num(gene.amount)})`
      break
    case 'ply':
      f = gene.chance !== undefined ? `x.sometimesBy(${num(gene.chance)}, y => y.ply(${gene.amount}))` : `x.ply(${gene.amount})`
      break
    case 'off':
      f = `x.off(${num(gene.amount / spb)}, y => y.mul(gain(0.45)))`
      break
    case 'nudge':
      f = gene.amount >= 0 ? `x.late(${num(gene.amount / spb)})` : `x.early(${num(-gene.amount / spb)})`
      break
  }
  if (gene.every !== undefined && gene.every > 1) return `.lastOf(${gene.every}, x => ${f})`
  return `.${f.slice(2)}`
}

/** Every gene of the genome on one target layer, as a method chain. */
function genesFor(genome: MusicGenome, target: PatternTarget): string {
  return (genome.patterns ?? [])
    .filter((g) => g.target === target)
    .map((g) => geneCode(g, genome.stepsPerBar))
    .join('')
}

interface DrumSteps {
  kick: boolean[]
  snare: boolean[]
  hihat: boolean[]
  perc: boolean[]
}

/** The genome's drums, thinned for the section's drum level. */
function drumSteps(genome: MusicGenome, opts: RenderOptions): DrumSteps {
  const spb = genome.stepsPerBar
  const beat = Math.max(1, spb / 4)
  let { kick, snare, hihat } = genome.drums
  let perc = genome.drums.perc ?? kick.map(() => false)
  if (opts.drums === 'light') {
    kick = thin(kick, (s) => s === 0, spb)
    snare = snare.map(() => false)
    hihat = thin(hihat, (s) => s % beat === 0, spb)
    perc = perc.map(() => false)
  } else if (opts.drums === 'mid') {
    hihat = thin(hihat, (s) => s % Math.max(1, beat / 2) === 0, spb)
  }
  return { kick, snare, hihat, perc }
}

/** `.gain(x)` scaled by the kit's loudness trim; nothing when it comes out at 1. */
function gainOf(gain: number, kit: SoundKit): string {
  const g = gain * kit.master
  return Math.abs(g - 1) < 1e-6 ? '' : `.gain(${num(g)})`
}

/** Velocity of a hit where the groove has no accent: a ghost note, not silence. */
const UNACCENTED = { kick: 0.6, snare: 0.3, hat: 0.35, perc: 0.4 } as const

/**
 * `.gain(…)` for a drum line: the kit level times the groove's accent on each step (ghost
 * snares, soft 16th hats), or one value when every hit is equally loud.
 */
function accentGain(steps: boolean[], accents: Accents, fallback: number, base: number, kit: SoundKit, spb: number): string {
  const levels = steps.map((on, i) => (on ? (accentAt(accents, i, spb) || fallback) * base : 0))
  const played = levels.filter((_, i) => steps[i])
  if (played.length === 0 || played.every((v) => Math.abs(v - played[0]!) < 1e-6)) return gainOf(played[0] ?? base, kit)
  return `.gain("${levels.map((v) => num(Number((v * kit.master).toFixed(3)))).join(' ')}")`
}

/** Micro-timing in cycles of a loop-long pattern, from a fraction of a 16th. */
function feelDelay(fraction: number | undefined, totalSteps: number, spb: number): number {
  return fraction ? (fraction * (spb / 16)) / totalSteps : 0
}

function drumLayers(
  d: DrumSteps,
  swingDelay: number,
  kit: SoundKit,
  style: GenreStyle,
  genome: MusicGenome,
  cycles: number,
): string[] {
  const spb = genome.stepsPerBar
  const k = kit.drums
  const g = style.groove
  const n = d.kick.length
  const layers: string[] = []
  if (d.kick.some(Boolean)) layers.push(layer('s', boolTokens(d.kick, k.kick), accentGain(d.kick, g.kick, UNACCENTED.kick, 1, kit, spb), swingDelay, 0, cycles, genesFor(genome, 'kick')))
  if (d.snare.some(Boolean)) {
    layers.push(
      layer('s', boolTokens(d.snare, k.snare), accentGain(d.snare, g.snare, UNACCENTED.snare, 1, kit, spb), swingDelay, feelDelay(g.feel?.snare, n, spb), cycles, genesFor(genome, 'snare')),
    )
  }
  if (d.hihat.some(Boolean)) {
    layers.push(
      layer('s', boolTokens(d.hihat, k.hat), accentGain(d.hihat, g.hat, UNACCENTED.hat, k.hatGain, kit, spb), swingDelay, feelDelay(g.feel?.hat, n, spb), cycles, genesFor(genome, 'hihat')),
    )
  }
  if (k.perc && d.perc.some(Boolean)) {
    layers.push(
      layer('s', boolTokens(d.perc, k.perc.sample), accentGain(d.perc, g.perc, UNACCENTED.perc, k.perc.gain, kit, spb), swingDelay, feelDelay(g.feel?.perc, n, spb), cycles, genesFor(genome, 'perc')),
    )
  }
  return layers
}

/** The kit's sampled break, one stretched copy per bar of a `bars`-long loop. */
function breakLoop(kit: SoundKit, bars: number, opts: RenderOptions): string[] {
  const loop = kit.drums.loop
  if (!loop || (opts.drums !== 'mid' && opts.drums !== 'full')) return []
  const tokens = Array.from({ length: bars }, () => loop.sample).join(' ')
  return [`s("${tokens}").fit()${gainOf(loop.gain, kit)}${bars !== 1 ? `.slow(${bars})` : ''}`]
}

/**
 * A synth voice as method calls: waveform, filter, envelope, level and effects.
 * `cutoff` overrides the voice's filter (the bass opens with energy), `gainScale` its level.
 */
function voice(v: SynthVoice, kit: SoundKit, tempo: number, cutoff = v.lpf, gainScale = 1): string {
  let out = `.sound("${v.sound}")`
  if (cutoff > 0) out += `.lpf(${Math.round(cutoff)})`
  if (v.resonance !== undefined) out += `.lpq(${v.resonance})`
  if (v.filterEnv !== undefined) out += `.lpenv(${v.filterEnv})`
  if (v.attack !== undefined) out += `.attack(${v.attack})`
  if (v.decay !== undefined) out += `.decay(${v.decay})`
  if (v.sustain !== undefined) out += `.sustain(${v.sustain})`
  if (v.release !== undefined) out += `.release(${v.release})`
  if (v.fm !== undefined) out += `.fm(${v.fm})`
  out += `.gain(${num(v.gain * gainScale * kit.master)})`
  if (v.room !== undefined) out += `.room(${v.room})`
  if (v.delay !== undefined) {
    // A dotted eighth at the song's tempo
    out += `.delay(${v.delay}).delaytime(${num((0.75 * 60) / tempo)}).delayfeedback(0.4)`
  }
  if (v.crush !== undefined) out += `.crush(${v.crush})`
  return out
}

/** The lead softened for the counter-melody: quieter and darker, so it sits under the melody. */
function counterVoice(v: SynthVoice): SynthVoice {
  return { ...v, gain: v.gain * 0.7, lpf: v.lpf > 0 ? Math.round(v.lpf * 0.7) : 1800 }
}

/** A chord voice softened into a held pad: slow attack, full sustain, long release. */
function padVoice(v: SynthVoice): SynthVoice {
  return {
    ...v,
    attack: Math.max(v.attack ?? 0, 0.35),
    decay: undefined,
    sustain: 0.8,
    release: Math.max(v.release ?? 0, 1.2),
    lpf: v.lpf > 0 ? Math.round(v.lpf * 0.8) : 0,
    room: Math.max(v.room ?? 0, 0.5),
  }
}

/** Swing delay in cycles for a pattern whose one cycle holds `steps` grid steps. */
function swingDelayFor(genome: MusicGenome, steps: number): number {
  const swing = genome.parameters.swing
  return swing > 0.01 ? swing / steps : 0
}

/** Bass, melody and chord layers (everything but drums), each holding the whole loop in one cycle. */
function tonalLayers(
  genome: MusicGenome,
  mutes: LayerMutes | undefined,
  opts: RenderOptions,
  kit: SoundKit,
): string[] {
  const layers: string[] = []
  const swingDelay = swingDelayFor(genome, genome.stepsPerBar * genome.bars)
  const t = genome.tempo
  const bars = genome.bars
  if (layerOn(genome, 'bass', mutes, opts)) {
    const tokens = noteTokens(genome, genome.bass)
    // The bass filter opens with energy: opts.bassLpf is relative to a 1200 Hz full-energy cutoff
    const cutoff = (kit.bass.lpf * opts.bassLpf) / 1200
    layers.push(layer('note', tokens, voice(kit.bass, kit, t, cutoff), swingDelay, 0, bars, genesFor(genome, 'bass')))
  }
  if (layerOn(genome, 'melody', mutes, opts)) {
    const tokens = noteTokens(genome, genome.melody)
    layers.push(layer('note', tokens, voice(kit.lead, kit, t), swingDelay, 0, bars, genesFor(genome, 'melody')))
  }
  if (layerOn(genome, 'counter', mutes, opts)) {
    const v = kit.counter ?? counterVoice(kit.lead)
    layers.push(layer('note', noteTokens(genome, genome.counter!), voice(v, kit, t), swingDelay, 0, bars, genesFor(genome, 'counter')))
  }
  if (layerOn(genome, 'chords', mutes, opts)) {
    // opts.chordGain is relative to the full-loop level of 0.35
    const scale = opts.chordGain / FULL_RENDER.chordGain
    const v = opts.pads ? padVoice(kit.chords) : kit.chords
    layers.push(layer('note', chordTokens(genome, opts.pads), voice(v, kit, t, v.lpf, scale * (opts.pads ? 0.8 : 1)), swingDelay, 0, bars, genesFor(genome, 'chords')))
  }
  if (layerOn(genome, 'arp', mutes, opts)) {
    const v = kit.arp ?? { ...kit.lead, gain: kit.lead.gain * 0.8 }
    layers.push(layer('note', arpTokens(genome), voice(v, kit, t), swingDelay, 0, bars, genesFor(genome, 'arp')))
  }
  return layers
}

function stackOf(layers: string[], indent: string): string {
  if (layers.length === 0) layers = [`s("~")`]
  return `stack(\n${layers.map((l) => `${indent}  ${l}`).join(',\n')}\n${indent})`
}

/** The loop's layers together (each layer is already slowed so one cycle is one bar). */
function loopPattern(layers: string[], indent: string): string {
  return stackOf(layers, indent)
}

/**
 * One genome as a Strudel pattern expression: `bars` cycles long, one cycle per bar.
 * THIS IS THE ONLY MODULE THAT KNOWS STRUDEL SYNTAX.
 */
function genomePattern(
  genome: MusicGenome,
  mutes: LayerMutes | undefined,
  opts: RenderOptions,
  kit: SoundKit,
  indent = '',
): string {
  const layers: string[] = []
  if (layerOn(genome, 'drums', mutes, opts)) {
    const swingDelay = swingDelayFor(genome, genome.stepsPerBar * genome.bars)
    layers.push(
      ...drumLayers(drumSteps(genome, opts), swingDelay, kit, getStyle(genome.genre), genome, genome.bars),
      ...breakLoop(kit, genome.bars, opts),
    )
  }
  layers.push(...tonalLayers(genome, mutes, opts, kit))
  let body = loopPattern(layers, indent)
  if (opts.sweep) body = `${body}.lpf(${sweepSignal(opts.sweep)})`
  return body
}

function sweepSignal(sweep: NonNullable<RenderOptions['sweep']>): string {
  return `saw.range(${sweep.from}, ${sweep.to}).slow(${sweep.bars})`
}

export interface SectionTransition {
  /** Crash cymbal on the section's first beat (a drop landing). */
  crash: boolean
  /** Lead-in on the section's last bar, if another section follows in this song. */
  fill: FillKind | null
  /** Hats and snare rising across the section (builds). */
  ramp: boolean
}

const LANDING_ROLES = new Set(['drop', 'peak', 'chorus'])

/**
 * Transitions for section `index`: builds ramp up and drop the kick for their last bar,
 * a section rising into a bigger one ends on the genre's lift fill (a snare roll, a lo-fi
 * drop-out), others on its turnaround fill (toms, a drum edit), and a section without drums
 * gets a hi-hat riser. Big sections land on a crash.
 */
export function sectionTransition(sections: readonly SongSection[], index: number): SectionTransition {
  const sec = sections[index]!
  const next = sections[index + 1]
  const prev = sections[index - 1]
  const style = getStyle(sec.genome.genre)
  const opts = renderForSection(sec.role, sec.energy, sec.energyEnd, sec.bars, style)
  const end = sec.energyEnd ?? sec.energy
  let fill: FillKind | null = null
  if (next) {
    const nextOpts = renderForSection(next.role, next.energy, next.energyEnd, next.bars, style)
    if (sec.role === 'build') fill = 'build'
    else if (opts.drums === 'off') fill = nextOpts.drums === 'off' ? null : 'riser'
    else if (next.energy > end + 0.15) fill = style.fills.lift
    else fill = style.fills.turn
  }
  return {
    crash: prev !== undefined && LANDING_ROLES.has(sec.role) && opts.drums !== 'off',
    fill,
    ramp: sec.role === 'build' && sec.bars > 1,
  }
}

function emptySteps(n: number): string[] {
  return Array.from({ length: n }, () => '~')
}

/**
 * Drums for one bar (one cycle) of the loop, ending in a fill.
 * `bar` is the bar of the genome's loop that the section is on.
 */
function fillBar(
  genome: MusicGenome,
  opts: RenderOptions,
  bar: number,
  kind: FillKind,
  drumsOn: boolean,
  kit: SoundKit,
): string[] {
  const spb = genome.stepsPerBar
  const style = getStyle(genome.genre)
  const slice = (a: boolean[]) => a.slice(bar * spb, (bar + 1) * spb)
  const base = drumsOn ? drumSteps(genome, opts) : { kick: [], snare: [], hihat: [], perc: [] }
  const d: DrumSteps = {
    kick: drumsOn ? slice(base.kick) : Array(spb).fill(false),
    snare: drumsOn ? slice(base.snare) : Array(spb).fill(false),
    hihat: drumsOn ? slice(base.hihat) : Array(spb).fill(false),
    perc: drumsOn ? slice(base.perc) : Array(spb).fill(false),
  }
  const drumLine = () => drumLayers(d, swingDelay, kit, style, genome, 1)
  const layers: string[] = []
  const swingDelay = swingDelayFor(genome, spb)
  const quarter = Math.max(1, Math.floor(spb / 4))
  const half = Math.max(1, Math.floor(spb / 2))
  if (kind === 'riser') {
    layers.push(`s("${kit.drums.hat}*${spb}").gain(saw.range(${num(0.05 * kit.master)}, ${num(0.5 * kit.master)}))`)
    return layers
  }
  if (kind === 'tom') {
    const from = spb - quarter
    const [ht, mt, lt] = kit.drums.toms
    const toms = quarter >= 4 ? [ht, ht, mt, lt] : quarter === 2 ? [mt, lt] : [lt]
    const tokens = emptySteps(spb)
    for (let i = from; i < spb; i++) {
      d.snare[i] = false
      d.hihat[i] = false
      d.perc[i] = false
      tokens[i] = toms[Math.floor(((i - from) * toms.length) / quarter)]!
    }
    layers.push(...drumLine(), `s("${tokens.join(' ')}")${gainOf(0.7, kit)}`)
    return layers
  }
  if (kind === 'stop') {
    // The beat drops out for the last two beats, with one soft snare pickup on the final 16th
    const from = spb - half
    for (let i = from; i < spb; i++) {
      d.kick[i] = false
      d.snare[i] = false
      d.hihat[i] = false
      d.perc[i] = false
    }
    const tokens = emptySteps(spb)
    tokens[spb - 1] = kit.drums.snare
    layers.push(...drumLine(), `s("${tokens.join(' ')}")${gainOf(0.45, kit)}`)
    return layers
  }
  if (kind === 'edit') {
    // A drum edit on the last beat: the snare stutters in 16ths over a kick on the beat
    const from = spb - quarter
    const tokens = emptySteps(spb)
    for (let i = from; i < spb; i++) {
      d.snare[i] = false
      d.hihat[i] = false
      d.kick[i] = i === from
      tokens[i] = kit.drums.snare
    }
    layers.push(...drumLine(), `s("${tokens.join(' ')}").gain(saw.range(${num(0.25 * kit.master)}, ${num(0.85 * kit.master)}))`)
    return layers
  }
  // Snare roll: the last half of the bar (or the whole bar at the end of a build, with no kick)
  const from = kind === 'build' ? 0 : spb - half
  const tokens = emptySteps(spb)
  for (let i = from; i < spb; i++) {
    d.snare[i] = false
    d.hihat[i] = false
    d.perc[i] = false
    if (kind === 'build') d.kick[i] = false
    // 8ths in the first half of a build's roll, every step after that
    if (i >= spb - half || i % 2 === 0) tokens[i] = kit.drums.snare
  }
  layers.push(
    ...drumLine(),
    `s("${tokens.join(' ')}").gain(saw.range(${num(0.3 * kit.master)}, ${num(0.8 * kit.master)}))`,
  )
  return layers
}

interface Segment {
  bars: number
  code: string
}

/**
 * One section as a list of segments: an optional crash bar, the body, and an optional fill bar.
 * Each segment starts its loop at the right bar with .early(), since arrange() restarts each one at 0.
 */
function sectionSegments(
  sections: readonly SongSection[],
  index: number,
  mutes: LayerMutes | undefined,
  name: string,
  defs: string[],
  kit: SoundKit,
): Segment[] {
  const sec = sections[index]!
  const g = sec.genome
  const style = getStyle(g.genre)
  const opts = renderForSection(sec.role, sec.energy, sec.energyEnd, sec.bars, style)
  const t = sectionTransition(sections, index)
  const drumsAllowed = g.activeLayers.drums && !mutes?.drums
  const drumsOn = layerOn(g, 'drums', mutes, opts)
  const loopSwing = swingDelayFor(g, g.stepsPerBar * g.bars)
  const k = kit.drums
  const drums = drumsOn
    ? [...drumLayers(drumSteps(g, opts), loopSwing, kit, style, g, g.bars), ...breakLoop(kit, g.bars, opts)]
    : []
  const tonal = tonalLayers(g, mutes, opts, kit)
  const ramp =
    t.ramp && drumsAllowed
      ? [
          `s("[${k.hat}*16, ${k.snare}*4]").gain(saw.range(${num(0.05 * kit.master)}, ${num(0.5 * kit.master)}).slow(${sec.bars}))`,
        ]
      : []
  const crash = t.crash && drumsAllowed ? [`s("${k.crash}")${gainOf(0.5, kit)}`] : []
  const fill = t.fill && drumsAllowed && sec.bars > 1 ? t.fill : null

  const level = opts.level
  const velocity = !level
    ? ''
    : level.from === level.to
      ? level.from === 1
        ? ''
        : `.velocity(${level.from})`
      : `.velocity(saw.range(${level.from}, ${level.to}).slow(${sec.bars}))`
  const sweep = `${opts.sweep ? `.lpf(${sweepSignal(opts.sweep)})` : ''}${velocity}`
  const shift = (bar: number) => (bar > 0 ? `.early(${bar})` : '')
  // Each loop is defined once as a constant and shared by the section's segments
  const define = (suffix: string, layers: string[]): string[] => {
    if (layers.length === 0) return []
    defs.push(`const ${name}${suffix} = ${loopPattern(layers, '')}`)
    return [`${name}${suffix}`]
  }
  const drumLoop = define('d', drums)
  const tonalLoop = define('t', tonal)
  const line = (layers: string[]) =>
    layers.length === 0 ? 'silence' : layers.length === 1 ? layers[0]! : `stack(${layers.join(', ')})`
  // A segment covering bars [from, from + n) of the section, with one-bar overlays on top
  const segment = (from: number, n: number, perBar: string[] = []): Segment => ({
    bars: n,
    code: `${line([...drumLoop, ...tonalLoop, ...ramp, ...perBar])}${sweep}${shift(from)}`,
  })

  const out: Segment[] = []
  let from = 0
  let to = sec.bars
  if (crash.length && sec.bars > (fill ? 2 : 1)) {
    out.push(segment(0, 1, crash))
    from = 1
  }
  if (fill) to = sec.bars - 1
  if (to > from) out.push(segment(from, to - from))
  if (fill) {
    const bar = (sec.bars - 1) % g.bars
    const fillDrums = fillBar(g, opts, bar, fill, drumsOn, kit)
    out.push({
      bars: 1,
      // The fill holds one bar; the tonal loop is shifted to the section's last bar
      code: `${line([...tonalLoop, ...fillDrums])}${sweep}${shift(sec.bars - 1)}`,
    })
  }
  return out
}

function cpsFor(tempo: number): string {
  return (tempo / 60 / 4).toFixed(5)
}

/** Compile a MusicGenome into executable Strudel code: the loop at full energy. */
export function compileGenome(genome: MusicGenome, mutes?: LayerMutes, kit: SoundKit = DEFAULT_KIT): string {
  return `setcps(${cpsFor(genome.tempo)})\n${genomePattern(genome, mutes, FULL_RENDER, kit)}`
}

/** A song as `arrange(...)` of its section segments; loop constants go to `defs`. */
function songPattern(
  song: ScheduledSong,
  mutes: LayerMutes | undefined,
  name: string,
  defs: string[],
  kit: SoundKit,
): string {
  const parts = song.sections.flatMap((_, i) =>
    sectionSegments(song.sections, i, mutes, `${name}s${i}`, defs, kit).map((seg) => `  [${seg.bars}, ${seg.code}]`),
  )
  return `arrange(\n${parts.join(',\n')}\n)`
}

/** Song length in bars. */
export function songBars(song: ScheduledSong): number {
  return song.sections.reduce((a, s) => a + s.bars, 0)
}

/**
 * Tempo ratio of a song against the timeline's base tempo. A song at a different tempo is
 * sped up or slowed down so one global cps can carry every song.
 */
export function tempoRatio(song: ScheduledSong, baseTempo: number): number {
  return (song.sections[0]?.genome.tempo ?? baseTempo) / baseTempo
}

/** Cycles a song occupies on a timeline with this base tempo. */
export function songCycles(song: ScheduledSong, baseTempo: number): number {
  return songBars(song) / tempoRatio(song, baseTempo)
}

function num(n: number): string {
  return String(Number(n.toFixed(6)))
}

/**
 * Compile consecutive songs into one pattern on absolute cycles, so the audio clock (not JS timers)
 * switches sections and songs. Leading silence covers the cycles before the first song; the last
 * song is repeated as a safety net in case the next one arrives late.
 */
export function compileTimeline(
  songs: ScheduledSong[],
  baseTempo: number,
  mutes?: LayerMutes,
  kit: SoundKit = DEFAULT_KIT,
): string {
  if (songs.length === 0) return `setcps(${cpsFor(baseTempo)})\nsilence`
  const defs: string[] = []
  const parts: string[] = []
  const lead = songs[0]!.startCycle
  if (lead > 0) parts.push(`  [${num(lead)}, silence]`)
  songs.forEach((song, i) => {
    const ratio = tempoRatio(song, baseTempo)
    const pattern = songPattern(song, mutes, `song${i}`, defs, kit)
    defs.push(`const song${i} = ${ratio === 1 ? pattern : `${pattern}.fast(${num(ratio)})`}`)
    parts.push(`  [${num(songCycles(song, baseTempo))}, song${i}]`)
  })
  // The last song again, in case the next one arrives late
  const last = songs.length - 1
  parts.push(`  [${num(songCycles(songs[last]!, baseTempo))}, song${last}]`)
  return `setcps(${cpsFor(baseTempo)})\n${defs.join('\n')}\narrange(\n${parts.join(',\n')}\n)`
}

/** Human-readable one-line summary for the UI. */
export function summarizeGenome(genome: MusicGenome): string {
  const layers = Object.entries(genome.activeLayers)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join('+')
  return `${genome.tempo}bpm ${NOTE_NAMES[genome.scale.root]}${genome.scale.mode} [${layers}] ${genome.bars}bars×${genome.stepsPerBar}`
}
