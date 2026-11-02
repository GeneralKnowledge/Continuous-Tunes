import type { Rng } from '../lib/rng'
import {
  BARS_OPTIONS,
  CHORD_VOICINGS,
  SCALE_DEGREE_MAX,
  SCALE_DEGREE_MIN,
  SCALE_MODES,
  STEPS_PER_BAR_OPTIONS,
  TEMPO_MAX,
  TEMPO_MIN,
  cloneGenome,
  type MusicGenome,
} from '../music/genome'
import type { MutationWeights, Personality } from '../music/personality'
import { validateGenome } from '../music/validation'
import { arpPattern, clampDegree, onBeat, rebaseLine, snapToChords, substituteChord } from '../music/compose'
import { chordTonesNear } from '../music/harmony'
import { getStyle } from '../music/styles'
import { colorFits, diatonicChord, euclid, invertDegrees, scaleLength, sequenceDegrees } from '../music/theory'

export type MutationIntensity = 'small' | 'moderate' | 'experimental'

export interface MutationResult {
  genome: MusicGenome
  mutationName: string
  description: string
}

export interface MutationOp {
  name: string
  category: keyof MutationWeights
  /** Minimum intensity required to apply this op. */
  minIntensity: MutationIntensity
  /** Layer the op edits, when it isn't the category's own (arp ops). */
  layer?: keyof MusicGenome['activeLayers']
  apply: (genome: MusicGenome, rng: Rng, intensity: MutationIntensity) => MutationResult | null
}

const INTENSITY_RANK: Record<MutationIntensity, number> = {
  small: 0,
  moderate: 1,
  experimental: 2,
}

function canApply(op: MutationOp, intensity: MutationIntensity): boolean {
  return INTENSITY_RANK[intensity] >= INTENSITY_RANK[op.minIntensity]
}

