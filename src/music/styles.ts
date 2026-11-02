/**
 * Genre styles: each genre's musical language, separate from its sounds (kits.ts) and its
 * evolution biases (personality.ts). A genome names its genre; the harmony, groove and
 * arrangement code read the rules from here.
 */
import type { PatternGene, ScaleMode } from './genome'
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

/** How the genre develops its theme across a song's sections (see arrange.ts). */
export interface ArrangeProfile {
  /** What the breakdown does with the melody: slow it down (augmentation), lift it an octave, or keep it. */
  breakdownMelody: 'augment' | 'octave' | 'keep'
  /** Builds lose the bass: the subtraction that makes the drop land. */
  buildWithoutBass: boolean
  /** Section roles that bring in the counter-melody, and from which appearance (1 = first). */
  counterRoles: readonly string[]
  counterFrom: number
  /** Pattern genes added to every section of a role (on top of the genome's own). */
  roleGenes: Readonly<Partial<Record<string, readonly PatternGene[]>>>
  /** Genes added to a role's second and later appearances, so a repeat isn't a copy. */
  repeatGenes: readonly PatternGene[]
}

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
  /**
   * The genre's bass vocabulary: one-bar figures (see composeBass) that phrase variations draw
   * on, like a bass player's licks for the style.
   */
  bassFigures: readonly string[]
  /** Note lengths the genre's parts live in (gate ranges, 0 = one step, 1 = legato). */
  gates: { bass: readonly [number, number]; melody: readonly [number, number]; chords?: readonly [number, number] }
  /** Pattern genes (Tidal-style transforms) the genre's mutations may add. */
  genes: readonly PatternGene[]
  /** Counter-melody settings, or null for genres that keep one line. */
  counter: { minGap: number; density: number; reinforce: number; imitate: boolean; gate: number } | null
  arrange: ArrangeProfile
  /** Melody bars should share the motif's rhythm about this much (0–1), low to high. */
  motifIdentity: readonly [number, number]
}

const NO_ARRANGE: ArrangeProfile = {
  breakdownMelody: 'keep',
  buildWithoutBass: false,
  counterRoles: [],
  counterFrom: 1,
  roleGenes: {},
  repeatGenes: [],
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
  bassFigures: ['R---R---5---R---', 'R-------5-------'],
  gates: { bass: [0, 0.5], melody: [0, 0.6] },
  genes: [],
  counter: null,
  arrange: NO_ARRANGE,
  motifIdentity: [0.3, 0.9],
}

/** Shorthands for genes. */
const deg = (target: PatternGene['target'], amount: number, every?: number): PatternGene =>
  every ? { target, op: 'degrade', amount, every } : { target, op: 'degrade', amount }
