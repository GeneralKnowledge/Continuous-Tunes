import type { MusicGenome, ScaleMode } from '../music/genome'

const NOTE_NAMES = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'] as const

/** Intervals from root for each mode (semitones). */
const MODE_INTERVALS: Record<ScaleMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
}

const VOICING_INTERVALS = {
  triad: [0, 2, 4],
  seventh: [0, 2, 4, 6],
  power: [0, 4],
} as const

/** UI mutes — do not alter the genome, only compilation. */
export interface LayerMutes {
  drums?: boolean
  bass?: boolean
  melody?: boolean
  chords?: boolean
}

/**
 * Scale degree → note name. Degrees past the end of the scale move up an octave,
 * and pitch classes that pass B roll into the next octave so the scale always ascends.
 */
function scaleDegreeNote(genome: MusicGenome, degree: number, octave: number): string {
  const intervals = MODE_INTERVALS[genome.scale.mode]
  const len = intervals.length
  const idx = ((degree % len) + len) % len
  const octaveShift = Math.floor(degree / len)
  const semis = genome.scale.root + intervals[idx]! + 12 * (octave + octaveShift)
  return `${NOTE_NAMES[semis % 12]!}${Math.floor(semis / 12)}`
}

function boolTokens(steps: boolean[], hit: string): string[] {
  return steps.map((on) => (on ? hit : '~'))
}

function noteTokens(genome: MusicGenome, notes: (number | null)[], octave: number): string[] {
  return notes.map((d) => (d === null ? '~' : scaleDegreeNote(genome, d, octave)))
}

function chordTokens(genome: MusicGenome): string[] {
  const { progression, voicing } = genome.chords
  const stepsPerBar = genome.stepsPerBar
  const tokens: string[] = []

  for (let bar = 0; bar < genome.bars; bar++) {
    const rootDeg = progression[bar] ?? 0
    const intervals = VOICING_INTERVALS[voicing]
    const chordTones = intervals.map((degOff) => scaleDegreeNote(genome, rootDeg + degOff, 3))
    const chordToken = `[${chordTones.join(',')}]`
    for (let s = 0; s < stepsPerBar; s++) {
      const global = bar * stepsPerBar + s
      if (genome.chords.rhythm[global]) {
        tokens.push(chordToken)
      } else {
        tokens.push('~')
      }
    }
  }
  return tokens
}

/** How a section renders the theme: which layers play and how open the filters are. */
export interface RenderOptions {
  drums: 'off' | 'light' | 'mid' | 'full'
  bass: boolean
  melody: boolean
  chords: boolean
  /** Bass low-pass cutoff in Hz. */
  bassLpf: number
  chordGain: number
  /** Whole-section filter sweep (builds, fades): cutoff from → to in Hz. */
  sweep?: { from: number; to: number; bars: number }
}

export const FULL_RENDER: RenderOptions = {
  drums: 'full',
  bass: true,
  melody: true,
  chords: true,
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
}

/** A song placed on the timeline, starting at an absolute cycle (1 cycle = 1 bar at the base tempo). */
export interface ScheduledSong {
  startCycle: number
  sections: SongSection[]
}

function cutoffForEnergy(e: number): number {
  return Math.round(300 + 4200 * e * e)
}

/**
 * Energy → arrangement. Low energy thins drums and drops layers; breakdowns lose kick and bass.
 * Ramping sections render at their higher energy and sweep the filter across the section.
 */
export function renderForSection(role: string, energy: number, energyEnd: number | undefined, bars: number): RenderOptions {
  const e = Math.max(energy, energyEnd ?? energy)
  const breakdown = role === 'breakdown'
  const opts: RenderOptions = {
    drums: breakdown ? (e >= 0.3 ? 'light' : 'off') : e < 0.2 ? 'off' : e < 0.45 ? 'light' : e < 0.7 ? 'mid' : 'full',
    bass: !breakdown && e >= 0.3,
    melody: breakdown || e >= 0.55,
    chords: true,
    bassLpf: Math.round(300 + 900 * e),
    chordGain: Number((0.2 + 0.2 * e).toFixed(2)),
  }
  if (energyEnd !== undefined && energyEnd !== energy) {
    opts.sweep = { from: cutoffForEnergy(energy), to: cutoffForEnergy(energyEnd), bars }
  }
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
  return layer === 'drums' ? opts.drums !== 'off' : opts[layer]
}

/**
 * One layer from its step tokens. Swing delays the off-beat steps (odd grid steps) by
 * `swingDelay` cycles; Strudel's swingBy() doubles notes that fill a whole half-slice,
 * so the delay is applied to a separate off-beat pattern instead.
 */
function layer(ctor: 's' | 'note', tokens: string[], suffix: string, swingDelay: number): string {
  const offbeats = tokens.some((t, i) => i % 2 === 1 && t !== '~')
  if (swingDelay <= 0 || !offbeats) return `${ctor}("${tokens.join(' ')}")${suffix}`
  const on = tokens.map((t, i) => (i % 2 === 0 ? t : '~')).join(' ')
  const off = tokens.map((t, i) => (i % 2 === 1 ? t : '~')).join(' ')
  return `stack(${ctor}("${on}"), ${ctor}("${off}").late(${num(swingDelay)}))${suffix}`
}

