/**
 * Seed compositions: the musical idea each channel starts from. Each one is written as a piece:
 * a groove, a progression in the genre's harmonic language, a bassline built from a figure that
 * follows the chords and sits with (or around) the kick, a motif developed across the loop, and
 * for some genres an arpeggio. Evolution, contrast material and song sections develop them.
 */
import { emptyNotes, emptySteps, type MusicGenome } from './genome'
import { arpPattern, composeBass, hits } from './compose'
import { validateGenome } from './validation'
import type { ArpContour } from './theory'

function steps(spb: number, bars: number): number {
  return spb * bars
}

function pattern(template: string, len: number): boolean[] {
  const out: boolean[] = []
  for (let i = 0; i < len; i++) {
    const c = template[i % template.length]!
    out.push(c === 'x' || c === 'X')
  }
  return out
}

function notes(template: string, len: number): (number | null)[] {
  const tokens = template.trim().split(/\s+/)
  const out: (number | null)[] = []
  for (let i = 0; i < len; i++) {
    const t = tokens[i % tokens.length]!
    if (t === '-' || t === '~' || t === '.') {
      out.push(null)
    } else {
      out.push(Number.parseInt(t, 10))
    }
  }
  return out
}

/** One line from per-bar strings of 16 tokens (degree or `-`). */
function bars(...barStrings: string[]): (number | null)[] {
  return barStrings.flatMap((b) => {
    const t = b.trim().split(/\s+/)
    if (t.length !== 16) throw new Error(`seed bar needs 16 tokens, got ${t.length}: ${b}`)
    return t.map((x) => (x === '-' ? null : Number.parseInt(x, 10)))
  })
}

/** A drum line from per-bar templates (cycling over the loop). */
function drumLine(templates: readonly string[], spb: number, nBars: number): boolean[] {
  return Array.from({ length: nBars }, (_, b) => hits(templates[b % templates.length]!, spb, spb)).flat()
}

interface SeedSpec {
  genre: string
  tempo: number
  scale: MusicGenome['scale']
  bars: number
  progression: number[]
  voicing: MusicGenome['chords']['voicing']
  colors?: (string | null)[]
  /** One-bar chord rhythm templates, cycling. */
  chordRhythm: readonly string[]
  kick: readonly string[]
  snare: readonly string[]
  hat: readonly string[]
  perc?: readonly string[]
  /** Bass figures (see composeBass), one per bar, cycling; or written-out notes. */
  bass: readonly string[] | (number | null)[]
  bassOctave: number
  melody: (number | null)[] | null
  melodyOctave: number
  arp?: { contour: ArpContour; rhythm: string; octave: number; tones?: number; octaves?: number } | { pattern: (number | null)[]; octave: number }
  layers: { drums: boolean; bass: boolean; melody: boolean; chords: boolean; arp?: boolean }
  swing: number
}

function seed(spec: SeedSpec): MusicGenome {
  const spb = 16
  const n = steps(spb, spec.bars)
  const g: MusicGenome = {
    genre: spec.genre,
    tempo: spec.tempo,
    stepsPerBar: spb,
    bars: spec.bars,
    scale: spec.scale,
    drums: {
      kick: drumLine(spec.kick, spb, spec.bars),
      snare: drumLine(spec.snare, spb, spec.bars),
      hihat: drumLine(spec.hat, spb, spec.bars),
      perc: spec.perc ? drumLine(spec.perc, spb, spec.bars) : emptySteps(n),
    },
    bass: { notes: emptyNotes(n), octave: spec.bassOctave },
    melody: { notes: spec.melody ?? emptyNotes(n), octave: spec.melodyOctave },
    chords: {
      progression: spec.progression,
      voicing: spec.voicing,
      rhythm: drumLine(spec.chordRhythm, spb, spec.bars),
      ...(spec.colors ? { colors: spec.colors } : {}),
    },
    activeLayers: { ...spec.layers, arp: spec.layers.arp ?? false },
    parameters: { swing: spec.swing },
  }
  g.bass.notes =
    typeof spec.bass[0] === 'string' ? composeBass(g, spec.bass as readonly string[]) : (spec.bass as (number | null)[])
  if (spec.arp) {
    g.arp =
      'pattern' in spec.arp
        ? { pattern: spec.arp.pattern, octave: spec.arp.octave }
        : {
            pattern: arpPattern(g, spec.arp.contour, spec.arp.rhythm, spec.arp.tones ?? 4, spec.arp.octaves ?? 2),
            octave: spec.arp.octave,
          }
  } else {
    g.arp = { pattern: arpPattern(g, 'up', 'x-x-x-x-x-x-x-x-', 3, 2), octave: 4 }
  }
  return validateGenome(g)
}

