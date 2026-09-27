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

function degreeToPc(root: number, mode: ScaleMode, degree: number): number {
  const intervals = MODE_INTERVALS[mode]
  const idx = ((degree % intervals.length) + intervals.length) % intervals.length
  return (root + intervals[idx]!) % 12
}

function noteName(pc: number, octave: number): string {
  return `${NOTE_NAMES[pc]!}${octave}`
}

function scaleDegreeNote(genome: MusicGenome, degree: number, octave: number): string {
  const pc = degreeToPc(genome.scale.root, genome.scale.mode, degree)
  return noteName(pc, octave)
}

function boolToMini(steps: boolean[], hit: string): string {
  return steps.map((on) => (on ? hit : '~')).join(' ')
}

function notesToMini(genome: MusicGenome, notes: (number | null)[], octave: number): string {
  return notes
    .map((d) => (d === null ? '~' : scaleDegreeNote(genome, d, octave)))
    .join(' ')
}

function chordNotesMini(genome: MusicGenome): string {
  const { progression, voicing } = genome.chords
  const stepsPerBar = genome.stepsPerBar
  const tokens: string[] = []

  for (let bar = 0; bar < genome.bars; bar++) {
    const rootDeg = progression[bar] ?? 0
    const intervals = VOICING_INTERVALS[voicing]
    const chordTones = intervals.map((degOff) => {
      const deg = rootDeg + degOff
      const intervalsMode = MODE_INTERVALS[genome.scale.mode]
      const octBoost = Math.floor(deg / intervalsMode.length)
      const d = ((deg % intervalsMode.length) + intervalsMode.length) % intervalsMode.length
      return scaleDegreeNote(genome, d, 3 + octBoost)
    })
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
  return tokens.join(' ')
}

function layerOn(
  genome: MusicGenome,
  layer: keyof MusicGenome['activeLayers'],
  mutes?: LayerMutes,
): boolean {
  if (!genome.activeLayers[layer]) return false
  if (mutes?.[layer]) return false
  return true
}

/**
 * Compile a MusicGenome into executable Strudel code.
 * THIS IS THE ONLY MODULE THAT KNOWS STRUDEL SYNTAX.
 */
export function compileGenome(genome: MusicGenome, mutes?: LayerMutes): string {
  const cps = genome.tempo / 60 / 4
  const layers: string[] = []

  if (layerOn(genome, 'drums', mutes)) {
    const kick = boolToMini(genome.drums.kick, 'bd')
    const snare = boolToMini(genome.drums.snare, 'sd')
    const hihat = boolToMini(genome.drums.hihat, 'hh')
    layers.push(`  s("${kick}")`)
    layers.push(`  s("${snare}")`)
    layers.push(`  s("${hihat}").gain(0.55)`)
  }

  if (layerOn(genome, 'bass', mutes)) {
    const mini = notesToMini(genome, genome.bass.notes, genome.bass.octave)
    layers.push(`  note("${mini}").sound("sawtooth").lpf(800).gain(0.7)`)
  }

  if (layerOn(genome, 'melody', mutes)) {
    const mini = notesToMini(genome, genome.melody.notes, genome.melody.octave)
    layers.push(`  note("${mini}").sound("triangle").gain(0.55)`)
  }

  if (layerOn(genome, 'chords', mutes)) {
    const mini = chordNotesMini(genome)
    layers.push(`  note("${mini}").sound("sawtooth").lpf(1200).gain(0.35).room(0.3)`)
  }

  if (layers.length === 0) {
    layers.push(`  s("~")`)
  }

  const swing = genome.parameters.swing
  let body = `stack(\n${layers.join(',\n')}\n)`
  if (swing > 0.01) {
    body = `${body}.swingBy(${swing.toFixed(3)}, 16)`
  }

  return `setcps(${cps.toFixed(5)})\n${body}`
}

/** Human-readable one-line summary for the UI. */
export function summarizeGenome(genome: MusicGenome): string {
  const layers = Object.entries(genome.activeLayers)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join('+')
  return `${genome.tempo}bpm ${NOTE_NAMES[genome.scale.root]}${genome.scale.mode} [${layers}] ${genome.bars}bars×${genome.stepsPerBar}`
}
