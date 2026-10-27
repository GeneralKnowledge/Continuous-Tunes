import {
  emptyNotes,
  emptySteps,
  type MusicGenome,
} from './genome'
import { validateGenome } from './validation'

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
      // One bar per chord of the progression [0, 3, 4, 0]
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

/** Soft pads + sparse melody — ambient seed. */
export function createAmbientSeed(): MusicGenome {
  const stepsPerBar = 16
  const bars = 4
  const n = steps(stepsPerBar, bars)
  const g: MusicGenome = {
    tempo: 72,
    stepsPerBar,
    bars,
    scale: { root: 7, mode: 'dorian' }, // G dorian
    drums: {
      kick: emptySteps(n),
      snare: emptySteps(n),
      hihat: pattern('x---------------', n),
    },
    bass: {
      notes: notes(
        '0 - - - - - - - 4 - - - - - - - ' +
          '4 - - - - - - - 1 - - - - - - - ' +
          '3 - - - - - - - 0 - - - - - - - ' +
          '0 - - - - - - - 4 - - - - - - -',
        n,
      ),
      octave: 2,
    },
    melody: {
      notes: notes(
        '0 - - 2 - - 4 - - - 5 - - 4 - - ' +
          '4 - - 3 - - 1 - - - 2 - - 1 - - ' +
          '3 - - 5 - - 7 - - - 5 - - 3 - - ' +
          '2 - - 0 - - 4 - - - 2 - - 0 - -',
        n,
      ),
      octave: 5,
    },
    chords: {
      progression: [0, 4, 3, 0],
      voicing: 'seventh',
      rhythm: pattern('x---------------', n),
    },
    activeLayers: { drums: false, bass: true, melody: true, chords: true },
    parameters: { swing: 0 },
  }
  return validateGenome(g)
}

/** Four-on-floor + arp — electronic seed. */
export function createElectronicSeed(): MusicGenome {
  const stepsPerBar = 16
  const bars = 4
  const n = steps(stepsPerBar, bars)
  const g: MusicGenome = {
    tempo: 124,
    stepsPerBar,
    bars,
    scale: { root: 2, mode: 'minor' }, // D minor
    drums: {
      kick: pattern('x---x---x---x---', n),
      snare: pattern('----x-------x---', n),
      hihat: pattern('x-x-x-x-x-x-x-x-', n),
    },
    bass: {
      // Follows the progression [0, 5, 3, 4]: root pulse, fifth/third pickup
      notes: notes(
        '0 - 0 - 0 - 0 2 0 - 0 - 4 - 2 - ' +
          '5 - 5 - 5 - 5 7 5 - 5 - 2 - 0 - ' +
          '3 - 3 - 3 - 3 5 3 - 3 - 0 - 5 - ' +
          '4 - 4 - 4 - 4 6 4 - 4 - 1 - 6 -',
        n,
      ),
      octave: 2,
    },
    melody: {
      notes: notes(
        '0 2 4 5 4 2 0 - 7 5 4 2 0 - - - ' +
          '5 4 2 4 5 4 2 - 7 5 4 2 2 - - - ' +
          '3 2 3 5 7 5 3 - 5 4 3 2 3 - - - ' +
          '4 5 6 5 4 2 1 - 1 2 4 5 6 - - -',
        n,
      ),
      octave: 4,
    },
    chords: {
      progression: [0, 5, 3, 4],
      voicing: 'triad',
      rhythm: pattern('x---x---x---x---', n),
    },
    activeLayers: { drums: true, bass: true, melody: true, chords: true },
    parameters: { swing: 0.05 },
  }
  return validateGenome(g)
}

/** Pentatonic folk-ish groove. */
export function createPentatonicSeed(): MusicGenome {
  const stepsPerBar = 16
  const bars = 4
  const n = steps(stepsPerBar, bars)
  const g: MusicGenome = {
    tempo: 100,
    stepsPerBar,
    bars,
    scale: { root: 0, mode: 'pentatonic' },
    drums: {
      kick: pattern('x-----x---x-----', n),
      snare: pattern('----x-------x---', n),
      hihat: pattern('--x---x---x---x-', n),
    },
    bass: {
      notes: notes(
        '0 - - 2 - - 0 - 4 - - 2 - - 0 - ' +
          '2 - - 4 - - 2 - 1 - - 4 - - 2 - ' +
          '4 - - 1 - - 4 - 3 - - 1 - - 4 - ' +
          '0 - - 2 - - 0 - 4 - - 2 - - 0 -',
        n,
      ),
      octave: 2,
    },
    melody: {
      notes: notes(
        '0 - 2 - 4 - 2 - 0 - 4 - 5 - 4 - ' +
          '2 - 1 - 4 - 2 - 1 - 2 - 4 - 6 - ' +
          '4 - 3 - 1 - 3 - 3 - 4 - 6 - 4 - ' +
          '0 - 2 - 4 - 2 - 5 - 4 - 2 - 0 -',
        n,
      ),
      octave: 4,
    },
    chords: {
      progression: [0, 2, 4, 0],
      voicing: 'power',
      rhythm: pattern('x-------x-------', n),
    },
    activeLayers: { drums: true, bass: true, melody: true, chords: true },
    parameters: { swing: 0.12 },
  }
  return validateGenome(g)
}