// ─── Legacy generic seed (no genre: plays in the neutral default style) ──────

/** Sparse kick on downs — minimal seed. */
export function createMinimalSeed(): MusicGenome {
  const stepsPerBar = 16
  const bars = 4
  const n = steps(stepsPerBar, bars)
  const g: MusicGenome = {
    tempo: 90,
    stepsPerBar,
    bars,
    scale: { root: 0, mode: 'minor' },
    drums: {
      kick: pattern('x---x---x---x---', n),
      snare: pattern('----x-------x---', n),
      hihat: pattern('x-x-x-x-x-x-x-x-', n),
    },
    bass: {
      notes: notes(
        '0 - - - 0 - - - 4 - - - 0 - - - ' +
          '3 - - - 3 - - - 5 - - - 3 - - - ' +
          '4 - - - 4 - - - 1 - - - 4 - - - ' +
          '0 - - - 0 - - - 4 - - - 0 - - -',
        n,
      ),
      octave: 2,
    },
    melody: {
      notes: emptyNotes(n),
      octave: 4,
    },
    chords: {
      progression: [0, 3, 4, 0],
      voicing: 'triad',
      rhythm: pattern('x-------x-------', n),
    },
    activeLayers: { drums: true, bass: true, melody: false, chords: false },
    parameters: { swing: 0.08 },
  }
  return validateGenome(g)
}

// ─── Ambient ────────────────────────────────────────────────────────

/**
 * Ambient: G dorian, two bars per chord (Gm11 → Fmaj9 → Bbmaj9 → C9sus4), wide pads, a slow
 * triangle arpeggio drifting through the chord, and a three-note glass motif that rises in the
 * first half and answers itself falling in the second.
 */
export function createAmbientSeed(): MusicGenome {
  return seed({
    genre: 'ambient',
    tempo: 70,
    scale: { root: 7, mode: 'dorian' },
    bars: 8,
    progression: [0, 0, 6, 6, 2, 2, 3, 3],
    voicing: 'seventh',
    chordRhythm: ['x---------------'],
    kick: ['----------------'],
    snare: ['----------------'],
    hat: ['x-------x-------'],
    perc: ['------x-------x-'],
    bass: ['R---------------', '--------5-------'],
    bassOctave: 2,
    melody: bars(
      '4 - - - - - - - 6 - - - - - - -',
      '7 - - - - - - - - - - - - - - -',
      '6 - - - - - - - 5 - - - - - - -',
      '3 - - - - - - - - - - - - - - -',
      '- - - - 4 - - - - - - - 6 - - -',
      '8 - - - - - - - 6 - - - - - - -',
      '6 - - - - - - - 4 - - - - - - -',
      '3 - - - - - - - - - - - - - - -',
    ),
    melodyOctave: 4,
    arp: { contour: 'updown', rhythm: 'x-x-x-x-x-x-x-x-', octave: 4, tones: 4, octaves: 2 },
    layers: { drums: false, bass: true, melody: true, chords: true, arp: true },
    swing: 0,
  })
}

