/**
 * The music-theory layer: a thin wrapper over Tonal (scales, chords, chord types, voicing search)
 * and MusicTheoryJS (voice-leading cost and parallels, Euclidean rhythms, arpeggio contours,
 * motif transforms). The rest of Continuous-Tunes talks to these functions, in scale degrees and
 * MIDI numbers, and never imports either library directly.
 */
import { Chord, ChordType, Interval, Mode, Scale as TonalScale, Voicing } from 'tonal'
import {
  arpeggiate,
  diatonicSequence,
  euclideanRhythm,
  findParallels,
  invertMelody,
  melody as mtMelody,
  Note as MtNote,
  rotateRhythm,
  voiceLeadingCost,
} from 'musictheoryjs'
import type { Scale, ScaleMode } from './genome'

// ─── Scales ─────────────────────────────────────────────────────────

/** Tonal scale names for the genome's modes. */
const TONAL_SCALE: Record<ScaleMode, string> = {
  major: 'major',
  minor: 'aeolian',
  dorian: 'dorian',
  mixolydian: 'mixolydian',
  pentatonic: 'major pentatonic',
  phrygian: 'phrygian',
}

/** MusicTheoryJS scale template names for the genome's modes. */
const MTJS_SCALE: Record<ScaleMode, string> = {
  major: 'major',
  minor: 'minor',
  dorian: 'dorian',
  mixolydian: 'mixolydian',
  pentatonic: 'majorPentatonic',
  phrygian: 'phrygian',
}

/** The seven-note mode a mode is harmonised in (pentatonic borrows its parent major scale). */
const HARMONY_MODE: Record<ScaleMode, string> = {
  major: 'ionian',
  minor: 'aeolian',
  dorian: 'dorian',
  mixolydian: 'mixolydian',
  pentatonic: 'ionian',
  phrygian: 'phrygian',
}

const intervalCache = new Map<ScaleMode, number[]>()

/** Semitones above the root for each degree of a mode, from Tonal. */
export function modeIntervals(mode: ScaleMode): number[] {
  let out = intervalCache.get(mode)
  if (!out) {
    out = TonalScale.get(`C ${TONAL_SCALE[mode]}`).intervals.map((i) => Interval.semitones(i) ?? 0)
    intervalCache.set(mode, out)
  }
  return out
}

export function scaleLength(mode: ScaleMode): number {
  return modeIntervals(mode).length
}

/**
 * Scale degree → MIDI note. Degrees past the end of the scale (or below 0) move by octaves,
 * so a line always ascends with its degrees. `octave` uses Strudel's numbering (c4 = MIDI 60).
 */
export function degreeToMidi(scale: Scale, degree: number, octave: number): number {
  const intervals = modeIntervals(scale.mode)
  const len = intervals.length
  const idx = ((degree % len) + len) % len
  const shift = Math.floor(degree / len)
  return 12 + scale.root + intervals[idx]! + 12 * (octave + shift)
}

/** Pitch class (0–11) of a scale degree. */
export function degreePc(scale: Scale, degree: number): number {
  return degreeToMidi(scale, degree, 4) % 12
}

/** The scale degree whose pitch is exactly `midi`, or null when it is out of the scale. */
export function midiToDegree(scale: Scale, midi: number, octave: number): number | null {
  const len = scaleLength(scale.mode)
  const guess = Math.round(((midi - degreeToMidi(scale, 0, octave)) * len) / 12)
  for (let d = guess - 3; d <= guess + 3; d++) if (degreeToMidi(scale, d, octave) === midi) return d
  return null
}

// ─── Chords ─────────────────────────────────────────────────────────

/** What a diatonic chord is, harmonically, before a genre colours it. */
export type ChordFamily = 'major' | 'minor' | 'dominant' | 'halfdim' | 'dim'

export interface ChordSpec {
  /** Root pitch class 0–11. */
  root: number
  /** Tonal chord type name or alias ("m9", "maj7", "7sus4", "5"). */
  type: string
  family: ChordFamily
}

const FAMILY_OF_TYPE: Record<string, ChordFamily> = {
  'major seventh': 'major',
  'minor seventh': 'minor',
  'dominant seventh': 'dominant',
  'half-diminished': 'halfdim',
  'diminished seventh': 'dim',
  'minor/major seventh': 'minor',
}

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** True for any chord type Tonal knows ("m9", "maj7", "7sus4", "5", …). */
export function isChordType(type: string): boolean {
  return !ChordType.get(type).empty
}