/**
 * Notes for each bar from one bar's template, following the chord roots:
 * `R` is the bar's root, `+n` / `-n` a degree offset from it, `-` a rest.
 * Degrees fold back into 0–7 so they stay valid.
 */
function followRoots(roots: number[], bar: string): (number | null)[] {
  const tokens = bar.trim().split(/\s+/)
  const fold = (d: number) => (d > 7 ? d - 7 : d < 0 ? d + 7 : d)
  return roots.flatMap((root) =>
    tokens.map((t) => {
      if (t === '-') return null
      if (t === 'R') return fold(root)
      return fold(root + Number.parseInt(t, 10))
    }),
  )
}

/** Deep house: 4/4 kick, clap, off-beat open hats, organ stabs, a bouncing bass. */
export function createHouseSeed(): MusicGenome {
  const stepsPerBar = 16
  const bars = 4
  const n = steps(stepsPerBar, bars)
  const progression = [0, 3, 5, 4]
  const g: MusicGenome = {
    tempo: 122,
    stepsPerBar,
    bars,
    scale: { root: 5, mode: 'dorian' }, // F dorian
    drums: {
      kick: pattern('x---x---x---x---', n),
      snare: pattern('----x-------x---', n),
      hihat: pattern('--x---x---x---x-', n),
    },
    bass: { notes: followRoots(progression, '- - R - - - R +4 - - R - - +4 R -'), octave: 2 },
    melody: {
      notes: notes(
        '- - - - 4 - - 2 - - - - 4 - 5 - ' +
          '- - - - 3 - - 2 - - - - 3 - 4 - ' +
          '- - - - 5 - - 4 - - - - 2 - 4 - ' +
          '- - - - 4 - - 2 - - 1 - - - - -',
        n,
      ),
      octave: 5,
    },
    chords: { progression, voicing: 'seventh', rhythm: pattern('---x--x-----x---', n) },
    activeLayers: { drums: true, bass: true, melody: true, chords: true },
    parameters: { swing: 0.1 },
  }
  return validateGenome(g)
}

/** Minimal / dub techno: 4/4 kick, off-beat rimshots and hats, a sub bass, echoing chord stabs. */
export function createMinimalTechnoSeed(): MusicGenome {
  const stepsPerBar = 16
  const bars = 4
  const n = steps(stepsPerBar, bars)
  const progression = [0, 0, 5, 3]
  const g: MusicGenome = {
    tempo: 126,
    stepsPerBar,
    bars,
    scale: { root: 9, mode: 'minor' }, // A minor
    drums: {
      kick: pattern('x---x---x---x---', n),
      snare: pattern('---x------x--x--', n),
      hihat: pattern('--x---x---x---x-', n),
    },
    bass: { notes: followRoots(progression, '- - R - - - - R - - R - - - - -'), octave: 2 },
    melody: { notes: emptyNotes(n), octave: 4 },
    chords: { progression, voicing: 'seventh', rhythm: pattern('---x------x-----', n) },
    activeLayers: { drums: true, bass: true, melody: false, chords: true },
    parameters: { swing: 0.06 },
  }
  return validateGenome(g)
}

/** Downtempo: a laid-back swung beat, electric piano chords, a lazy melody. */
export function createDowntempoSeed(): MusicGenome {
  const stepsPerBar = 16
  const bars = 4
  const n = steps(stepsPerBar, bars)
  const progression = [0, 3, 4, 2]
  const g: MusicGenome = {
    tempo: 92,
    stepsPerBar,
    bars,
    scale: { root: 4, mode: 'dorian' }, // E dorian
    drums: {
      kick: pattern('x-----x---x-----', n),
      snare: pattern('----x-------x---', n),
      hihat: pattern('x-x-x-x-x-x-x-x-', n),
    },
    bass: { notes: followRoots(progression, 'R - - - - - R - - - +4 - - - - -'), octave: 2 },
    melody: {
      notes: notes(
        '4 - - - 2 - - - 1 - 2 - - - - - ' +
          '5 - - - 4 - - - 3 - - - - - - - ' +
          '4 - 5 - 6 - - - 4 - - - 2 - - - ' +
          '2 - - - 1 - - - 0 - - - - - - -',
        n,
      ),
      octave: 4,
    },
    chords: { progression, voicing: 'seventh', rhythm: pattern('x-------x-------', n) },
    activeLayers: { drums: true, bass: true, melody: true, chords: true },
    parameters: { swing: 0.18 },
  }
  return validateGenome(g)
}

