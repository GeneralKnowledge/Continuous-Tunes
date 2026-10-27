/**
 * Songs: a theme (A) and contrast material (B) played through a genre form. The theme gets one
 * evolution step at each section boundary (tempo and key frozen inside a song); drops, peaks and
 * choruses play B, derived from the theme when the song starts. Between songs evolution runs freely.
 */
import { contrastMetrics, deriveContrast, varyContrast } from './contrast'
import { stepGeneration, type EvolutionConfig, type EvolutionState } from './engine'
import { DEFAULT_MUTATION_CONFIG, type MutationConfig } from './mutation'
import {
  HIGHLIGHT_ROLES,
  planForm,
  varyForm,
  type PlannedSection,
  type SongLength,
  type SongTemplate,
} from '../music/form'
import { createRng } from '../lib/rng'
import type { Personality } from '../music/personality'
import type { ScheduledSong, SongSection } from '../strudel/compiler'

export interface ComposeOptions {
  template: SongTemplate
  length: SongLength
  personality?: Personality
  config?: Partial<EvolutionConfig>
  now?: number
  /** Sections to play instead of the template's plan (a varied form). */
  form?: PlannedSection[]
}

/** Sections that play the contrast material. */
export const CONTRAST_ROLES: ReadonlySet<string> = HIGHLIGHT_ROLES

export interface ComposedSong {
  sections: SongSection[]
  /** Generation index the song starts on (bookmarking a song bookmarks this). */
  startGeneration: number
  /** Evolution state after the last section, the parent of the next song. */
  state: EvolutionState
  /** How the form differs from the genre's template plan. */
  formChanges: string[]
}

/** Inside a song only the parts can change, not the tempo or key. */
function inSongMutation(base: MutationConfig): MutationConfig {
  return { ...base, categoryWeights: { ...base.categoryWeights, tempo: 0, scale: 0 } }
}

export function composeSong(state: EvolutionState, options: ComposeOptions): ComposedSong {
  const form = options.form ?? planForm(options.template, state.genome.tempo, options.length)
  const stepOptions = {
    personality: options.personality,
    now: options.now,
    config: {
      ...options.config,
      mutation: inSongMutation(options.config?.mutation ?? DEFAULT_MUTATION_CONFIG),
    },
  }
  // B comes from its own seed so the theme's lineage is unchanged by it
  const seed = (state.rngState ^ 0x9e3779b9) >>> 0
  let contrast = deriveContrast(state.genome, seed, { personality: options.personality }).genome
  let contrastUses = 0
  let current = state
  const sections: SongSection[] = []
  form.forEach((section, i) => {
    if (i > 0) current = stepGeneration(current, stepOptions).state
    if (CONTRAST_ROLES.has(section.role)) {
      if (contrastUses > 0) contrast = varyContrast(contrast, seed + i, options.personality)
      contrastUses++
      sections.push({ ...section, genome: contrast, material: 'B' })
    } else {
      sections.push({ ...section, genome: current.genome, material: 'A' })
    }
  })
  return { sections, startGeneration: state.generationIndex, state: current, formChanges: [] }
}

/**
 * Between songs: one unrestricted step (tempo and key may move), a variation on the form
 * (one or two changes within the genre's template), then compose.
 */
export function composeNextSong(state: EvolutionState, options: ComposeOptions): ComposedSong {
  const next = stepGeneration(state, {
    personality: options.personality,
    config: options.config,
    now: options.now,
  }).state
  // The form has its own seed so the theme's lineage is unchanged by it
  const rng = createRng((next.rngState ^ 0x85ebca6b) >>> 0)
  const planned = planForm(options.template, next.genome.tempo, options.length)
  const varied = varyForm(planned, rng, rng.int(1, 2))
  const song = composeSong(next, { ...options, form: varied.form })
  return { ...song, formChanges: varied.changes }
}

export interface SongScore {
  /** How well B contrasts with the theme it was derived from (0–1). */
  contrast: number
  /** The energy rises to its peak on contrast material and comes back down at the end (0–1). */
  energyShape: number
  /** Whole phrases, an intro and an outro (0–1). */
  form: number
  score: number
}

/** Song-level score on top of the per-genome fitness. */
export function evaluateSong(sections: readonly SongSection[]): SongScore {
  // B is derived from the theme the song starts with
  const theme = sections.find((s) => s.material !== 'B')?.genome
  const contrasts = theme
    ? sections.filter((s) => s.material === 'B').map((s) => contrastMetrics(theme, s.genome).score)
    : []
  const contrast = contrasts.length ? contrasts.reduce((a, b) => a + b, 0) / contrasts.length : 0

  const energy = (s: SongSection) => Math.max(s.energy, s.energyEnd ?? s.energy)
  const peak = Math.max(...sections.map(energy))
  const peakIndex = sections.findIndex((s) => energy(s) === peak)
  const first = sections[0]
  const last = sections[sections.length - 1]
  const shapeChecks = [
    sections[peakIndex]?.material === 'B',
    peakIndex > 0,
    first !== undefined && energy(first) < peak,
    last !== undefined && (last.energyEnd ?? last.energy) < peak,
  ]
  const energyShape = shapeChecks.filter(Boolean).length / shapeChecks.length

  const formChecks = [
    sections.length > 0 && sections.every((s) => s.bars >= 4 && s.bars % 4 === 0),
    first?.role === 'intro',
    last?.role === 'outro',
  ]
  const form = formChecks.filter(Boolean).length / formChecks.length

  const score = (contrast + energyShape + form) / 3
  return {
    contrast: Number(contrast.toFixed(3)),
    energyShape: Number(energyShape.toFixed(3)),
    form: Number(form.toFixed(3)),
    score: Number(score.toFixed(3)),
  }
}

/** Where a cycle falls inside a scheduled song. */
export interface SongPosition {
  sectionIndex: number
  barInSection: number
  barsLeftInSection: number
  barsLeftInSong: number
}

export function positionInSong(song: ScheduledSong, barsElapsed: number): SongPosition | null {
  let start = 0
  const total = song.sections.reduce((a, s) => a + s.bars, 0)
  if (barsElapsed < 0 || barsElapsed >= total) return null
  for (let i = 0; i < song.sections.length; i++) {
    const bars = song.sections[i]!.bars
    if (barsElapsed < start + bars) {
      const bar = Math.floor(barsElapsed - start)
      return {
        sectionIndex: i,
        barInSection: bar,
        barsLeftInSection: bars - bar,
        barsLeftInSong: Math.ceil(total - barsElapsed),
      }
    }
    start += bars
  }
  return null
}