/** Semitones of a chord type above its root, from Tonal. */
const typeIntervalCache = new Map<string, number[]>()

export function chordTypeIntervals(type: string): number[] {
  let out = typeIntervalCache.get(type)
  if (!out) {
    const t = ChordType.get(type)
    if (t.empty) throw new Error(`Unknown chord type: ${type}`)
    out = t.intervals.map((i) => Interval.semitones(i) ?? 0)
    typeIntervalCache.set(type, out)
  }
  return out
}

/** The diatonic seventh chord on a degree, as a Tonal symbol ("Fm7", "AbMaj7"). */
function diatonicSeventh(scale: Scale, degree: number): string {
  const len = scaleLength(scale.mode)
  const parentDegree =
    scale.mode === 'pentatonic' ? [0, 1, 2, 4, 5][((degree % len) + len) % len]! : ((degree % 7) + 7) % 7
  return Mode.seventhChords(HARMONY_MODE[scale.mode], PC_NAMES[scale.root]!)[parentDegree]!
}

/** The diatonic chord on a scale degree: its root and family (from Tonal's mode harmonisation). */
const familyCache = new Map<string, ChordFamily>()

export function diatonicChord(scale: Scale, degree: number): { root: number; family: ChordFamily } {
  const key = `${scale.root} ${scale.mode} ${degree}`
  let family = familyCache.get(key)
  if (!family) {
    family = FAMILY_OF_TYPE[Chord.get(diatonicSeventh(scale, degree)).type] ?? 'major'
    familyCache.set(key, family)
  }
  return { root: degreePc(scale, degree), family }
}

/** Plain triad type for a family. */
export function triadType(family: ChordFamily): string {
  return family === 'minor' ? 'm' : family === 'halfdim' || family === 'dim' ? 'dim' : 'M'
}

/**
 * Whether a chord type keeps a family's quality: a minor chord stays minor (m7, m9, madd9),
 * a major one major (maj7, add9, 6), and suspensions (no third) suit either. A dominant
 * seventh ("7") is allowed on anything: that is how a secondary dominant is made.
 */
export function colorFits(family: ChordFamily, type: string): boolean {
  const ivs = chordTypeIntervals(type).map((i) => i % 12)
  if (type === '7') return true
  const minor = ivs.includes(3)
  const major = ivs.includes(4)
  if (!minor && !major) return family !== 'dim' && family !== 'halfdim'
  if (family === 'minor') return minor && !ivs.includes(6)
  if (family === 'major' || family === 'dominant') return major
  return minor
}

/** Pitch classes of a chord. */
export function chordPcs(chord: ChordSpec): number[] {
  return chordTypeIntervals(chord.type).map((i) => (chord.root + i) % 12)
}

/** Scale degrees (0…len-1) whose pitch class belongs to the chord. */
export function chordToneDegrees(scale: Scale, chord: ChordSpec): Set<number> {
  const pcs = new Set(chordPcs(chord))
  const len = scaleLength(scale.mode)
  const out = new Set<number>()
  for (let d = 0; d < len; d++) if (pcs.has(degreePc(scale, d))) out.add(d)
  return out
}

/** Chord symbol for display and tests ("Fm9"). */
export function chordSymbol(chord: ChordSpec): string {
  return `${PC_NAMES[chord.root]}${chord.type === 'M' ? '' : chord.type}`
}

/** Tonal's reading of a set of MIDI notes ("Fm9", "Ab6/F"…), for tests and analysis. */
export function detectChord(midis: readonly number[]): string[] {
  return Chord.detect(midis.map((m) => PC_NAMES[m % 12]!))
}

// ─── Voicing and voice leading ──────────────────────────────────────

export type VoicingKind = 'root' | 'close' | 'rootless' | 'open' | 'power'

export interface VoicingOptions {
  kind: VoicingKind
  /** Lowest and highest MIDI note. */
  range: readonly [number, number]
  /** Most tones in a voicing (fifths go first, then the root for rootless voicings). */
  maxTones: number
}