/** Lo-fi hip hop: a heavily swung boom-bap beat over jazzy ii–V–I–vi sevenths. */
export function createLofiSeed(): MusicGenome {
  const stepsPerBar = 16
  const bars = 4
  const n = steps(stepsPerBar, bars)
  const progression = [1, 4, 0, 5]
  const g: MusicGenome = {
    tempo: 82,
    stepsPerBar,
    bars,
    scale: { root: 0, mode: 'major' }, // C major
    drums: {
      kick: pattern('x------x--x-----', n),
      snare: pattern('----x-------x---', n),
      hihat: pattern('x-x-x-x-x-x-x-x-', n),
    },
    bass: { notes: followRoots(progression, 'R - - - - - - R - - +4 - - - - -'), octave: 2 },
    melody: {
      notes: notes(
        '- - 4 - - - 3 - 1 - - - - - - - ' +
          '- - 3 - 4 - - - 6 - - - 4 - - - ' +
          '- - 2 - - - 4 - 2 - 0 - - - - - ' +
          '- - 5 - - - 4 - - - 2 - - - - -',
        n,
      ),
      octave: 4,
    },
    chords: { progression, voicing: 'seventh', rhythm: pattern('x-------x-----x-', n) },
    activeLayers: { drums: true, bass: true, melody: true, chords: true },
    parameters: { swing: 0.35 },
  }
  return validateGenome(g)
}

/** Drum & bass: a two-step beat over a stretched break, long sub notes, pads. */
export function createDnbSeed(): MusicGenome {
  const stepsPerBar = 16
  const bars = 4
  const n = steps(stepsPerBar, bars)
  const progression = [0, 5, 3, 4]
  const g: MusicGenome = {
    tempo: 172,
    stepsPerBar,
    bars,
    scale: { root: 5, mode: 'minor' }, // F minor
    drums: {
      kick: pattern('x---------x-----', n),
      snare: pattern('----x-------x---', n),
      hihat: pattern('x-x-x-x-x-x-x-x-', n),
    },
    bass: { notes: followRoots(progression, 'R - - - - - - - - - R - - - +4 -'), octave: 2 },
    melody: {
      notes: notes(
        '4 - - - - - - - 2 - - - 4 - - - ' +
          '5 - - - - - - - 4 - - - - - - - ' +
          '3 - - - - - - - 2 - - - 3 - - - ' +
          '4 - - - - - - - - - - - - - - -',
        n,
      ),
      octave: 5,
    },
    chords: { progression, voicing: 'seventh', rhythm: pattern('x---------------', n) },
    activeLayers: { drums: true, bass: true, melody: true, chords: true },
    parameters: { swing: 0 },
  }
  return validateGenome(g)
}

/** Trance: 4/4 kick, off-beat hats, a rolling off-beat bass and a 16th-note arpeggio lead. */
export function createTranceSeed(): MusicGenome {
  const stepsPerBar = 16
  const bars = 4
  const n = steps(stepsPerBar, bars)
  const progression = [0, 5, 2, 6]
  const g: MusicGenome = {
    tempo: 138,
    stepsPerBar,
    bars,
    scale: { root: 9, mode: 'minor' }, // A minor
    drums: {
      kick: pattern('x---x---x---x---', n),
      snare: pattern('----x-------x---', n),
      hihat: pattern('--x---x---x---x-', n),
    },
    bass: { notes: followRoots(progression, '- R R R - R R R - R R R - R R R'), octave: 2 },
    melody: { notes: followRoots(progression, 'R +2 +4 +5 +4 +2 R +2 +4 +5 +4 +2 R +2 +4 +2'), octave: 4 },
    chords: { progression, voicing: 'triad', rhythm: pattern('x---------------', n) },
    activeLayers: { drums: true, bass: true, melody: true, chords: true },
    parameters: { swing: 0 },
  }
  return validateGenome(g)
}

export const SEED_NAMES = [
  'minimal',
  'ambient',
  'electronic',
  'pentatonic',
  'house',
  'minimal-techno',
  'downtempo',
  'lofi',
  'dnb',
  'trance',
] as const
export type SeedName = (typeof SEED_NAMES)[number]

const SEEDS: Record<SeedName, () => MusicGenome> = {
  minimal: createMinimalSeed,
  ambient: createAmbientSeed,
  electronic: createElectronicSeed,
  pentatonic: createPentatonicSeed,
  house: createHouseSeed,
  'minimal-techno': createMinimalTechnoSeed,
  downtempo: createDowntempoSeed,
  lofi: createLofiSeed,
  dnb: createDnbSeed,
  trance: createTranceSeed,
}

export function getSeed(name: SeedName): MusicGenome {
  const create = SEEDS[name]
  if (!create) throw new Error(`Unknown seed: ${String(name)}`)
  return create()
}

export function allSeeds(): Record<SeedName, MusicGenome> {
  return Object.fromEntries(SEED_NAMES.map((name) => [name, getSeed(name)])) as Record<SeedName, MusicGenome>
}
