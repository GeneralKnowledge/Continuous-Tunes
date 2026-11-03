#!/usr/bin/env node
/**
 * Build a recording collection under fixed conditions and analyse it:
 * for each seed, compose every channel (render-songs), list the events Strudel plays
 * (query-events), record the audio in real time (record-songs), then write the report (analyze).
 *
 * Usage: node scripts/analysis/make-collection.mjs <outDir> [seeds=42,7,2026] [length=short] [parallel=3]
 * Env: PERFORMANCE=0–1 (performance depth, default 1), NO_AUDIO=1 (symbolic only, fast),
 *      RECORD_ONLY=house,dnb (subset of channels).
 * Recording runs in real time: about 30 min for 9 channels × 3 seeds at parallel 3.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [outDir, seedsArg = '42,7,2026', length = 'short', parallel = '3'] = process.argv.slice(2)
if (!outDir) {
  console.error('Usage: node scripts/analysis/make-collection.mjs <outDir> [seeds] [length] [parallel]')
  process.exit(1)
}
const run = (cmd, args) => {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env })
  if (r.status !== 0) throw new Error(`${cmd} failed`)
}
for (const seed of seedsArg.split(',')) {
  const dir = join(outDir, `seed-${seed}`)
  mkdirSync(dir, { recursive: true })
  const songs = join(dir, 'songs.json')
  run('npx', ['tsx', 'scripts/render-songs.ts', songs, seed, length])
  run('node', ['scripts/analysis/query-events.mjs', songs, join(dir, 'events.json')])
  if (!process.env.NO_AUDIO) run('node', ['scripts/record-songs.mjs', songs, dir, '300', parallel])
}
run('npx', ['tsx', 'scripts/analysis/analyze.ts', outDir])