const ply = (target: PatternGene['target'], amount: number, opts: { every?: number; chance?: number } = {}): PatternGene => ({
  target,
  op: 'ply',
  amount,
  ...opts,
})
const echo = (target: PatternGene['target'], steps: number, every?: number): PatternGene =>
  every ? { target, op: 'off', amount: steps, every } : { target, op: 'off', amount: steps }

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
    bassFigures: ['--R---Ro--R--5-A', '--R---R---o--3-A', '--R--R----R-o---', '--Ro--R---Ro--5-', '--R---5---R---oA'],
    gates: { bass: [0.3, 0.6], melody: [0.4, 0.8], chords: [0.1, 0.35] },
    // A shaker that breathes, a clap flam into the turnaround, hats that open up now and then
    genes: [deg('perc', 0.12), ply('snare', 2, { every: 4, chance: 0.5 }), ply('hihat', 2, { every: 8, chance: 0.3 }), echo('chords', 3, 4)],
    counter: { density: 3, minGap: 4, reinforce: 0.25, imitate: true, gate: 0.7 },
    arrange: {
      breakdownMelody: 'octave',
      buildWithoutBass: false,
      counterRoles: ['drop'],
      counterFrom: 2,
      roleGenes: { intro: [deg('hihat', 0.3), deg('perc', 0.35)], build: [ply('hihat', 2, { every: 2 })], outro: [deg('perc', 0.3)] },
      repeatGenes: [ply('perc', 2, { every: 4, chance: 0.25 })],
    },
    motifIdentity: [0.45, 0.95],
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
    bassFigures: ['--R-----R-R-----', '--R-----R---o---', '--R---R-----R---', '------R---R---R-'],
    gates: { bass: [0.3, 0.7], melody: [0, 0.4], chords: [0.05, 0.2] },
    // Dub: stabs that echo back a dotted eighth later, rims and percussion that shift and thin
    genes: [echo('chords', 3), deg('perc', 0.2), deg('snare', 0.15), echo('arp', 6, 2)],
    counter: null,
    arrange: {
      breakdownMelody: 'keep',
      buildWithoutBass: false,
      counterRoles: [],
      counterFrom: 1,
      roleGenes: { intro: [deg('hihat', 0.35)], breakdown: [echo('chords', 6)], outro: [deg('hihat', 0.3), deg('perc', 0.4)] },
      repeatGenes: [deg('chords', 0.15)],
    },
    motifIdentity: [0.5, 1],
  },
  // Electro: plain sevenths, an arp-driven lead, a broken 808 beat (not four-on-the-floor)
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
    // Electro: a broken kick, accented 16th hats (loud on the beat, ghosts between), a cowbell off the beat
    groove: {
      kick: acc('9000008000800070'),
      snare: acc('0000900000009004'),
      hat: acc('8275827582758275'),
      perc: acc('0006000006000060'),
    },
    bassKick: 'free',
    fills: { lift: 'roll', turn: 'tom' },
    arpContours: ['up', 'updown', 'down'],
    padRoles: ['breakdown'],
    bassFigures: ['R-RoR-5-R-oRb-A-', 'R--oR-R-5--RoR-A', 'R-R-o-R-R-5-o-R-', 'RR-oR-5RR-o-R3-A'],
    gates: { bass: [0.2, 0.5], melody: [0.3, 0.7], chords: [0.1, 0.4] },
    // Electro: 16th hats with the odd ratchet, an acid line that sometimes doubles up
    genes: [ply('hihat', 2, { chance: 0.12 }), ply('bass', 2, { every: 4, chance: 0.2 }), echo('arp', 3), deg('perc', 0.15)],
    counter: { density: 2, minGap: 4, reinforce: 0.2, imitate: true, gate: 0.5 },
    arrange: {
      breakdownMelody: 'octave',
      buildWithoutBass: true,
      counterRoles: ['drop'],
      counterFrom: 2,
      roleGenes: { intro: [deg('hihat', 0.25)], build: [ply('snare', 2, { every: 2 })], outro: [deg('hihat', 0.3)] },
      repeatGenes: [ply('hihat', 2, { every: 4, chance: 0.3 })],
    },
    motifIdentity: [0.4, 0.95],
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
    bassFigures: ['R---------------', '--------5-------', 'R-------o-------'],
    gates: { bass: [0.85, 1], melody: [0.8, 1], chords: [0.9, 1] },
    // Space as a tool: twinkles that come and go, a bell that sometimes answers itself
    genes: [deg('arp', 0.4), deg('perc', 0.5), echo('melody', 6, 2)],
    counter: { density: 2, minGap: 8, reinforce: 0.1, imitate: true, gate: 1 },
    arrange: {
      breakdownMelody: 'augment',
      buildWithoutBass: false,
      counterRoles: ['peak'],
      counterFrom: 1,
      roleGenes: { intro: [deg('arp', 0.6)], outro: [deg('arp', 0.55), deg('melody', 0.3)] },
      repeatGenes: [deg('arp', 0.2)],
    },
    motifIdentity: [0.2, 0.8],
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
    bassFigures: ['R-----R-5-----A-', 'R-----R---3---A-', 'R-------R--5--A-', 'R--R-----5----o-'],
    gates: { bass: [0.6, 0.9], melody: [0.6, 0.95], chords: [0.5, 0.9] },
    genes: [deg('hihat', 0.1), deg('perc', 0.3), ply('hihat', 3, { every: 4, chance: 0.15 }), echo('melody', 3, 4)],
    counter: { density: 3, minGap: 4, reinforce: 0.3, imitate: true, gate: 0.85 },
    arrange: {
      breakdownMelody: 'augment',
      buildWithoutBass: false,
      counterRoles: ['chorus'],
      counterFrom: 2,
      roleGenes: { intro: [deg('hihat', 0.3)], outro: [deg('hihat', 0.25), deg('melody', 0.25)] },
      repeatGenes: [deg('perc', 0.15)],
    },
    motifIdentity: [0.35, 0.9],
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
    bassFigures: ['R-------5-------', 'R-------5-----A-', 'R---5---R---5---', 'R-------3---5-A-'],
    gates: { bass: [0.5, 0.85], melody: [0.6, 0.95] },
    genes: [deg('perc', 0.2), deg('hihat', 0.1)],
    counter: { density: 3, minGap: 4, reinforce: 0.35, imitate: true, gate: 0.85 },
    arrange: {
      breakdownMelody: 'keep',
      buildWithoutBass: false,
      counterRoles: ['chorus'],
      counterFrom: 1,
      roleGenes: { intro: [deg('hihat', 0.4)], outro: [deg('hihat', 0.3)] },
      repeatGenes: [],
    },
    motifIdentity: [0.45, 0.95],
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
    bassFigures: ['R------R--5---A-', 'R------R-3----A-', 'R-------R-5---A-', 'R--R----5-----A-', 'R------5--R---o-'],
    gates: { bass: [0.6, 0.9], melody: [0.5, 0.85], chords: [0.6, 0.95] },
    // Hats that breathe, the odd triplet hat roll, a kick that sometimes drops a hit
    genes: [deg('hihat', 0.1), ply('hihat', 3, { every: 2, chance: 0.12 }), deg('kick', 0.06), echo('melody', 3, 4)],
    counter: { density: 3, minGap: 4, reinforce: 0.2, imitate: true, gate: 0.8 },
    arrange: {
      breakdownMelody: 'keep',
      buildWithoutBass: false,
      counterRoles: ['chorus'],
      counterFrom: 2,
      roleGenes: { intro: [deg('hihat', 0.2)], outro: [deg('hihat', 0.3), deg('melody', 0.3)] },
      repeatGenes: [ply('hihat', 3, { every: 4, chance: 0.2 })],
    },
    motifIdentity: [0.35, 0.9],
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
    bassFigures: ['R---------R-----', 'R-----o---R---A-', 'R---------R--o--', 'R-------------A-', 'R-R-------R-----'],
    gates: { bass: [0.55, 1], melody: [0.5, 1], chords: [0.6, 1] },
    // Rolling: ghost snares that roll now and then, hats that skip, an arp that echoes
    genes: [ply('snare', 2, { chance: 0.12 }), deg('hihat', 0.1), ply('hihat', 2, { every: 4, chance: 0.3 }), echo('arp', 3)],
    counter: { density: 3, minGap: 4, reinforce: 0.2, imitate: true, gate: 0.9 },
    arrange: {
      breakdownMelody: 'octave',
      buildWithoutBass: true,
      counterRoles: ['drop'],
      counterFrom: 2,
      roleGenes: { intro: [deg('hihat', 0.25)], build: [ply('hihat', 2, { every: 2 })], outro: [deg('hihat', 0.3)] },
      repeatGenes: [ply('snare', 2, { every: 8, chance: 0.4 })],
    },
    motifIdentity: [0.3, 0.9],
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
    bassFigures: ['-RRo-RRo-RRo-RRA', '-R-o-R-o-R-o-R-A', '-RR--RR--RR--RRo', '-R-R-R-R-R-R-R-A'],
    gates: { bass: [0.4, 0.7], melody: [0.7, 1], chords: [0.9, 1] },
    // An arp answered by its own echo, a 16th line that rolls into the turnaround
    genes: [echo('arp', 3), deg('perc', 0.08), ply('snare', 2, { every: 8, chance: 0.5 }), echo('melody', 3, 2)],
    counter: { density: 4, minGap: 4, reinforce: 0.3, imitate: true, gate: 0.95 },
    arrange: {
      breakdownMelody: 'augment',
      buildWithoutBass: true,
      counterRoles: ['drop'],
      counterFrom: 1,
      roleGenes: { intro: [deg('perc', 0.3)], build: [ply('hihat', 2, { every: 2 }), ply('arp', 2, { every: 4 })], outro: [deg('arp', 0.3)] },
      repeatGenes: [echo('chords', 6, 4)],
    },
    motifIdentity: [0.5, 0.95],
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
