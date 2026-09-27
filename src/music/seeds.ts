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
      notes: notes('0 - - - 0 - - - 3 - - - 0 - - -', n),
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
      notes: notes('0 - - - - - - - 4 - - - - - - -', n),
      octave: 2,
    },
    melody: {
      notes: notes('0 - - 2 - - 4 - - - 5 - - 4 - -', n),
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
      notes: notes('0 - 0 - 0 - 0 3 0 - 0 - 5 - 3 -', n),
      octave: 2,
    },
    melody: {
      notes: notes('0 2 4 5 4 2 0 - 7 5 4 2 0 - - -', n),
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
      notes: notes('0 - - 2 - - 0 - 4 - - 2 - - 0 -', n),
      octave: 2,
    },
    melody: {
      notes: notes('0 - 2 - 4 - 2 - 0 - 4 - 5 - 4 -', n),
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

export const SEED_NAMES = ['minimal', 'ambient', 'electronic', 'pentatonic'] as const
export type SeedName = (typeof SEED_NAMES)[number]

export function getSeed(name: SeedName): MusicGenome {
  switch (name) {
    case 'minimal':
      return createMinimalSeed()
    case 'ambient':
      return createAmbientSeed()
    case 'electronic':
      return createElectronicSeed()
    case 'pentatonic':
      return createPentatonicSeed()
    default: {
      const _exhaustive: never = name
      throw new Error(`Unknown seed: ${_exhaustive}`)
    }
  }
}

export function allSeeds(): Record<SeedName, MusicGenome> {
  return {
    minimal: createMinimalSeed(),
    ambient: createAmbientSeed(),
    electronic: createElectronicSeed(),
    pentatonic: createPentatonicSeed(),
  }
}