/** Ambient, second idea: D major, slower chords over a pedal (Dmaj9 → Bm11 → Gmaj9 → A9sus4), a bell motif in fourths. */
export function createAmbientSeed2(): MusicGenome {
  return seed({
    genre: 'ambient',
    tempo: 64,
    scale: { root: 2, mode: 'major' },
    bars: 8,
    progression: [0, 0, 5, 5, 3, 3, 4, 4],
    voicing: 'seventh',
    chordRhythm: ['x---------------'],
    kick: ['----------------'],
    snare: ['----------------'],
    hat: ['----------------'],
    perc: ['x-----x-----x---'],
    bass: ['R---------------', '----------------'],
    bassOctave: 2,
    melody: bars(
      '- - - - - - - - 4 - - - 7 - - -',
      '- - - - - - - - - - - - - - - -',
      '- - - - - - - - 5 - - - 4 - - -',
      '2 - - - - - - - - - - - - - - -',
      '- - - - - - - - 4 - - - 7 - - -',
      '9 - - - - - - - - - - - 7 - - -',
      '- - - - - - - - 5 - - - 4 - - -',
      '- - - - - - - - - - - - - - - -',
    ),
    melodyOctave: 4,
    arp: { contour: 'up', rhythm: 'x---x---x---x---', octave: 5, tones: 4, octaves: 1 },
    layers: { drums: false, bass: true, melody: true, chords: true, arp: true },
    swing: 0,
  })
}

// ─── Electronic ─────────────────────────────────────────────────────

/**
 * Electro / acid: D minor, Dm7 → Bbmaj7 → Gm7 → Am7, a squelchy 16th bassline that climbs to
 * the octave and steps into each new chord, a plucked square arp, and a short answering hook.
 */
export function createElectronicSeed(): MusicGenome {
  return seed({
    genre: 'electronic',
    tempo: 124,
    scale: { root: 2, mode: 'minor' },
    bars: 4,
    progression: [0, 5, 3, 4],
    voicing: 'seventh',
    chordRhythm: ['x-------x-------'],
    kick: ['x---x---x---x---'],
    snare: ['----x-------x---', '----x-------x--x'],
    hat: ['xxxxxxxxxxxxxxxx'],
    perc: ['--x----x--x----x'],
    bass: ['R-Ro-R5-R-o-R3-A'],
    bassOctave: 2,
    melody: bars(
      '- - - - - - - - 7 - 6 - 4 - - -',
      '- - - - - - - - 5 - 4 - 2 - - -',
      '- - - - - - - - 7 - 5 - 3 - 4 -',
      '- - - - - - 1 - 3 - - - 4 - - -',
    ),
    melodyOctave: 4,
    arp: { contour: 'up', rhythm: 'x-xx-xx-x-xx-xx-', octave: 4, tones: 4, octaves: 2 },
    layers: { drums: true, bass: true, melody: true, chords: true, arp: true },
    swing: 0.05,
  })
}

// ─── Folk ───────────────────────────────────────────────────────────

/**
 * Folk: C pentatonic, C → G → Am → G, a boom-chick bass (root and fifth), a finger-picked
 * pattern on the arp layer, and a singable tune that asks in bar 1 and answers in bar 2.
 */
export function createPentatonicSeed(): MusicGenome {
  return seed({
    genre: 'folk',
    tempo: 100,
    scale: { root: 0, mode: 'pentatonic' },
    bars: 4,
    progression: [0, 3, 4, 3],
    voicing: 'triad',
    chordRhythm: ['x-------x-------'],
    kick: ['x-----x---x-----'],
    snare: ['----x-------x---'],
    hat: ['--x---x---x---x-'],
    perc: ['------x-------x-'],
    bass: ['R-------5-------', 'R-------5-----A-'],
    bassOctave: 2,
    melody: bars(
      '2 - - - 3 - 4 - 5 - - - 3 - - -',
      '6 - - - 6 - 5 - 3 - - - - - - -',
      '4 - - - 5 - 6 - 7 - - - 5 - 4 -',
      '3 - - - 1 - - - 3 - - - - - - -',
    ),
    melodyOctave: 4,
    // Travis picking: root, top, middle, top
    arp: { pattern: Array.from({ length: 64 }, (_, i) => (i % 2 === 1 ? null : [0, 3, 1, 3, 2, 3, 1, 3][(i / 2) % 8]!)), octave: 3 },
    layers: { drums: true, bass: true, melody: true, chords: false, arp: true },
    swing: 0.12,
  })
}

// ─── House ──────────────────────────────────────────────────────────

