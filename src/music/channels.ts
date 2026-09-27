import { getPersonality, type Personality } from './personality'
import type { MusicGenome } from './genome'
import { getSeed, type SeedName } from './seeds'

/**
 * A Channel is a genre preset — not a parallel audio stream.
 * It binds a seed genome, personality, and evolution defaults.
 */
export interface Channel {
  id: string
  label: string
  seedName: SeedName
  personalityId: string
  defaultGenerationBars: number
  candidatesPerGeneration: number
}

export const CHANNELS: Channel[] = [
  {
    id: 'electronic',
    label: 'Electronic',
    seedName: 'electronic',
    personalityId: 'driving',
    defaultGenerationBars: 8,
    candidatesPerGeneration: 10,
  },
  {
    id: 'ambient',
    label: 'Ambient',
    seedName: 'ambient',
    personalityId: 'lush',
    defaultGenerationBars: 16,
    candidatesPerGeneration: 8,
  },
  {
    id: 'minimal',
    label: 'Minimal',
    seedName: 'minimal',
    personalityId: 'sparse',
    defaultGenerationBars: 8,
    candidatesPerGeneration: 8,
  },
  {
    id: 'house',
    label: 'House',
    seedName: 'electronic',
    personalityId: 'groovy',
    defaultGenerationBars: 8,
    candidatesPerGeneration: 12,
  },
  {
    id: 'downtempo',
    label: 'Downtempo',
    seedName: 'ambient',
    personalityId: 'chill',
    defaultGenerationBars: 16,
    candidatesPerGeneration: 8,
  },
  {
    id: 'folk',
    label: 'Folk',
    seedName: 'pentatonic',
    personalityId: 'folk',
    defaultGenerationBars: 8,
    candidatesPerGeneration: 10,
  },
]

export function getChannel(id: string): Channel {
  const c = CHANNELS.find((ch) => ch.id === id)
  if (!c) throw new Error(`Unknown channel: ${id}`)
  return c
}

export function channelSeed(channel: Channel): MusicGenome {
  return getSeed(channel.seedName)
}

export function channelPersonality(channel: Channel): Personality {
  return getPersonality(channel.personalityId)
}

export const EVOLVE_BAR_OPTIONS = [4, 8, 16, 32] as const
export type EvolveBars = (typeof EVOLVE_BAR_OPTIONS)[number]
