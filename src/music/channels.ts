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
  /** Further seed compositions for the genre; a new lineage picks one by its RNG seed. */
  seedVariants?: SeedName[]
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
    seedVersion: 3,
    personalityId: 'driving',
    candidatesPerGeneration: 10,
  },
  {
    id: 'ambient',
    label: 'Ambient',
    seedName: 'ambient',
    seedVersion: 3,
    seedVariants: ['ambient-2'],
    personalityId: 'lush',
    candidatesPerGeneration: 8,
  },
  {
    id: 'minimal',
    label: 'Minimal',
    seedName: 'minimal-techno',
    seedVersion: 4,
    personalityId: 'sparse',
    candidatesPerGeneration: 8,
  },
  {
    id: 'house',
    label: 'House',
    seedName: 'house',
    seedVersion: 4,
    seedVariants: ['house-2'],
    personalityId: 'groovy',
    candidatesPerGeneration: 12,
  },
  {
    id: 'downtempo',
    label: 'Downtempo',
    seedName: 'downtempo',
    seedVersion: 4,
    personalityId: 'chill',
    candidatesPerGeneration: 8,
  },
  {
    id: 'folk',
    label: 'Folk',
    seedName: 'pentatonic',
    seedVersion: 3,
    personalityId: 'folk',
    candidatesPerGeneration: 10,
  },
  {
    id: 'lofi',
    label: 'Lo-fi hip hop',
    seedName: 'lofi',
    seedVersion: 3,
    seedVariants: ['lofi-2'],
    personalityId: 'dusty',
    candidatesPerGeneration: 10,
  },
  {
    id: 'dnb',
    label: 'Drum & bass',
    seedName: 'dnb',
    seedVersion: 3,
    seedVariants: ['dnb-2'],
    personalityId: 'rolling',
    candidatesPerGeneration: 10,
  },
  {
    id: 'trance',
    label: 'Trance',
    seedName: 'trance',
    seedVersion: 3,
    seedVariants: ['trance-2'],
    personalityId: 'euphoric',
    candidatesPerGeneration: 10,
  },
]

export function getChannel(id: string): Channel {
  const c = CHANNELS.find((ch) => ch.id === id)
  if (!c) throw new Error(`Unknown channel: ${id}`)
  return c
}

/** All seed compositions of a channel, the main one first. */
export function channelSeedNames(channel: Channel): SeedName[] {
  return [channel.seedName, ...(channel.seedVariants ?? [])]
}

/**
 * The channel's starting composition. A channel with several picks one by the lineage's RNG
 * seed, so resetting with another seed can start from another idea; seed 0 (default) is the main one.
 */
export function channelSeed(channel: Channel, rngSeed = 0): MusicGenome {
  const names = channelSeedNames(channel)
  return getSeed(names[Math.abs(Math.trunc(rngSeed)) % names.length]!)
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
