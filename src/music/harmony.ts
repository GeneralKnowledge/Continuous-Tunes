/**
 * Harmony of a genome: the chord each bar plays, in the genome's genre language, and how the
 * chord layer voices them. Shared by the compiler, the fitness and the composers, so they all
 * hear the same chords.
 */
import { SCALE_DEGREE_MAX, SCALE_DEGREE_MIN, type MusicGenome } from './genome'
import { getStyle, type GenreStyle } from './styles'
import {
  chordPcs,
  chordToneDegrees,
  degreePc,
  degreeToMidi,
  diatonicChord,
  scaleLength,
  triadType,
  voiceLead,
  type ChordSpec,
} from './theory'

export interface BarChord extends ChordSpec {
  /** Root scale degree. */
  degree: number
}

type Harmonic = Pick<MusicGenome, 'scale' | 'chords' | 'bars' | 'genre'>

/** The chord on a root degree in a genre's language, for a voicing gene and an optional colour. */
export function chordOn(
  g: Pick<MusicGenome, 'scale' | 'genre'>,
  degree: number,
  voicing: MusicGenome['chords']['voicing'],
  color?: string | null,
): BarChord {
  const { root, family } = diatonicChord(g.scale, degree)
  const style = getStyle(g.genre)
  if (color) return { root, type: color, family, degree }
  if (voicing === 'power') return { root, type: '5', family, degree }
  // The genre's colour, unless it adds a tone outside the key (a 9th on a phrygian iii):
  // then the plainer chord, then the triad
  const choices =
    voicing === 'triad'
      ? [style.harmony.plain?.[family], triadType(family)]
      : [style.harmony.rich[family], style.harmony.plain?.[family], triadType(family)]
  const pcs = harmonyPcs(g.scale)
  const type =
    choices.find((t): t is string => t !== undefined && chordPcs({ root, type: t, family }).every((pc) => pcs.has(pc))) ??
    triadType(family)
  return { root, type, family, degree }
}

/** Pitch classes the key's chords may use (a pentatonic scale's parent major scale). */
function harmonyPcs(scale: MusicGenome['scale']): Set<number> {
  const parent = scale.mode === 'pentatonic' ? { ...scale, mode: 'major' as const } : scale
  return new Set(Array.from({ length: 7 }, (_, d) => degreePc(parent, d)))
}

/** The chord of each bar. */
export function barChords(g: Harmonic): BarChord[] {
  return Array.from({ length: g.bars }, (_, bar) =>
    chordOn(g, g.chords.progression[bar] ?? 0, g.chords.voicing, g.chords.colors?.[bar]),
  )
}

const voicingCache = new Map<string, number[][]>()

/** MIDI voicings of the chord layer, one per bar, voice-led through the progression. */
export function chordVoicings(g: Harmonic, style: GenreStyle = getStyle(g.genre)): number[][] {
  const chords = barChords(g)
  const key = JSON.stringify([g.scale, g.genre ?? '', g.chords.voicing, chords.map((c) => [c.root, c.type])])
  const cached = voicingCache.get(key)
  if (cached) return cached
  const h = style.harmony
  let out: number[][]
  if (h.voicing === 'root' || g.chords.voicing === 'power') {
    // Root position from the root's octave-3 position (the original voicing)
    out = chords.map((c) => rootPosition(g, c.degree, g.chords.voicing))
  } else {
    // Lead from the end of the loop back round, so the loop's join is smooth too
    const twice = voiceLead([...chords, ...chords], { kind: h.voicing, range: h.range, maxTones: h.maxTones })
    out = twice.slice(chords.length)
  }
  if (voicingCache.size > 500) voicingCache.clear()
  voicingCache.set(key, out)
  return out
}

/** The original voicing: stacked scale thirds from the root at octave 3. */
function rootPosition(g: Pick<MusicGenome, 'scale'>, degree: number, voicing: MusicGenome['chords']['voicing']): number[] {
  const offsets = voicing === 'seventh' ? [0, 2, 4, 6] : voicing === 'power' ? [0, 4] : [0, 2, 4]
  return offsets.map((o) => scaleDegreeMidi(g, degree + o, 3))
}

function scaleDegreeMidi(g: Pick<MusicGenome, 'scale'>, degree: number, octave: number): number {
  return degreeToMidi(g.scale, degree, octave)
}

/** Scale degrees (mod scale length) that sound in each bar's chord, extensions included. */
export function barChordTones(g: Harmonic): Set<number>[] {
  return barChords(g).map((c) => chordToneDegrees(g.scale, c))
}

/** Chord-tone degrees of one bar, nearest first to a reference degree, across octaves. */
export function chordTonesNear(g: Harmonic, bar: number, near: number, span = 7): number[] {
  const tones = barChordTones(g)[bar % g.bars]!
  const len = scaleLength(g.scale.mode)
  const out: number[] = []
  const lo = Math.max(SCALE_DEGREE_MIN, near - span)
  const hi = Math.min(SCALE_DEGREE_MAX, near + span)
  for (let d = lo; d <= hi; d++) if (tones.has(((d % len) + len) % len)) out.push(d)
  return out.sort((a, b) => Math.abs(a - near) - Math.abs(b - near))
}

/** Pitch classes of each bar's chord. */
export function barPcs(g: Harmonic): number[][] {
  return barChords(g).map(chordPcs)
}