/** The chord's intervals thinned to `maxTones`: drop the fifth, then (rootless) the root, then top tensions. */
function voicingIntervals(type: string, kind: VoicingKind, maxTones: number): number[] {
  let ivs = chordTypeIntervals(type).map((i) => i % 24)
  if (kind === 'power') return [0, 7]
  const drop = (pred: (i: number) => boolean) => {
    const idx = ivs.findIndex(pred)
    if (idx >= 0) ivs = ivs.filter((_, k) => k !== idx)
  }
  if (kind === 'rootless' && ivs.length >= 4) drop((i) => i === 0)
  if (ivs.length > maxTones) drop((i) => i === 7)
  while (ivs.length > maxTones) ivs = ivs.slice(0, -1)
  return ivs
}

/** Tonal interval names for semitone counts (within two octaves). */
const IV_NAMES = ['1P', '2m', '2M', '3m', '3M', '4P', '5d', '5P', '6m', '6M', '7m', '7M']
function ivName(semis: number): string {
  const octave = Math.floor(semis / 12)
  const base = IV_NAMES[semis % 12]!
  if (octave === 0) return base
  const n = Number.parseInt(base, 10) + 7 * octave
  return `${n}${base.slice(-1)}`
}

/**
 * Every voicing of a chord inside the range: each rotation of its (thinned) tones stacked
 * upwards, plus a spread version for open voicings. Tonal's Voicing.search places the shapes.
 */
export function voicingCandidates(chord: ChordSpec, opts: VoicingOptions): number[][] {
  const ivs = voicingIntervals(chord.type, opts.kind, opts.maxTones)
  const pcs = [...new Set(ivs.map((i) => i % 12))].sort((a, b) => a - b)
  const shapes: number[][] = []
  for (let r = 0; r < pcs.length; r++) {
    // Rotation r: start on tone r, every next tone the first one above
    const shape: number[] = []
    for (let k = 0; k < pcs.length; k++) {
      const pc = pcs[(r + k) % pcs.length]!
      const prev = shape[shape.length - 1]
      let v = pc
      while (prev !== undefined && v <= prev) v += 12
      shape.push(v)
    }
    shapes.push(shape)
    if (opts.kind === 'open' && shape.length >= 3) {
      // Drop the second-highest voice an octave (drop-2)
      const d2 = [...shape]
      d2[d2.length - 2]! -= 12
      d2.sort((a, b) => a - b)
      if (d2[0]! >= 0) shapes.push(d2)
      else shapes.push(d2.map((x) => x + 12))
    }
  }
  if (opts.kind === 'root') shapes.splice(1)
  const dict: Record<string, string[]> = {}
  const name = ChordType.get(chord.type).aliases[0] ?? chord.type
  dict[name] = shapes.map((s) => s.map((x) => ivName(x - s[0]! + s[0]!)).join(' '))
  const lo = opts.range[0]
  const hi = opts.range[1]
  const symbol = `${PC_NAMES[chord.root]}${name}`
  const found = Voicing.search(symbol, [midiName(lo), midiName(hi)], dict)
  const out = found.map((v) => v.map(noteMidi)).filter((v) => v.every((m) => m >= lo && m <= hi))
  return out.length > 0 ? out : [shapes[0]!.map((x) => x + chord.root + 12 * Math.ceil((lo - chord.root) / 12))]
}

function midiName(m: number): string {
  return `${PC_NAMES[m % 12]}${Math.floor(m / 12) - 1}`
}

function noteMidi(name: string): number {
  return MtNote.from(name).midi
}

/** Motion cost between two voicings: MusicTheoryJS's cost when sizes match, else a nearest-tone sum. */
function motion(a: readonly number[], b: readonly number[]): number {
  if (a.length === b.length) return voiceLeadingCost(a.map(midiName), b.map(midiName))
  return b.reduce((sum, n) => sum + Math.min(...a.map((m) => Math.abs(m - n))), 0)
}

/**
 * Voice a progression: the first chord sits near the middle of the range, each next one moves
 * as little as possible, avoids parallel fifths and octaves (MusicTheoryJS), and keeps the top
 * voice from leaping.
 */
