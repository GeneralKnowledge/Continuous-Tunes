import { getPersonality, type Personality } from './personality'
import type { MusicGenome } from './genome'
import { getSeed, type SeedName } from './seeds'
import { getSongTemplate, type SongTemplate } from './form'
import { getKit, type SoundKit } from './kits'

/**
 * A Channel is a genre preset — not a parallel audio stream.
 * It binds a seed genome, personality (which also picks the song form), and evolution defaults.
 */
export interface Channel {
  id: string
  label: string
  seedName: SeedName
  personalityId: string
  /** Sound kit id (see kits.ts); defaults to the channel id. */
  kitId?: string
  candidatesPerGeneration: number
  /**
   * Bumped when the channel's seed changes, so saved lineages from the old seed are set aside
   * and the channel starts again from the new one.
   */
  seedVersion?: number
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
    seedName: 'minimal-techno',
    seedVersion: 2,
    personalityId: 'sparse',
    candidatesPerGeneration: 8,
  },
  {
    id: 'house',
    label: 'House',
    seedName: 'house',
    seedVersion: 2,
    personalityId: 'groovy',
    candidatesPerGeneration: 12,
  },
  {
    id: 'downtempo',
    label: 'Downtempo',
    seedName: 'downtempo',
    seedVersion: 2,
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
  {
    id: 'lofi',
    label: 'Lo-fi hip hop',
    seedName: 'lofi',
    personalityId: 'dusty',
    candidatesPerGeneration: 10,
  },
  {
    id: 'dnb',
    label: 'Drum & bass',
    seedName: 'dnb',
    personalityId: 'rolling',
    candidatesPerGeneration: 10,
  },
  {
    id: 'trance',
    label: 'Trance',
    seedName: 'trance',
    personalityId: 'euphoric',
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

export function channelKit(channel: Channel): SoundKit {
  return getKit(channel.kitId ?? channel.id)
}

/** Storage id for a channel's saved lineage; changes when the channel's seed changes. */
export function channelStorageId(channel: Channel): string {
  return channel.seedVersion ? `${channel.id}@v${channel.seedVersion}` : channel.id
}