/**
 * Deep house: F dorian, Fm9 → Bb9 (the dorian IV) → Ebmaj9 → Cm9 as off-beat organ stabs, a
 * bass that bounces between the kicks with an octave pop and steps into each chord, open hats
 * on the off-beat over a shuffled closed-hat line, and a call (bars 1, 3) and response (2, 4).
 */
export function createHouseSeed(): MusicGenome {
  return seed({
    genre: 'house',
    tempo: 122,
    scale: { root: 5, mode: 'dorian' },
    bars: 4,
    progression: [0, 3, 6, 4],
    voicing: 'seventh',
    chordRhythm: ['--x--x----x--x--', '--x--x----x-x---'],
    kick: ['x---x---x---x---'],
    snare: ['----x-------x---', '----x-------x--x'],
    hat: ['--x---x---x---x-'],
    perc: ['xxxxxxxxxxxxxxxx'],
    bass: ['--R---Ro--R--5-A', '--R---R---o--3-A'],
    bassOctave: 2,
    melody: bars(
      '- - - - 4 - - 2 - - 4 - 6 - 4 -',
      '- - 5 - - - 4 - - - 2 - - - - -',
      '- - - - 3 - - 1 - - 3 - 5 - 3 -',
      '- - 4 - - - 1 - - - 2 - - - 0 -',
    ),
    melodyOctave: 4,
    arp: { contour: 'updown', rhythm: '--x---x---x---x-', octave: 4, tones: 4, octaves: 1 },
    layers: { drums: true, bass: true, melody: true, chords: true, arp: false },
    swing: 0.12,
  })
}

/**
 * Soulful / piano house: C minor, Cm9 → Abmaj9 → Bb9 → Fm9 in a tresillo piano rhythm, a
 * rolling bass answering the kick, and a gospel-tinged hook that climbs to the ninth.
 */
export function createHouseSeed2(): MusicGenome {
  return seed({
    genre: 'house',
    tempo: 124,
    scale: { root: 0, mode: 'minor' },
    bars: 4,
    progression: [0, 5, 6, 3],
    voicing: 'seventh',
    chordRhythm: ['x--x--x---x--x--'],
    kick: ['x---x---x---x---'],
    snare: ['----x-------x---'],
    hat: ['--x---x---x---x-'],
    perc: ['x-xxx-xxx-xxx-xx'],
    bass: ['--R-R--o--R-5--A'],
    bassOctave: 2,
    melody: bars(
      '- - 2 - 4 - - - 8 - 7 - - - 4 -',
      '- - 4 - 2 - - - 0 - - - - - - -',
      '- - 3 - 5 - - - 8 - 7 - - - 5 -',
      '- - 5 - 4 - - - 3 - 2 - 0 - - -',
    ),
    melodyOctave: 4,
    arp: { contour: 'up', rhythm: 'x-x-x-x-x-x-x-x-', octave: 4, tones: 4, octaves: 1 },
    layers: { drums: true, bass: true, melody: true, chords: true, arp: false },
    swing: 0.14,
  })
}

// ─── Minimal / dub techno ───────────────────────────────────────────

/**
 * Dub techno: A minor, one dub chord shape (Am7) moving to Fmaj7 and Dm7 and back, echoing
 * off-beat stabs, rimshots off the grid, a conga answering them, and a sub bass between kicks.
 */
export function createMinimalTechnoSeed(): MusicGenome {
  return seed({
    genre: 'minimal',
    tempo: 126,
    scale: { root: 9, mode: 'minor' },
    bars: 4,
    progression: [0, 0, 5, 3],
    voicing: 'seventh',
    chordRhythm: ['---x------x-----', '---x---------x--'],
    kick: ['x---x---x---x---'],
    snare: ['---x------x--x--', '------x---x-----'],
    hat: ['--x---x---x---x-'],
    perc: ['-x-----x-x----x-'],
    bass: ['--R-----R-R-----', '--R-----R---o---'],
    bassOctave: 2,
    melody: null,
    melodyOctave: 4,
    arp: { contour: 'up', rhythm: '---x-----x-----x', octave: 5, tones: 3, octaves: 1 },
    layers: { drums: true, bass: true, melody: false, chords: true, arp: true },
    swing: 0.06,
  })
}