function flipAt(arr: boolean[], i: number): void {
  arr[i] = !arr[i]
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Re-grid a step pattern to a new steps-per-bar / bar count, keeping each hit at the
 * same musical position. 16→8 keeps the 8th-note steps; 8→16 places hits on even steps.
 * Extra bars repeat the existing ones instead of going silent.
 */
function regrid<T>(
  arr: T[],
  fromSpb: number,
  fromBars: number,
  toSpb: number,
  toBars: number,
  empty: T,
): T[] {
  const out: T[] = []
  for (let bar = 0; bar < toBars; bar++) {
    const srcBar = bar % fromBars
    for (let step = 0; step < toSpb; step++) {
      const pos = (step * fromSpb) / toSpb
      out.push(Number.isInteger(pos) ? (arr[srcBar * fromSpb + pos] ?? empty) : empty)
    }
  }
  return out
}

/** Default mutation probability config (not hardcoded at call sites). */
export interface MutationConfig {
  /** Relative category weights (combined with personality). */
  categoryWeights: MutationWeights
  /** Probability of each intensity tier. */
  intensityProbabilities: {
    small: number
    moderate: number
    experimental: number
  }
}

export const DEFAULT_MUTATION_CONFIG: MutationConfig = {
  categoryWeights: {
    rhythm: 1,
    bass: 1,
    melody: 1,
    chords: 1,
    tempo: 0.6,
    scale: 0.15,
    layers: 0.5,
    parameters: 0.4,
  },
  intensityProbabilities: {
    small: 0.7,
    moderate: 0.2,
    experimental: 0.1,
  },
}

export function mergeMutationConfig(
  base: MutationConfig,
  personality?: Personality,
): MutationConfig {
  if (!personality) return base
  const categoryWeights = { ...base.categoryWeights }
  for (const key of Object.keys(categoryWeights) as (keyof MutationWeights)[]) {
    categoryWeights[key] = categoryWeights[key]! * personality.mutationWeights[key]
  }
  return {
    categoryWeights,
    intensityProbabilities: { ...personality.intensityBias },
  }
}

export function pickIntensity(rng: Rng, config: MutationConfig): MutationIntensity {
  const { small, moderate, experimental } = config.intensityProbabilities
  const total = small + moderate + experimental
  const r = rng.next() * total
  if (r < small) return 'small'
  if (r < small + moderate) return 'moderate'
  return 'experimental'
}

/**
 * Shift intensity toward moderate/experimental as stagnation rises
 * so long runs don't freeze on tiny tweaks.
 */
export function intensityWithStagnation(
  config: MutationConfig,
  stagnationStreak: number,
  stagnationLimit = 8,
): MutationConfig {
  const t = Math.min(1, stagnationStreak / Math.max(1, stagnationLimit))
  const { small, moderate, experimental } = config.intensityProbabilities
  const shift = t * 0.35
  return {
    ...config,
    intensityProbabilities: {
      small: Math.max(0.15, small - shift),
      moderate: moderate + shift * 0.4,
      experimental: experimental + shift * 0.6,
    },
  }
}

// ─── Mutation operators ───────────────────────────────────────────────

export const MUTATION_OPS: MutationOp[] = [
  {
    name: 'AddKickHit',
    category: 'rhythm',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const offs = g.drums.kick.map((v, i) => (!v ? i : -1)).filter((i) => i >= 0)
      if (offs.length === 0) return null
      const i = rng.pick(offs)
      g.drums.kick[i] = true
      return { genome: g, mutationName: 'AddKickHit', description: `kick on @${i}` }
    },
  },
  {
    name: 'RemoveKickHit',
    category: 'rhythm',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const ons = g.drums.kick.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
      if (ons.length <= 1) return null
      const i = rng.pick(ons)
      g.drums.kick[i] = false
      return { genome: g, mutationName: 'RemoveKickHit', description: `kick off @${i}` }
    },
  },
  {
    name: 'ToggleSnare',
    category: 'rhythm',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.drums.snare.length - 1)
      flipAt(g.drums.snare, i)
      return { genome: g, mutationName: 'ToggleSnare', description: `snare toggle @${i}` }
    },
  },
  {
    name: 'ToggleHihat',
    category: 'rhythm',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.drums.hihat.length - 1)
      flipAt(g.drums.hihat, i)
      return { genome: g, mutationName: 'ToggleHihat', description: `hihat toggle @${i}` }
    },
  },
  {
    name: 'ShiftDrumPattern',
    category: 'rhythm',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const which = rng.pick(['kick', 'snare', 'hihat'] as const)
      const amount = rng.chance(0.5) ? 1 : -1
      const arr = g.drums[which]
      const n = arr.length
      const rot = ((amount % n) + n) % n
      g.drums[which] = [...arr.slice(rot), ...arr.slice(0, rot)]
      return {
        genome: g,
        mutationName: 'ShiftDrumPattern',
        description: `shift ${which} by ${rot}`,
      }
    },
  },
  {
    name: 'ChangeBassRhythm',
    category: 'bass',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const spb = g.stepsPerBar
      // Groove changes that keep the bass on its chord: a new onset plays the bar's root, fifth or
      // octave; and in genres that steer around the kick, new onsets avoid it
      const avoid = getStyle(g.genre).bassKick === 'avoid'
      const free = g.bass.notes.map((_, i) => i).filter((i) => !(avoid && g.drums.kick[i]))
      const i = rng.pick(free.length ? free : [0])
      const bar = Math.floor(i / spb)
      const root = g.chords.progression[bar] ?? 0
      const len = scaleLength(g.scale.mode)
      if (g.bass.notes[i] === null) {
        g.bass.notes[i] = clampDegree(rng.pick([root, root, root + (len === 5 ? 3 : 4), root + len]))
      } else if (rng.chance(0.5)) {
        g.bass.notes[i] = null
      } else {
        g.bass.notes[i] = chordTonesNear(g, bar, g.bass.notes[i]!, 4)[rng.int(0, 2)] ?? root
      }
      return { genome: g, mutationName: 'ChangeBassRhythm', description: `bass @${i}=${g.bass.notes[i]}` }
    },
  },
  {
    name: 'ChangeBassNote',
    category: 'bass',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const filled = g.bass.notes.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0)
      if (filled.length === 0) {
        const i = rng.int(0, g.bass.notes.length - 1)
        g.bass.notes[i] = rng.int(0, 4)
      } else {
        const i = rng.pick(filled)
        const cur = g.bass.notes[i]!
        const spb = g.stepsPerBar
        if (onBeat(i % spb, spb)) {
          // On the beat: another tone of the chord
          const near = chordTonesNear(g, Math.floor(i / spb), cur, 7).filter((d) => d !== cur)
          g.bass.notes[i] = clampDegree(near[rng.int(0, Math.min(2, near.length - 1))] ?? cur)
        } else {
          // Off the beat: a passing step
          g.bass.notes[i] = clamp(cur + (rng.chance(0.5) ? 1 : -1), SCALE_DEGREE_MIN, SCALE_DEGREE_MAX)
        }
      }
      return { genome: g, mutationName: 'ChangeBassNote', description: `bass note change` }
    },
  },
  {
    name: 'ChangeBassOctave',
    category: 'bass',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      g.bass.octave = clamp(g.bass.octave + (rng.chance(0.5) ? 1 : -1), 1, 4)
      return { genome: g, mutationName: 'ChangeBassOctave', description: `bass oct=${g.bass.octave}` }
    },
  },
  {
    name: 'ChangeMelodyNote',
    category: 'melody',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const spb = g.stepsPerBar
      const i = rng.int(0, g.melody.notes.length - 1)
      const bar = Math.floor(i / spb)
      const prev = g.melody.notes.slice(0, i).filter((d): d is number => d !== null).pop() ?? 2
      if (g.melody.notes[i] === null) {
        // A new note near the line: a chord tone on the beat, a step off it
        g.melody.notes[i] = onBeat(i % spb, spb)
          ? (chordTonesNear(g, bar, prev, 4)[rng.int(0, 1)] ?? prev)
          : clampDegree(prev + rng.pick([-1, 1, 2, -2]))
      } else if (rng.chance(0.35)) {
        g.melody.notes[i] = null
      } else {
        const cur = g.melody.notes[i]!
        g.melody.notes[i] = onBeat(i % spb, spb)
          ? (chordTonesNear(g, bar, cur, 4).filter((d) => d !== cur)[0] ?? cur)
          : clamp(cur + (rng.chance(0.5) ? 1 : -1), SCALE_DEGREE_MIN, SCALE_DEGREE_MAX)
      }
      return {
        genome: g,
        mutationName: 'ChangeMelodyNote',
        description: `melody @${i}=${g.melody.notes[i]}`,
      }
    },
  },
  {
    name: 'AddMelodyPhrase',
    category: 'melody',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const spb = g.stepsPerBar
      // Develop the motif: restate one bar's figure in another bar, repeated, moved through
      // the scale (sequence) or mirrored (inversion), then land its strong beats on that bar's chord
      const from = rng.int(0, g.bars - 1)
      const to = g.bars > 1 ? (from + rng.int(1, g.bars - 1)) % g.bars : from
      const src = g.melody.notes.slice(from * spb, (from + 1) * spb)
      if (src.every((d) => d === null)) return null
      const kind = rng.pick(['repeat', 'sequence', 'invert'] as const)
      const first = src.find((d) => d !== null)!
      const moved =
        kind === 'sequence'
          ? sequenceDegrees(g.scale, src, rng.pick([-2, -1, 1, 2]))
          : kind === 'invert'
            ? invertDegrees(g.scale, src, first)
            : src
      for (let s = 0; s < spb; s++) g.melody.notes[to * spb + s] = moved[s] === null ? null : clampDegree(moved[s]!)
      g.melody.notes = snapToChords(g, g.melody.notes)
      return {
        genome: g,
        mutationName: 'AddMelodyPhrase',
        description: `motif bar ${from}→${to} (${kind})`,
      }
    },
  },
  {
    name: 'ChangeMelodyOctave',
    category: 'melody',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      g.melody.octave = clamp(g.melody.octave + (rng.chance(0.5) ? 1 : -1), 3, 6)
      return {
        genome: g,
        mutationName: 'ChangeMelodyOctave',
        description: `melody oct=${g.melody.octave}`,
      }
    },
  },
  {
    name: 'ChangeChordRoot',
    category: 'chords',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.chords.progression.length - 1)
      // A related chord from the genre's vocabulary; the bass moves with it and the melody's
      // strong beats re-land on the new chord
      // A chord held over several bars changes as a whole, so the harmonic rhythm stays
      const before = [...g.chords.progression]
      let a = i
      let b = i
      while (a > 0 && before[a - 1] === before[i]) a--
      while (b < before.length - 1 && before[b + 1] === before[i]) b++
      const next = substituteChord(g, i, rng, [before[a - 1], before[b + 1]])
      if (next === before[i]) return null
      for (let k = a; k <= b; k++) {
        g.chords.progression[k] = next
        if (g.chords.colors) g.chords.colors[k] = null
      }
      g.bass.notes = rebaseLine(g, g.bass.notes, before, g.chords.progression)
      g.melody.notes = snapToChords(g, g.melody.notes)
      return {
        genome: g,
        mutationName: 'ChangeChordRoot',
        description: `chord[${i}]=${g.chords.progression[i]}`,
      }
    },
  },
  {
    name: 'ChangeChordVoicing',
    category: 'chords',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      // Genres speak in triads and their colours; power chords only without a genre
      const options = CHORD_VOICINGS.filter((v) => v !== g.chords.voicing && (v !== 'power' || !g.genre))
      g.chords.voicing = rng.pick(options)
      return {
        genome: g,
        mutationName: 'ChangeChordVoicing',
        description: `voicing=${g.chords.voicing}`,
      }
    },
  },
  {
    name: 'ToggleChordRhythm',
    category: 'chords',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.chords.rhythm.length - 1)
      flipAt(g.chords.rhythm, i)
      return {
        genome: g,
        mutationName: 'ToggleChordRhythm',
        description: `chord rhythm @${i}`,
      }
    },
  },
  {
    name: 'ChangeTempo',
    category: 'tempo',
    minIntensity: 'small',
    apply(genome, rng, intensity) {
      const g = cloneGenome(genome)
      const delta =
        intensity === 'small' ? rng.int(-4, 4) : intensity === 'moderate' ? rng.int(-12, 12) : rng.int(-24, 24)
      if (delta === 0) return null
      g.tempo = clamp(g.tempo + delta, TEMPO_MIN, TEMPO_MAX)
      return { genome: g, mutationName: 'ChangeTempo', description: `tempo=${g.tempo}` }
    },
  },
  {
    name: 'ChangeScaleRoot',
    category: 'scale',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      // Modulate to a closely related key (up a fourth or a fifth), not a random jump
      g.scale.root = (g.scale.root + rng.pick([5, 7])) % 12
      return {
        genome: g,
        mutationName: 'ChangeScaleRoot',
        description: `root=${g.scale.root}`,
      }
    },
  },
  {
    name: 'ChangeScaleMode',
    category: 'scale',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const allowed = getStyle(g.genre).harmony.modes
      const options = SCALE_MODES.filter((m) => m !== g.scale.mode && allowed.includes(m))
      if (options.length === 0) return null
      g.scale.mode = rng.pick(options)
      return {
        genome: g,
        mutationName: 'ChangeScaleMode',
        description: `mode=${g.scale.mode}`,
      }
    },
  },
  {
    name: 'AddLayer',
    category: 'layers',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const keys: (keyof typeof g.activeLayers)[] = ['drums', 'bass', 'melody', 'chords']
      if (g.arp) keys.push('arp')
      const off = keys.filter((k) => !g.activeLayers[k])
      if (off.length === 0) return null
      const layer = rng.pick(off)
      g.activeLayers[layer] = true
      return { genome: g, mutationName: 'AddLayer', description: `enable ${layer}` }
    },
  },
  {
    name: 'RemoveLayer',
    category: 'layers',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const on = (Object.keys(g.activeLayers) as (keyof typeof g.activeLayers)[]).filter(
        (k) => g.activeLayers[k] === true,
      )
      if (on.length <= 1) return null
      const layer = rng.pick(on)
      g.activeLayers[layer] = false
      return { genome: g, mutationName: 'RemoveLayer', description: `disable ${layer}` }
    },
  },
  {
    name: 'ChangeSwing',
    category: 'parameters',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const delta = (rng.next() - 0.5) * 0.2
      g.parameters.swing = clamp(g.parameters.swing + delta, 0, 1)
      return {
        genome: g,
        mutationName: 'ChangeSwing',
        description: `swing=${g.parameters.swing.toFixed(2)}`,
      }
    },
  },
  {
    name: 'AddDrumFill',
    category: 'rhythm',
    minIntensity: 'moderate',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const spb = g.stepsPerBar
      // A fill lives in the last quarter of the loop's final bar, leading back to the top.
      // The region is rewritten, not added to, so repeated fills don't pile up.
      const bar = g.bars - 1
      const start = bar * spb + Math.floor(spb * 0.75)
      for (let i = start; i < (bar + 1) * spb; i++) {
        g.drums.hihat[i] = rng.chance(0.5)
        g.drums.snare[i] = rng.chance(0.35)
      }
      return {
        genome: g,
        mutationName: 'AddDrumFill',
        description: `fill bar ${bar}`,
      }
    },
  },
  {
    name: 'EchoBassNote',
    category: 'bass',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const filled = g.bass.notes
        .map((v, i) => (v !== null ? i : -1))
        .filter((i) => i >= 0)
      if (filled.length === 0) return null
      const i = rng.pick(filled)
      const gap = rng.int(1, 3)
      const j = i + gap
      if (j >= g.bass.notes.length) return null
      g.bass.notes[j] = g.bass.notes[i]
      return {
        genome: g,
        mutationName: 'EchoBassNote',
        description: `echo bass ${i}→${j}`,
      }
    },
  },
  {
    name: 'ColorChord',
    category: 'chords',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const i = rng.int(0, g.bars - 1)
      const colors = g.chords.colors ?? g.chords.progression.map(() => null)
      const len = scaleLength(g.scale.mode)
      const next = g.chords.progression[(i + 1) % g.bars]!
      // A secondary dominant when the next chord is a fourth up, otherwise one of the genre's
      // colours (suspensions, added ninths); or back to the genre's default
      const resolvesUp = len === 7 && ((next - g.chords.progression[i]! + 7) % 7 === 3)
      // Colours keep the chord's quality (a minor chord stays minor); more than half the bars
      // coloured is a different progression, so then one goes back to the default
      const family = diatonicChord(g.scale, g.chords.progression[i]!).family
      const fitting = getStyle(g.genre).harmony.colors.filter((c) => colorFits(family, c))
      const coloured = colors.filter((c) => c !== null).length
      let color: string | null
      if (colors[i] !== null && (rng.chance(0.4) || coloured * 2 > g.bars)) color = null
      else if (coloured * 2 >= g.bars) return null
      else if (resolvesUp && rng.chance(0.5)) color = '7'
      else if (fitting.length === 0) return null
      else color = rng.pick(fitting)
      if (color === colors[i]) return null
      colors[i] = color
      g.chords.colors = colors
      g.melody.notes = snapToChords(g, g.melody.notes)
      return { genome: g, mutationName: 'ColorChord', description: `chord[${i}] colour ${color ?? 'default'}` }
    },
  },
  {
    name: 'GhostSnare',
    category: 'rhythm',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const spb = g.stepsPerBar
      const beat = Math.max(1, spb / 4)
      // Ghost notes live off the backbeat; the backbeat itself is left alone
      const cands = g.drums.snare.map((_, i) => i).filter((i) => (i % spb) % (2 * beat) !== beat)
      if (cands.length === 0) return null
      const i = rng.pick(cands)
      g.drums.snare[i] = !g.drums.snare[i]
      return { genome: g, mutationName: 'GhostSnare', description: `ghost snare ${g.drums.snare[i] ? 'on' : 'off'} @${i}` }
    },
  },
  {
    name: 'VaryPercussion',
    category: 'rhythm',
    minIntensity: 'small',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const spb = g.stepsPerBar
      const perc = g.drums.perc ?? g.drums.kick.map(() => false)
      if (rng.chance(0.6) && perc.some(Boolean)) {
        const i = rng.int(0, perc.length - 1)
        perc[i] = !perc[i]
        g.drums.perc = perc
        return { genome: g, mutationName: 'VaryPercussion', description: `perc toggle @${i}` }
      }
      // A Euclidean percussion line against the beat
      const pulses = rng.int(3, Math.max(3, Math.floor(spb / 2) - 1))
      const bar = euclid(pulses, spb, rng.int(0, spb - 1))
      g.drums.perc = Array.from({ length: g.bars }, () => bar).flat()
      return { genome: g, mutationName: 'VaryPercussion', description: `perc euclid ${pulses}/${spb}` }
    },
  },
  {
    name: 'ArpContour',
    category: 'chords',
    layer: 'arp',
    minIntensity: 'small',
    apply(genome, rng) {
      if (!genome.arp) return null
      const g = cloneGenome(genome)
      const spb = g.stepsPerBar
      // Same rhythm, a new contour from the genre's (up, up-down, down-up…)
      const rhythm = g.arp!.pattern.slice(0, spb).map((d) => (d === null ? '-' : 'x')).join('')
      if (!rhythm.includes('x')) return null
      const contour = rng.pick(getStyle(g.genre).arpContours)
      g.arp!.pattern = arpPattern(g, contour, rhythm, rng.pick([3, 4]), rng.pick([1, 2]))
      return { genome: g, mutationName: 'ArpContour', description: `arp ${contour}` }
    },
  },
  {
    name: 'ArpVariation',
    category: 'chords',
    layer: 'arp',
    minIntensity: 'small',
    apply(genome, rng) {
      if (!genome.arp) return null
      const g = cloneGenome(genome)
      const p = g.arp!.pattern
      const spb = g.stepsPerBar
      const i = rng.int(0, p.length - 1)
      const kind = rng.pick(['octave', 'rest', 'note'] as const)
      // Edit the same step in every bar so the figure stays a figure
      for (let k = i % spb; k < p.length; k += spb) {
        if (kind === 'rest') p[k] = p[k] === null ? 0 : null
        else if (kind === 'octave' && p[k] !== null) p[k] = p[k]! >= 4 ? p[k]! - 4 : p[k]! + 4
        else if (kind === 'note') p[k] = Math.max(0, Math.min(11, (p[k] ?? 0) + rng.pick([-1, 1])))
      }
      return { genome: g, mutationName: 'ArpVariation', description: `arp ${kind} @${i % spb}` }
    },
  },
  {
    name: 'RestructureLength',
    category: 'layers',
    minIntensity: 'experimental',
    apply(genome, rng) {
      const g = cloneGenome(genome)
      const newSpb = rng.pick([...STEPS_PER_BAR_OPTIONS])
      const newBars = rng.pick([...BARS_OPTIONS])
      if (newSpb === g.stepsPerBar && newBars === g.bars) return null
      const from = [g.stepsPerBar, g.bars] as const
      const rg = <T>(arr: T[], empty: T) => regrid(arr, ...from, newSpb, newBars, empty)
      g.drums.kick = rg(g.drums.kick, false)
      g.drums.snare = rg(g.drums.snare, false)
      g.drums.hihat = rg(g.drums.hihat, false)
      g.bass.notes = rg(g.bass.notes, null)
      g.melody.notes = rg(g.melody.notes, null)
      g.chords.rhythm = rg(g.chords.rhythm, false)
      if (g.drums.perc) g.drums.perc = rg(g.drums.perc, false)
      if (g.arp) g.arp.pattern = rg(g.arp.pattern, null)
      if (g.chords.colors) g.chords.colors = Array.from({ length: newBars }, (_, i) => g.chords.colors![i % g.bars] ?? null)
      g.chords.progression = Array.from(
        { length: newBars },
        (_, i) => g.chords.progression[i % g.bars]!,
      )
      g.stepsPerBar = newSpb
      g.bars = newBars
      return {
        genome: g,
        mutationName: 'RestructureLength',
        description: `${newSpb}spb x ${newBars} bars`,
      }
    },
  },
]

