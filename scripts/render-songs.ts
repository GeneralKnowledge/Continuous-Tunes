#!/usr/bin/env tsx
/**
 * Compose one song per channel, deterministically, and write its genome, form and Strudel code
 * to a JSON file for listening tests (see scripts/record-songs.mjs).
 * Usage: npx tsx scripts/render-songs.ts <out.json> [rngSeed] [length] [channel,channel,...]
 * Env PERFORMANCE=0–1 sets the performance depth (velocity, micro-timing, phrase shape; default 1,
 * 0 = every hit as written, as before the performance layer).
 */
import { writeFileSync } from 'node:fs'
import { createEvolutionState } from '../src/evolution/engine'
import { composeSong } from '../src/evolution/song'
import {
  CHANNELS,
  channelKit,
  channelPersonality,
  channelSeed,
  channelSongTemplate,
  getChannel,
} from '../src/music/channels'
import type { SongLength } from '../src/music/form'
import { compileTimeline, songBars } from '../src/strudel/compiler'

const out = process.argv[2] ?? 'songs.json'
const rngSeed = Number.parseInt(process.argv[3] ?? '42', 10)
const length = (process.argv[4] ?? 'short') as SongLength
const ids = process.argv[5] ? process.argv[5].split(',') : CHANNELS.map((c) => c.id)
const performance = process.env.PERFORMANCE === undefined ? 1 : Number(process.env.PERFORMANCE)

const songs = ids.map((id) => {
  const channel = getChannel(id)
  const personality = channelPersonality(channel)
  const state = createEvolutionState(channelSeed(channel), rngSeed, {
    personality,
    channelId: channel.id,
    config: { candidatesPerGeneration: channel.candidatesPerGeneration },
  })
  const song = composeSong(state, {
    template: channelSongTemplate(channel),
    length,
    personality,
    config: { candidatesPerGeneration: channel.candidatesPerGeneration },
  })
  const tempo = state.genome.tempo
  const scheduled = { startCycle: 0, sections: song.sections }
  // The song once, then silence (no safety-net repeat)
  const once = (c: string) => c.replace(/,\n {2}\[[\d.]+, song0\]\n\)$/, ',\n  [8, silence]\n)')
  const code = once(compileTimeline([scheduled], tempo, undefined, channelKit(channel), { performance }))
  // The same song with every layer labelled, for scripts/analysis (identical audio)
  const analysisCode = once(compileTimeline([scheduled], tempo, undefined, channelKit(channel), { tagLayers: true, performance }))
  const bars = songBars(scheduled)
  return {
    channel: id,
    tempo,
    bars,
    seconds: (bars * 4 * 60) / tempo,
    form: song.sections.map((s) => `${s.role}:${s.bars}${s.material === 'B' ? 'B' : ''}`).join(' '),
    theme: state.genome,
    sections: song.sections.map((s) => ({ role: s.role, bars: s.bars, material: s.material ?? 'A', genome: s.genome })),
    code,
    analysisCode,
    rngSeed,
    length,
    performance,
  }
})

writeFileSync(out, JSON.stringify(songs, null, 1))
for (const s of songs) console.log(`${s.channel.padEnd(11)} ${s.tempo}bpm ${s.bars} bars ${s.seconds.toFixed(0)}s  ${s.form}`)