// ─── Downtempo ──────────────────────────────────────────────────────

/**
 * Downtempo / trip hop: E dorian, Em9 → A9 → Dmaj9 → Bm9 on a Rhodes, a lazy swung beat with
 * a dragging snare, a warm bass that sits on the kick and walks into each chord, and a
 * melody that leaves space (long notes, a phrase per two bars).
 */
export function createDowntempoSeed(): MusicGenome {
  return seed({
    genre: 'downtempo',
    tempo: 90,
    scale: { root: 4, mode: 'dorian' },
    bars: 4,
    progression: [0, 3, 6, 4],
    voicing: 'seventh',
    chordRhythm: ['x-------x-----x-', 'x---------x-----'],
    kick: ['x-----x-x-------', 'x-----x---x-----'],
    snare: ['----x-------x---', '----x--x----x---'],
    hat: ['x-x-x-x-x-x-x-x-'],
    perc: ['-------x-------x'],
    bass: ['R-----R-5-----A-', 'R-----R---3---A-'],
    bassOctave: 2,
    melody: bars(
      '4 - - - - - 6 - 7 - - - - - - -',
      '5 - - - 4 - - - 2 - - - - - - -',
      '- - 2 - 3 - 4 - 6 - - - 5 - - -',
      '4 - - - - - 3 - 1 - - - - - - -',
    ),
    melodyOctave: 4,
    layers: { drums: true, bass: true, melody: true, chords: true, arp: false },
    swing: 0.18,
  })
}

// ─── Lo-fi hip hop ──────────────────────────────────────────────────

/**
 * Lo-fi hip hop: C major ii–V–I–vi as Dm9 → G13 → Cmaj9 → Am9, a boom-bap beat with a dragging
 * snare and ghost notes, a soft bass that hits with the kick and walks down into each chord,
 * and an understated motif that answers itself a step lower.
 */
export function createLofiSeed(): MusicGenome {
  return seed({
    genre: 'lofi',
    tempo: 82,
    scale: { root: 0, mode: 'major' },
    bars: 4,
    progression: [1, 4, 0, 5],
    voicing: 'seventh',
    chordRhythm: ['x-------x-----x-', 'x---------x-----'],
    kick: ['x------x--x-----', 'x------x-x------'],
    snare: ['----x-------x---', '----x--x----x--x'],
    hat: ['x-x-x-x-x-x-x-x-', 'x-x-x-x-x-x-x-xx'],
    perc: ['----------------', '--------------x-'],
    bass: ['R------R--5---A-', 'R------R-3----A-'],
    bassOctave: 2,
    melody: bars(
      '- - 4 - - - 3 - 1 - - - - - - -',
      '- - 3 - 4 - - - 6 - - - 4 - - -',
      '- - 4 - - - 2 - 1 - - - - - - -',
      '- - 2 - 4 - - - 5 - - - 4 - 2 -',
    ),
    melodyOctave: 4,
    layers: { drums: true, bass: true, melody: true, chords: true, arp: false },
    swing: 0.35,
  })
}

/**
 * Lo-fi, second idea: a descending IV–iii–ii–I in E-flat (Abmaj9 → Gm7 → Fm9 → Ebmaj9), the
 * kick skipping a 16th early, and a two-note sigh that grows into a phrase.
 */
export function createLofiSeed2(): MusicGenome {
  return seed({
    genre: 'lofi',
    tempo: 78,
    scale: { root: 3, mode: 'major' },
    bars: 4,
    progression: [3, 2, 1, 0],
    voicing: 'seventh',
    chordRhythm: ['x-------x-------', 'x-----x-------x-'],
    kick: ['x-------x-x-----', 'x--x----x-------'],
    snare: ['----x-------x---', '----x--x----x---'],
    hat: ['x-x-x-x-x-x-x-x-'],
    perc: ['------x---------'],
    bass: ['R-------R-5---A-', 'R--R----5-----A-'],
    bassOctave: 2,
    melody: bars(
      '- - - - 5 - 4 - - - - - - - - -',
      '- - - - 4 - 2 - - - - - - - - -',
      '- - - - 3 - 4 - 5 - 7 - 5 - - -',
      '4 - - - 2 - - - - - - - - - - -',
    ),
    melodyOctave: 4,
    layers: { drums: true, bass: true, melody: true, chords: true, arp: false },
    swing: 0.32,
  })
}