/** Categories that only edit one layer; mutating a silent layer changes nothing audible. */
const CATEGORY_LAYER: Partial<Record<keyof MutationWeights, keyof MusicGenome['activeLayers']>> = {
  rhythm: 'drums',
  bass: 'bass',
  melody: 'melody',
  chords: 'chords',
}

function pickOp(
  genome: MusicGenome,
  rng: Rng,
  intensity: MutationIntensity,
  config: MutationConfig,
): MutationOp {
  const eligible = MUTATION_OPS.filter((op) => {
    if (!canApply(op, intensity)) return false
    const layer = op.layer ?? CATEGORY_LAYER[op.category]
    return layer === undefined || genome.activeLayers[layer] === true
  })
  // A zero weight switches a category off (e.g. tempo and key inside a song)
  let weights = eligible.map((op) => Math.max(0, config.categoryWeights[op.category]))
  if (weights.every((w) => w === 0)) weights = eligible.map(() => 1)
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < eligible.length; i++) {
    if (weights[i] === 0) continue
    r -= weights[i]!
    if (r <= 0) return eligible[i]!
  }
  return eligible[weights.findLastIndex((w) => w > 0)]!
}

/**
 * Apply one mutation. Retries a few times if an op returns null.
 * Always returns a validated genome.
 */
