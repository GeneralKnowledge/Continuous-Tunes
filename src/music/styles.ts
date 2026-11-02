/**
 * Genre styles: each genre's musical language, separate from its sounds (kits.ts) and its
 * evolution biases (personality.ts). A genome names its genre; the harmony, groove and
 * arrangement code read the rules from here.
 */
import type { ScaleMode } from './genome'
import type { ArpContour, ChordFamily, VoicingKind } from './theory'

export interface HarmonyLanguage {
  /** Chord type per diatonic family when the genome's voicing gene is "seventh" (the rich colour). */
  rich: Record<ChordFamily, string>
  /** Chord type per family for the "triad" gene; plain triads when missing. */
  plain?: Partial<Record<ChordFamily, string>>
  /** How the chord layer is voiced over the bass. */
  voicing: VoicingKind
  /** Range of the chord layer, MIDI. */
  range: readonly [number, number]
  maxTones: number
  /** Root degrees the genre's progressions live on, most idiomatic first. */
  vocabulary: readonly number[]
  /** Colours mutations may give one bar (secondary dominants, suspensions, borrowed chords). */
  colors: readonly string[]
  /** Modes the genre may move to. */
  modes: readonly ScaleMode[]
}

/** Velocity 0–1 for a hit on each 16th of the bar (index 0–15). */
export type Accents = readonly number[]

export interface Groove {
  kick: Accents
  snare: Accents
  hat: Accents
  perc: Accents
  /**
   * Micro-timing in fractions of a 16th: positive lays back (late), negative pushes.
   * Lo-fi drags its snare, house pushes nothing, everything else sits on the grid.
   */
  feel?: { snare?: number; hat?: number; perc?: number }
}

/** How the last bar of a section leads into the next one. */
export type FillKind = 'tom' | 'roll' | 'build' | 'riser' | 'stop' | 'edit'

export interface GenreStyle {
  id: string
  harmony: HarmonyLanguage
  groove: Groove
  /** How the bass relates to the kick: steer around it, sit on it, or neither. */
  bassKick: 'avoid' | 'lock' | 'free'
  /** Fill into a bigger section, and the ordinary turnaround fill. */
  fills: { lift: FillKind; turn: FillKind }
  /** Arpeggio contours the genre uses (mutations pick from these). */
  arpContours: readonly ArpContour[]
  /** Section roles whose chords play as held pads instead of the stab rhythm. */
  padRoles: readonly string[]
}

const ALL_MODES: readonly ScaleMode[] = ['major', 'minor', 'dorian', 'mixolydian', 'pentatonic', 'phrygian']

const even = (v: number): Accents => Array.from({ length: 16 }, () => v)
/** Accents from a string of digits 0–9 (9 = full), one per 16th. */
const acc = (s: string): Accents => [...s].map((c) => Number(c) / 9)

/** Old behaviour: diatonic triads and sevenths in root position, every hit at full velocity. */
export const DEFAULT_STYLE: GenreStyle = {
  id: 'default',
  harmony: {
    rich: { major: 'maj7', minor: 'm7', dominant: '7', halfdim: 'm7b5', dim: 'dim7' },
    voicing: 'root',
    range: [48, 72],
    maxTones: 4,
    vocabulary: [0, 1, 3, 4, 5],
    colors: ['sus4', 'sus2'],
    modes: ALL_MODES,
  },
  groove: { kick: even(1), snare: even(1), hat: even(1), perc: even(1) },
  bassKick: 'free',
  fills: { lift: 'roll', turn: 'tom' },
  arpContours: ['up', 'updown'],
  padRoles: [],
}