export function voiceLead(chords: readonly ChordSpec[], opts: VoicingOptions): number[][] {
  const out: number[][] = []
  const centre = (opts.range[0] + opts.range[1]) / 2
  for (const chord of chords) {
    const candidates = voicingCandidates(chord, opts)
    const prev = out[out.length - 1]
    let best = candidates[0]!
    let bestCost = Number.POSITIVE_INFINITY
    for (const c of candidates) {
      const mid = (c[0]! + c[c.length - 1]!) / 2
      let cost = Math.abs(mid - centre) * (prev ? 0.15 : 1)
      if (prev) {
        cost += motion(prev, c)
        cost += 0.5 * Math.abs(c[c.length - 1]! - prev[prev.length - 1]!)
        if (c.length === prev.length && findParallels(prev.map(midiName), c.map(midiName)).length > 0) cost += 6
      }
      if (cost < bestCost) {
        best = c
        bestCost = cost
      }
    }
    out.push(best)
  }
  return out
}

// ─── Rhythm ─────────────────────────────────────────────────────────

/** A Euclidean rhythm (MusicTheoryJS): `pulses` onsets spread over `steps`, rotated. */
export function euclid(pulses: number, steps: number, rotation = 0): boolean[] {
  const r = euclideanRhythm(steps, Math.max(0, Math.min(steps, pulses)))
  return (rotation ? rotateRhythm(r, rotation) : r).map((x) => x === 1)
}

// ─── Arpeggios ──────────────────────────────────────────────────────

export type ArpContour = 'up' | 'down' | 'updown' | 'downup'

/**
 * Chord-tone indices for an arpeggio contour over `tones` chord tones and `octaves` octaves,
 * `notes` long (MusicTheoryJS's arpeggiate turns the figure without repeating endpoints).
 */
export function arpIndices(contour: ArpContour, tones: number, octaves: number, notes: number): number[] {
  // Arpeggiate a stand-in chord whose MIDI numbers are the indices themselves
  const stand = Array.from({ length: tones }, (_, i) => midiName(60 + i))
  const events = arpeggiate(stand, { pattern: contour, octaves: 1, notes: notes * 4 })
  const span = tones * octaves
  const seq: number[] = []
  // Extend over octaves: walk the stand-in contour across the whole span
  const full = Array.from({ length: span }, (_, i) => midiName(60 + i))
  const ev = octaves > 1 ? arpeggiate(full, { pattern: contour, notes }) : events.slice(0, notes)
  for (const e of ev) seq.push(e.pitch.midi - 60)
  return seq.slice(0, notes)
}

// ─── Motifs ─────────────────────────────────────────────────────────

/** The genome scale as a MusicTheoryJS scale string. */
function mtScale(scale: Scale): string {
  return `${PC_NAMES[scale.root]}4 ${MTJS_SCALE[scale.mode]}`
}

/**
 * Mirror a line of degrees around an axis degree, diatonically (MusicTheoryJS invertMelody):
 * rising steps become falling steps, and every note stays in the scale. Rests stay rests.
 */
export function invertDegrees(scale: Scale, degrees: readonly (number | null)[], axis: number): (number | null)[] {
  const notes = degrees.filter((d): d is number => d !== null)
  if (notes.length === 0) return [...degrees]
  const line = mtMelody(
    notes.map((d) => midiName(degreeToMidi(scale, d, 4))),
    'q',
  )
  const inverted = invertMelody(line, midiName(degreeToMidi(scale, axis, 4)), mtScale(scale))
  let k = 0
  return degrees.map((d) => {
    if (d === null) return null
    const m = inverted[k++]!.pitch.midi
    return midiToDegree(scale, m, 4) ?? d
  })
}

/**
 * Restate a line of degrees `steps` scale degrees higher or lower (MusicTheoryJS
 * diatonicSequence), the way a sequence moves a motif through the scale. Rests stay rests.
 */
export function sequenceDegrees(scale: Scale, degrees: readonly (number | null)[], steps: number): (number | null)[] {
  const notes = degrees.filter((d): d is number => d !== null)
  if (notes.length === 0 || steps === 0) return [...degrees]
  const line = mtMelody(
    notes.map((d) => midiName(degreeToMidi(scale, d, 4))),
    'q',
  )
  const seq = diatonicSequence(line, mtScale(scale), steps, { times: 2 })
  const moved = seq.slice(notes.length)
  let k = 0
  return degrees.map((d) => {
    if (d === null) return null
    const m = moved[k++]!.pitch.midi
    return midiToDegree(scale, m, 4) ?? d
  })
}