export function mutate(
  genome: MusicGenome,
  rng: Rng,
  options?: {
    intensity?: MutationIntensity
    config?: MutationConfig
    personality?: Personality
    forceOp?: string
  },
): MutationResult {
  const config = mergeMutationConfig(options?.config ?? DEFAULT_MUTATION_CONFIG, options?.personality)
  const intensity = options?.intensity ?? pickIntensity(rng, config)

  if (options?.forceOp) {
    const op = MUTATION_OPS.find((o) => o.name === options.forceOp)
    if (!op) throw new Error(`Unknown mutation: ${options.forceOp}`)
    const result = op.apply(cloneGenome(genome), rng, intensity)
    if (!result) {
      // Fall through to random if forced op can't apply
    } else {
      validateGenome(result.genome)
      return result
    }
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const op = pickOp(genome, rng, intensity, config)
    const result = op.apply(cloneGenome(genome), rng, intensity)
    if (result) {
      validateGenome(result.genome)
      return result
    }
  }

  // Guaranteed no-op-safe fallback: nudge tempo by ±1, or swing when tempo is frozen (inside a song)
  const g = cloneGenome(genome)
  if (config.categoryWeights.tempo > 0) {
    g.tempo = clamp(g.tempo + (rng.chance(0.5) ? 1 : -1), TEMPO_MIN, TEMPO_MAX)
    validateGenome(g)
    return { genome: g, mutationName: 'ChangeTempo', description: `tempo=${g.tempo} (fallback)` }
  }
  g.parameters.swing = clamp(g.parameters.swing + (rng.chance(0.5) ? 0.02 : -0.02), 0, 1)
  validateGenome(g)
  return {
    genome: g,
    mutationName: 'ChangeSwing',
    description: `swing=${g.parameters.swing.toFixed(2)} (fallback)`,
  }
}

/**
 * Apply N sequential mutations (for moderate/experimental bundles).
 */
export function mutateN(
  genome: MusicGenome,
  rng: Rng,
  n: number,
  options?: Parameters<typeof mutate>[2],
): MutationResult {
  let current = genome
  const names: string[] = []
  const descs: string[] = []
  for (let i = 0; i < n; i++) {
    const r = mutate(current, rng, options)
    current = r.genome
    names.push(r.mutationName)
    descs.push(r.description)
  }
  return {
    genome: current,
    mutationName: names.join('+'),
    description: descs.join('; '),
  }
}