// ─── Drum & bass ────────────────────────────────────────────────────

/**
 * Liquid drum & bass: F minor, two bars per chord (Fm9 → Dbmaj9 → Bbm9 → Cm7), a two-step with
 * ghost snares rolling between the backbeats, a sub that lands with each kick, slides to the
 * octave and steps into the next chord, a rolling triangle arp, and a long-note lead that
 * calls over the first chord and answers over the second.
 */
export function createDnbSeed(): MusicGenome {
  return seed({
    genre: 'dnb',
    tempo: 172,
    scale: { root: 5, mode: 'minor' },
    bars: 8,
    progression: [0, 0, 5, 5, 3, 3, 4, 4],
    voicing: 'seventh',
    chordRhythm: ['x---------------'],
    kick: ['x---------x-----', 'x-x-------x-----'],
    snare: ['----x--x----x---', '----x-------x--x'],
    hat: ['x-x-x-x-x-x-x-x-', 'x-x-x-x-x-xxx-x-'],
    perc: ['x---x---x---x---'],
    bass: ['R---------R-----', 'R-----o---R---A-'],
    bassOctave: 1,
    melody: bars(
      '4 - - - - - - - - - - - 6 - - -',
      '7 - - - - - 6 - 4 - - - - - - -',
      '2 - - - - - - - - - - - 4 - - -',
      '5 - - - - - 4 - 2 - - - - - - -',
      '3 - - - - - - - - - - - 5 - - -',
      '7 - - - - - 5 - 3 - - - - - - -',
      '4 - - - - - - - 6 - - - 8 - - -',
      '10 - - - - - 8 - 6 - - - 4 - - -',
    ),
    melodyOctave: 4,
    arp: { contour: 'updown', rhythm: 'x-xxx-xxx-xxx-xx', octave: 4, tones: 4, octaves: 2 },
    layers: { drums: true, bass: true, melody: true, chords: true, arp: true },
    swing: 0,
  })
}

/**
 * Rolling / jump-up flavoured drum & bass: G minor, Gm7 → Ebmaj7 → Cm7 → D (harmonic-minor
 * V7 in the last bar), a busier bass riff locked to a syncopated kick, and a stabbing lead.
 */
export function createDnbSeed2(): MusicGenome {
  return seed({
    genre: 'dnb',
    tempo: 174,
    scale: { root: 7, mode: 'minor' },
    bars: 4,
    progression: [0, 5, 3, 4],
    voicing: 'triad',
    colors: [null, null, null, '7'],
    chordRhythm: ['x-----x---------'],
    kick: ['x---------x-----', 'x-x-------x--x--'],
    snare: ['----x--x----x---', '----x-------x-x-'],
    hat: ['x-x-x-x-x-x-x-x-'],
    perc: ['--x---x---x---x-'],
    bass: ['R-R-------R--o--', 'R-R-------5--A--'],
    bassOctave: 1,
    melody: bars(
      '- - - - - - 4 - - - 3 - 4 - - -',
      '- - - - - - 2 - - - 4 - 5 - - -',
      '- - - - - - 3 - - - 2 - 0 - - -',
      '- - - - - - 1 - - - 3 - 4 - - -',
    ),
    melodyOctave: 5,
    arp: { contour: 'up', rhythm: 'x-x-x-x-x-x-x-x-', octave: 4, tones: 3, octaves: 2 },
    layers: { drums: true, bass: true, melody: true, chords: true, arp: false },
    swing: 0,
  })
}

// ─── Trance ─────────────────────────────────────────────────────────

/**
 * Uplifting trance: A minor, Am → F → C → G with open voicings, a rolling off-beat bass, a 16th
 * pedal arpeggio (root–fifth–octave turning around the third), off-beat open hats over 16th
 * closed hats, and a syncopated 3-3-2 hook that climbs a third in bar 3 and resolves to A.
 */