export const STYLES: Record<string, GenreStyle> = {
  default: DEFAULT_STYLE,
  // Deep house: minor 9ths and major 9ths as organ/piano stabs, a shuffling shaker,
  // open hats on the off-beat, clap on 2 and 4 with the odd ghost, bass between the kicks
  house: {
    id: 'house',
    harmony: {
      rich: { major: 'maj9', minor: 'm9', dominant: '9', halfdim: 'm7b5', dim: 'dim7' },
      plain: { major: 'maj7', minor: 'm7', dominant: '7' },
      voicing: 'rootless',
      range: [55, 76],
      maxTones: 4,
      vocabulary: [0, 3, 5, 6, 4, 2],
      colors: ['m11', '7sus4', 'maj7', 'm7', '6'],
      modes: ['dorian', 'minor', 'major', 'mixolydian'],
    },
    groove: {
      kick: acc('9000900090009000'),
      snare: acc('0000900300009003'),
      hat: acc('3060306030603066'),
      perc: acc('6375637563756375'),
    },
    bassKick: 'avoid',
    fills: { lift: 'roll', turn: 'edit' },
    arpContours: ['up', 'updown'],
    padRoles: ['breakdown', 'intro'],
  },
  // Minimal / dub techno: one minor-seventh chord shape moved around, echoing stabs,
  // rimshots off the beat, a sub bass that stays out of the kick's way
  minimal: {
    id: 'minimal',
    harmony: {
      rich: { major: 'maj7', minor: 'm7', dominant: '7sus4', halfdim: 'm7b5', dim: 'dim7' },
      plain: { minor: 'm', major: 'M', dominant: 'sus4' },
      voicing: 'close',
      range: [55, 72],
      maxTones: 4,
      vocabulary: [0, 5, 3, 6],
      colors: ['m7', 'm11', '7sus4'],
      modes: ['minor', 'dorian', 'phrygian'],
    },
    groove: {
      kick: acc('9000900090009000'),
      snare: acc('0007000000700700'),
      hat: acc('2252225222522252'),
      perc: acc('0040004000400040'),
    },
    bassKick: 'avoid',
    fills: { lift: 'roll', turn: 'edit' },
    arpContours: ['up'],
    padRoles: ['breakdown'],
  },
  // Electro / acid: plain sevenths, an arp-driven lead, straight 808s
  electronic: {
    id: 'electronic',
    harmony: {
      rich: { major: 'maj7', minor: 'm7', dominant: '7', halfdim: 'm7b5', dim: 'dim7' },
      voicing: 'close',
      range: [52, 72],
      maxTones: 4,
      vocabulary: [0, 5, 3, 4, 6, 2],
      colors: ['sus4', 'm9'],
      modes: ['minor', 'dorian', 'phrygian', 'mixolydian'],
    },
    groove: {
      kick: acc('9000900090009000'),
      snare: acc('0000900000009004'),
      hat: acc('7375737573757375'),
      perc: acc('0060000600600006'),
    },
    bassKick: 'free',
    fills: { lift: 'roll', turn: 'tom' },
    arpContours: ['up', 'updown', 'down'],
    padRoles: ['breakdown'],
  },
  // Ambient: wide-open ninths and elevenths moving slowly, everything soft
  ambient: {
    id: 'ambient',
    harmony: {
      rich: { major: 'maj9', minor: 'm11', dominant: '9sus4', halfdim: 'm7b5', dim: 'dim7' },
      plain: { major: 'add9', minor: 'madd9', dominant: 'sus2' },
      voicing: 'open',
      range: [48, 84],
      maxTones: 5,
      vocabulary: [0, 3, 5, 2, 4, 6],
      colors: ['sus2', 'add9', 'maj7', 'madd9', 'm11'],
      modes: ['dorian', 'major', 'minor', 'mixolydian', 'pentatonic'],
    },
    groove: {
      kick: acc('5000000000000000'),
      snare: acc('0000400000004000'),
      hat: acc('4020302040203020'),
      perc: acc('3000003000300000'),
    },
    bassKick: 'free',
    fills: { lift: 'riser', turn: 'riser' },
    arpContours: ['updown', 'up'],
    padRoles: ['intro', 'verse', 'peak', 'outro', 'breakdown'],
  },
  // Downtempo / trip hop: Rhodes-style rootless sevenths and ninths, a lazy swung beat
  downtempo: {
    id: 'downtempo',
    harmony: {
      rich: { major: 'maj9', minor: 'm9', dominant: '9', halfdim: 'm7b5', dim: 'dim7' },
      plain: { major: 'maj7', minor: 'm7', dominant: '7' },
      voicing: 'rootless',
      range: [52, 74],
      maxTones: 4,
      vocabulary: [0, 3, 4, 2, 5, 6],
      colors: ['m11', 'maj7', '9sus4', '6'],
      modes: ['dorian', 'minor', 'major'],
    },
    groove: {
      kick: acc('9000006090000000'),
      snare: acc('0000900200009003'),
      hat: acc('7342734273427342'),
      perc: acc('0000000400000040'),
      feel: { snare: 0.1 },
    },
    bassKick: 'lock',
    fills: { lift: 'roll', turn: 'stop' },
    arpContours: ['up', 'updown'],
    padRoles: ['intro'],
  },
  // Folk: open triads with the odd added ninth, a light acoustic groove
  folk: {
    id: 'folk',
    harmony: {
      rich: { major: 'add9', minor: 'm7', dominant: 'M', halfdim: 'dim', dim: 'dim' },
      voicing: 'close',
      range: [52, 72],
      maxTones: 4,
      vocabulary: [0, 3, 4, 5, 1],
      colors: ['sus4', 'sus2', 'add9'],
      modes: ['pentatonic', 'major', 'mixolydian', 'dorian'],
    },
    groove: {
      kick: acc('9000006000900000'),
      snare: acc('0000800000008000'),
      hat: acc('6363636363636363'),
      perc: acc('0050005000500050'),
    },
    bassKick: 'lock',
    fills: { lift: 'roll', turn: 'tom' },
    arpContours: ['updown', 'up'],
    padRoles: [],
  },
  // Lo-fi hip hop: jazzy ninths and thirteenths, a dragging snare, ghost notes,
  // hats that breathe, and the beat dropping out before a new section
  lofi: {
    id: 'lofi',
    harmony: {
      rich: { major: 'maj9', minor: 'm9', dominant: '13', halfdim: 'm7b5', dim: 'dim7' },
      plain: { major: 'maj7', minor: 'm7', dominant: '7' },
      voicing: 'rootless',
      range: [52, 72],
      maxTones: 4,
      vocabulary: [1, 4, 0, 5, 3, 2],
      colors: ['m7', 'maj7', '6', 'm11'],
      modes: ['major', 'dorian', 'minor'],
    },
    groove: {
      kick: acc('9000000700800000'),
      snare: acc('0000900300009002'),
      hat: acc('7350635073506350'),
      perc: acc('0000000000000000'),
      feel: { snare: 0.18, hat: 0.05 },
    },
    bassKick: 'lock',
    fills: { lift: 'stop', turn: 'stop' },
    arpContours: ['up'],
    padRoles: [],
  },
  // Liquid drum & bass: minor ninths on pads, a two-step with ghost snares rolling under it,
  // a sub that lands with the kick and moves in long notes
  dnb: {
    id: 'dnb',
    harmony: {
      rich: { major: 'maj9', minor: 'm9', dominant: '9sus4', halfdim: 'm7b5', dim: 'dim7' },
      plain: { major: 'maj7', minor: 'm7', dominant: '7sus4' },
      voicing: 'open',
      range: [55, 79],
      maxTones: 4,
      vocabulary: [0, 5, 3, 6, 2, 4],
      colors: ['m11', 'maj7', '9sus4', 'add9'],
      modes: ['minor', 'dorian'],
    },
    groove: {
      kick: acc('9000000000900000'),
      snare: acc('0000900300039003'),
      hat: acc('6353635363536353'),
      perc: acc('5000500050005000'),
    },
    bassKick: 'lock',
    fills: { lift: 'build', turn: 'edit' },
    arpContours: ['up', 'updown'],
    padRoles: ['intro', 'breakdown'],
  },
  // Trance: big open triads and suspensions, an off-beat rolling bass, a 16th arp,
  // off-beat open hats over 16th closed hats, long builds into the drop
  trance: {
    id: 'trance',
    harmony: {
      rich: { major: 'add9', minor: 'madd9', dominant: 'sus4', halfdim: 'dim', dim: 'dim' },
      plain: { major: 'M', minor: 'm', dominant: 'M' },
      voicing: 'open',
      range: [52, 79],
      maxTones: 4,
      vocabulary: [0, 5, 2, 6, 3, 4],
      colors: ['sus2', 'sus4', 'add9', 'madd9'],
      modes: ['minor', 'phrygian', 'dorian'],
    },
    groove: {
      kick: acc('9000900090009000'),
      snare: acc('0000900000009000'),
      hat: acc('0090009000900090'),
      perc: acc('6363636363636364'),
    },
    bassKick: 'avoid',
    fills: { lift: 'build', turn: 'roll' },
    arpContours: ['up', 'updown', 'downup'],
    padRoles: ['breakdown', 'intro'],
  },
}

export function getStyle(id: string | undefined): GenreStyle {
  return (id !== undefined ? STYLES[id] : undefined) ?? DEFAULT_STYLE
}

/** Accent for a step on any grid: 8-step grids read every other 16th. */
export function accentAt(accents: Accents, step: number, stepsPerBar: number): number {
  const s = step % stepsPerBar
  return accents[Math.round((s * 16) / stepsPerBar) % 16] ?? 1
}