/**
 * One genome as a Strudel pattern expression: `bars` cycles long, one cycle per bar.
 * THIS IS THE ONLY MODULE THAT KNOWS STRUDEL SYNTAX.
 */
function genomePattern(genome: MusicGenome, mutes: LayerMutes | undefined, opts: RenderOptions, indent = ''): string {
  const spb = genome.stepsPerBar
  const beat = Math.max(1, spb / 4)
  const layers: string[] = []
  // Before .slow(bars) one cycle is the whole loop, so a step is 1 / (spb × bars) cycles
  const swing = genome.parameters.swing
  const swingDelay = swing > 0.01 ? swing / (spb * genome.bars) : 0

  if (layerOn(genome, 'drums', mutes, opts)) {
    let { kick, snare, hihat } = genome.drums
    if (opts.drums === 'light') {
      kick = thin(kick, (s) => s === 0, spb)
      snare = snare.map(() => false)
      hihat = thin(hihat, (s) => s % beat === 0, spb)
    } else if (opts.drums === 'mid') {
      hihat = thin(hihat, (s) => s % Math.max(1, beat / 2) === 0, spb)
    }
    if (kick.some(Boolean)) layers.push(layer('s', boolTokens(kick, 'bd'), '', swingDelay))
    if (snare.some(Boolean)) layers.push(layer('s', boolTokens(snare, 'sd'), '', swingDelay))
    if (hihat.some(Boolean)) layers.push(layer('s', boolTokens(hihat, 'hh'), '.gain(0.55)', swingDelay))
  }

  if (layerOn(genome, 'bass', mutes, opts)) {
    const tokens = noteTokens(genome, genome.bass.notes, genome.bass.octave)
    layers.push(layer('note', tokens, `.sound("sawtooth").lpf(${opts.bassLpf}).gain(0.7)`, swingDelay))
  }

  if (layerOn(genome, 'melody', mutes, opts)) {
    const tokens = noteTokens(genome, genome.melody.notes, genome.melody.octave)
    layers.push(layer('note', tokens, '.sound("triangle").gain(0.55)', swingDelay))
  }

  if (layerOn(genome, 'chords', mutes, opts)) {
    layers.push(
      layer('note', chordTokens(genome), `.sound("sawtooth").lpf(1200).gain(${opts.chordGain}).room(0.3)`, swingDelay),
    )
  }

  if (layers.length === 0) layers.push(`s("~")`)

  // The mini-notation strings hold the whole loop; slow it so one cycle is one bar
  let body = `stack(\n${layers.map((l) => `${indent}  ${l}`).join(',\n')}\n${indent}).slow(${genome.bars})`
  if (opts.sweep) {
    body = `${body}.lpf(saw.range(${opts.sweep.from}, ${opts.sweep.to}).slow(${opts.sweep.bars}))`
  }
  return body
}

function cpsFor(tempo: number): string {
  return (tempo / 60 / 4).toFixed(5)
}

/** Compile a MusicGenome into executable Strudel code: the loop at full energy. */
export function compileGenome(genome: MusicGenome, mutes?: LayerMutes): string {
  return `setcps(${cpsFor(genome.tempo)})\n${genomePattern(genome, mutes, FULL_RENDER)}`
}

function songPattern(song: ScheduledSong, mutes: LayerMutes | undefined): string {
  const parts = song.sections.map((sec) => {
    const opts = renderForSection(sec.role, sec.energy, sec.energyEnd, sec.bars)
    return `    [${sec.bars}, ${genomePattern(sec.genome, mutes, opts, '    ')}]`
  })
  return `arrange(\n${parts.join(',\n')}\n  )`
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
export function compileTimeline(songs: ScheduledSong[], baseTempo: number, mutes?: LayerMutes): string {
  if (songs.length === 0) return `setcps(${cpsFor(baseTempo)})\nsilence`
  const parts: string[] = []
  const lead = songs[0]!.startCycle
  if (lead > 0) parts.push(`  [${num(lead)}, silence]`)
  const entries = [...songs, songs[songs.length - 1]!]
  for (const song of entries) {
    const ratio = tempoRatio(song, baseTempo)
    const pattern = ratio === 1 ? songPattern(song, mutes) : `${songPattern(song, mutes)}.fast(${num(ratio)})`
    parts.push(`  [${num(songCycles(song, baseTempo))}, ${pattern}]`)
  }
  return `setcps(${cpsFor(baseTempo)})\narrange(\n${parts.join(',\n')}\n)`
}

/** Human-readable one-line summary for the UI. */
export function summarizeGenome(genome: MusicGenome): string {
  const layers = Object.entries(genome.activeLayers)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join('+')
  return `${genome.tempo}bpm ${NOTE_NAMES[genome.scale.root]}${genome.scale.mode} [${layers}] ${genome.bars}bars×${genome.stepsPerBar}`
}
