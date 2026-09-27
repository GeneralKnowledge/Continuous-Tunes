#!/usr/bin/env tsx
/**
 * Headless evolution CLI.
 * Usage: npm run evolve -- [generations] [seed] [channel]
 * Example: npm run evolve 200 42 electronic
 */
import { createEvolutionState, runGenerations } from '../src/evolution/engine'
import { channelPersonality, channelSeed, getChannel, CHANNELS } from '../src/music/channels'
import { evaluateFitness } from '../src/evolution/fitness'

function main(): void {
  const generations = Number.parseInt(process.argv[2] ?? '100', 10)
  const seed = Number.parseInt(process.argv[3] ?? '42', 10)
  const channelId = process.argv[4] ?? 'electronic'

  if (!Number.isFinite(generations) || generations < 1) {
    console.error('Usage: evolve <generations> [seed] [channel]')
    process.exit(1)
  }

  const channel = getChannel(channelId)
  const personality = channelPersonality(channel)
  const genome = channelSeed(channel)

  console.log(`Evolutionary Strudel — headless`)
  console.log(`channel=${channel.label} seed=${seed} generations=${generations}`)
  console.log(`candidates/gen=${channel.candidatesPerGeneration}`)
  console.log(`channels: ${CHANNELS.map((c) => c.id).join(', ')}`)
  console.log('---')

  let state = createEvolutionState(genome, seed, {
    personality,
    channelId: channel.id,
    config: {
      candidatesPerGeneration: channel.candidatesPerGeneration,
      historySize: 64,
    },
  })

  const start = Date.now()
  const checkpointEvery = Math.max(1, Math.floor(generations / 10))

  for (let i = 0; i < generations; i++) {
    state = runGenerations(state, 1, {
      personality,
      config: {
        candidatesPerGeneration: channel.candidatesPerGeneration,
        historySize: 64,
      },
      now: i + 1,
    })

    if ((i + 1) % checkpointEvery === 0 || i === generations - 1) {
      const fit = evaluateFitness(state.genome, personality)
      console.log(
        `gen ${String(state.generationIndex).padStart(5)}  ` +
          `fitness=${fit.score.toFixed(4)}  ` +
          `tempo=${state.genome.tempo}  ` +
          `stag=${state.stagnationStreak}  ` +
          `mut=${state.lastMutationName}`,
      )
    }
  }

  const ms = Date.now() - start
  console.log('---')
  console.log(`done in ${ms}ms`)
  console.log(`final generation: ${state.generationIndex}`)
  console.log(`history size: ${state.history.records.length} (bounded)`)
  console.log(
    `scale: root=${state.genome.scale.root} mode=${state.genome.scale.mode}`,
  )
  console.log(
    `layers: ${Object.entries(state.genome.activeLayers)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(',')}`,
  )
}

main()
