/**
 * The shared compositional context: what every part is doing at every step of the loop, so a
 * generator can write its part against the others instead of next to them. Built from a genome:
 * the chord and its tones per bar, harmonic tension per bar, kick and snare positions and the
 * groove's accents, where the melody attacks and where it is still sounding, where the bass and
 * the chord stabs play.
 */
import type { MusicGenome, NoteLayer } from './genome'
import { barChordTones, barChords } from './harmony'
import { accentAt, getStyle } from './styles'
import { degreeToMidi, scaleLength } from './theory'

/**
 * Length in steps of each onset of a line: a share (`gate`) of the gap to the next onset, at
 * least one step; one step everywhere without a gate (the original behaviour). The last note's
 * gap runs to the end of the loop.
 */
export function noteHolds(notes: readonly (number | null)[], gate: number | undefined): number[] {
  const out = notes.map(() => 1)
  if (gate === undefined || gate <= 0) return out
  let next = notes.length
  for (let i = notes.length - 1; i >= 0; i--) {
    if (notes[i] === null || notes[i] === undefined) continue
    out[i] = Math.max(1, Math.round((next - i) * Math.min(1, gate)))
    next = i
  }
  return out
}

/** The degree sounding at each step (onsets held for their length), or null. */
export function soundingLine(layer: Pick<NoteLayer, 'notes' | 'gate'>): (number | null)[] {
  const holds = noteHolds(layer.notes, layer.gate)
  const out: (number | null)[] = layer.notes.map(() => null)
  layer.notes.forEach((d, i) => {
    if (d === null) return
    for (let k = 0; k < holds[i]! && i + k < out.length; k++) out[i + k] = d
  })
  return out
}

/** How far each bar's chord is from rest (0 tonic … ~1 dominant), from its function in the key. */
export function barTension(g: Pick<MusicGenome, 'scale' | 'chords' | 'bars' | 'genre'>): number[] {
  const len = scaleLength(g.scale.mode)
  // Pentatonic degrees name the parent major scale's I ii iii V vi
  const parent = (d: number) => (len === 5 ? [0, 1, 2, 4, 5][((d % 5) + 5) % 5]! : ((d % 7) + 7) % 7)
  const BY_DEGREE = [0.05, 0.5, 0.3, 0.45, 0.8, 0.3, 0.75]
  const chords = barChords(g)
  return chords.map((c, bar) => {
    let t = BY_DEGREE[parent(g.chords.progression[bar] ?? 0)] ?? 0.4
    if (/^7|^9|^13/.test(c.type) && t < 0.8) t += 0.25 // a dominant colour leans on what follows
    if (c.type.includes('sus')) t += 0.1
    return Math.min(1, t)
  })
}

export interface CompositionContext {
  genome: MusicGenome
  stepsPerBar: number
  steps: number
  scaleLength: number
  /** Chord-tone degrees (mod scale length) per bar. */
  chordTones: Set<number>[]
  /** Root degree per bar. */
  roots: number[]
  tension: number[]
  kick: boolean[]
  snare: boolean[]
  /** Groove weight per step: kick and snare hits weighted by the genre's accents (0–2). */
  drumWeight: number[]
  melodyOnset: boolean[]
  /** Degree of the melody sounding at each step, held notes included. */
  melodySounding: (number | null)[]
  bassOnset: boolean[]
  chordHit: boolean[]
}

export function compositionContext(g: MusicGenome): CompositionContext {
  const spb = g.stepsPerBar
  const n = spb * g.bars
  const style = getStyle(g.genre)
  const drumsOn = g.activeLayers.drums
  const kick = drumsOn ? g.drums.kick : g.drums.kick.map(() => false)
  const snare = drumsOn ? g.drums.snare : g.drums.snare.map(() => false)
  const melodyOn = g.activeLayers.melody
  return {
    genome: g,
    stepsPerBar: spb,
    steps: n,
    scaleLength: scaleLength(g.scale.mode),
    chordTones: barChordTones(g),
    roots: Array.from({ length: g.bars }, (_, b) => g.chords.progression[b] ?? 0),
    tension: barTension(g),
    kick,
    snare,
    drumWeight: Array.from(
      { length: n },
      (_, i) =>
        (kick[i] ? accentAt(style.groove.kick, i, spb) || 0.6 : 0) + (snare[i] ? accentAt(style.groove.snare, i, spb) || 0.3 : 0),
    ),
    melodyOnset: g.melody.notes.map((d) => melodyOn && d !== null),
    melodySounding: melodyOn ? soundingLine(g.melody) : g.melody.notes.map(() => null),
    bassOnset: g.bass.notes.map((d) => g.activeLayers.bass && d !== null),
    chordHit: g.chords.rhythm.map((h) => g.activeLayers.chords && h),
  }
}

/** MIDI pitch of a line's degree at an octave. */
export function midiOf(g: Pick<MusicGenome, 'scale'>, degree: number, octave: number): number {
  return degreeToMidi(g.scale, degree, octave)
}