export function createTranceSeed(): MusicGenome {
  const arpBar = [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 1, 2, 4, 2, 3, 2]
  return seed({
    genre: 'trance',
    tempo: 138,
    scale: { root: 9, mode: 'minor' },
    bars: 4,
    progression: [0, 5, 2, 6],
    voicing: 'triad',
    chordRhythm: ['x---------------'],
    kick: ['x---x---x---x---'],
    snare: ['----x-------x---'],
    hat: ['--x---x---x---x-'],
    perc: ['xxxxxxxxxxxxxxxx'],
    bass: ['-RRo-RRo-RRo-RRA'],
    bassOctave: 2,
    melody: bars(
      '4 - - 7 - - 6 - 4 - - 3 - - 4 -',
      '2 - - 5 - - 4 - 2 - - 0 - - 2 -',
      '6 - - 9 - - 8 - 6 - - 4 - - 6 -',
      '8 - - 6 - - 4 - 3 - - 4 - - 7 -',
    ),
    melodyOctave: 4,
    arp: { pattern: Array.from({ length: 4 }, () => arpBar).flat(), octave: 4 },
    layers: { drums: true, bass: true, melody: true, chords: true, arp: true },
    swing: 0,
  })
}

/**
 * Trance, second idea: E minor, Cadd9 → Dsus4 → Em → Em (the VI–VII–i lift), a gated
 * up–down arp across two octaves, a galloping bass, and a long-note anthem melody.
 */
export function createTranceSeed2(): MusicGenome {
  return seed({
    genre: 'trance',
    tempo: 136,
    scale: { root: 4, mode: 'minor' },
    bars: 4,
    progression: [5, 6, 0, 0],
    voicing: 'seventh',
    chordRhythm: ['x---------------'],
    kick: ['x---x---x---x---'],
    snare: ['----x-------x---'],
    hat: ['--x---x---x---x-'],
    perc: ['x-xxx-xxx-xxx-xx'],
    bass: ['-R-o-R-o-R-o-R-A', '-R-o-R-o-R-o-R-o'],
    bassOctave: 2,
    melody: bars(
      '5 - - - - - - - 4 - - - 2 - - -',
      '6 - - - - - - - 3 - - - 2 - - -',
      '7 - - - - - - - 9 - - - 8 - 7 -',
      '4 - - - - - - - - - - - - - - -',
    ),
    melodyOctave: 4,
    arp: { contour: 'updown', rhythm: 'xx-xxx-xxx-xxx-x', octave: 4, tones: 3, octaves: 2 },
    layers: { drums: true, bass: true, melody: true, chords: true, arp: true },
    swing: 0,
  })
}

export const SEED_NAMES = [
  'minimal',
  'ambient',
  'ambient-2',
  'electronic',
  'pentatonic',
  'house',
  'house-2',
  'minimal-techno',
  'downtempo',
  'lofi',
  'lofi-2',
  'dnb',
  'dnb-2',
  'trance',
  'trance-2',
] as const
export type SeedName = (typeof SEED_NAMES)[number]

const SEEDS: Record<SeedName, () => MusicGenome> = {
  minimal: createMinimalSeed,
  ambient: createAmbientSeed,
  'ambient-2': createAmbientSeed2,
  electronic: createElectronicSeed,
  pentatonic: createPentatonicSeed,
  house: createHouseSeed,
  'house-2': createHouseSeed2,
  'minimal-techno': createMinimalTechnoSeed,
  downtempo: createDowntempoSeed,
  lofi: createLofiSeed,
  'lofi-2': createLofiSeed2,
  dnb: createDnbSeed,
  'dnb-2': createDnbSeed2,
  trance: createTranceSeed,
  'trance-2': createTranceSeed2,
}

export function getSeed(name: SeedName): MusicGenome {
  const create = SEEDS[name]
  if (!create) throw new Error(`Unknown seed: ${String(name)}`)
  return create()
}

export function allSeeds(): Record<SeedName, MusicGenome> {
  return Object.fromEntries(SEED_NAMES.map((name) => [name, getSeed(name)])) as Record<SeedName, MusicGenome>
}
