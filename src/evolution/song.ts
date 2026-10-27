/**
 * Songs: one theme genome played through a genre form. Each section boundary gets one
 * evolution step (tempo and key frozen inside a song); between songs evolution runs freely.
 */
import { stepGeneration, type EvolutionConfig, type EvolutionState } from './engine'
import { DEFAULT_MUTATION_CONFIG, type MutationConfig } from './mutation'
import { planForm, type SongLength, type SongTemplate } from '../music/form'
import type { Personality } from '../music/personality'
import type { ScheduledSong, SongSection } from '../strudel/compiler'

export interface ComposeOptions {
  template: SongTemplate
  length: SongLength
  personality?: Personality
  config?: Partial<EvolutionConfig>
  now?: number
}

export interface ComposedSong {
  sections: SongSection[]
  /** Generation index the song starts on (bookmarking a song bookmarks this). */
  startGeneration: number
  /** Evolution state after the last section, the parent of the next song. */
  state: EvolutionState
}

/** Inside a song only the parts can change, not the tempo or key. */
function inSongMutation(base: MutationConfig): MutationConfig {
  return { ...base, categoryWeights: { ...base.categoryWeights, tempo: 0, scale: 0 } }
}

export function composeSong(state: EvolutionState, options: ComposeOptions): ComposedSong {
  const form = planForm(options.template, state.genome.tempo, options.length)
  const stepOptions = {
    personality: options.personality,
    now: options.now,
    config: {
      ...options.config,
      mutation: inSongMutation(options.config?.mutation ?? DEFAULT_MUTATION_CONFIG),
    },
  }
  let current = state
  const sections: SongSection[] = []
  form.forEach((section, i) => {
    if (i > 0) current = stepGeneration(current, stepOptions).state
    sections.push({ ...section, genome: current.genome })
  })
  return { sections, startGeneration: state.generationIndex, state: current }
}

/** Between songs: one unrestricted step (tempo and key may move), then compose. */
export function composeNextSong(state: EvolutionState, options: ComposeOptions): ComposedSong {
  const next = stepGeneration(state, {
    personality: options.personality,
    config: options.config,
    now: options.now,
  }).state
  return composeSong(next, options)
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
