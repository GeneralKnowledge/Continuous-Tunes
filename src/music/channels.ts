import { getPersonality, type Personality } from './personality'
import type { MusicGenome } from './genome'
import { getSeed, type SeedName } from './seeds'
import { getSongTemplate, type SongTemplate } from './form'

/**
 * A Channel is a genre preset — not a parallel audio stream.
 * It binds a seed genome, personality (which also picks the song form), and evolution defaults.
 */
export interface Channel {
  id: string
  label: string
  seedName: SeedName
  personalityId: string
  candidatesPerGeneration: number
}

export const CHANNELS: Channel[] = [
  {
    id: 'electronic',
    label: 'Electronic',
    seedName: 'electronic',
    personalityId: 'driving',
    candidatesPerGeneration: 10,
  },
  {
    id: 'ambient',
    label: 'Ambient',
    seedName: 'ambient',
    personalityId: 'lush',
    candidatesPerGeneration: 8,
  },
  {
    id: 'minimal',
    label: 'Minimal',
    seedName: 'minimal',
    personalityId: 'sparse',
    candidatesPerGeneration: 8,
  },
  {
    id: 'house',
    label: 'House',
    seedName: 'electronic',
    personalityId: 'groovy',
    candidatesPerGeneration: 12,
  },
  {
    id: 'downtempo',
    label: 'Downtempo',
    seedName: 'ambient',
    personalityId: 'chill',
    candidatesPerGeneration: 8,
  },
  {
    id: 'folk',
    label: 'Folk',
    seedName: 'pentatonic',
    personalityId: 'folk',
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

export function channelSongTemplate(channel: Channel): SongTemplate {
  return getSongTemplate(channel.personalityId)
}
