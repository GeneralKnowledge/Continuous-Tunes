#!/usr/bin/env node
/**
 * Optional cross-check of src/analysis/audio.ts against Essentia.js on the same recordings
 * (tempo, key, onset rate). Essentia.js is AGPL-3.0, so it is NOT a dependency of this project;
 * install it outside the repo and point at it (see docs/research/audio-analysis.md):
 *
 *   mkdir -p /tmp/ess && (cd /tmp/ess && npm init -y && npm i essentia.js@0.1.3)
 *   ESSENTIA_JS=/tmp/ess/node_modules/essentia.js node scripts/analysis/essentia-crosscheck.mjs <collectionDir>
 *
 * Reads <collectionDir>/seed-<n>/<channel>.mp3 and report.json (from analyze.ts) and prints both
 * measurements side by side. Needs ffmpeg.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const dir = process.argv[2]
const modPath = process.env.ESSENTIA_JS
if (!dir || !modPath) {
  console.error('Usage: ESSENTIA_JS=<path to essentia.js package> node scripts/analysis/essentia-crosscheck.mjs <collectionDir>')
  process.exit(1)
}
const require = createRequire(import.meta.url)
const { Essentia, EssentiaWASM } = require(modPath)
const essentia = new Essentia(EssentiaWASM)
const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'))
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const ENH = { 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', Db: 'C#', Gb: 'F#' }
const rows = []
for (const sd of readdirSync(dir).filter((d) => d.startsWith('seed-')).sort()) {
  for (const f of readdirSync(join(dir, sd)).filter((x) => x.endsWith('.mp3'))) {
    const channel = f.replace('.mp3', '')
    const mine = report.reports.find((r) => r.genre === channel && r.seed === sd.slice(5))
    if (!mine?.audio) continue
    const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', join(dir, sd, f), '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
    const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    const v = essentia.arrayToVector(x)
    const t0 = Date.now()
    const rhythm = essentia.RhythmExtractor2013(v, 208, 'multifeature', 40)
    const key = essentia.KeyExtractor(v)
    const onsets = essentia.OnsetRate(v)
    const ms = Date.now() - t0
    const eKey = ENH[key.key] ?? key.key
    // Same pitch set? (relative major/minor and modal keys share their notes)
    const pc = (k, m) => (NAMES.indexOf(k) + (m === 'minor' ? 3 : 0)) % 12
    rows.push({
      song: `${channel} ${sd.slice(5)}`,
      written: mine.tempo,
      bpmEssentia: Number(rhythm.bpm.toFixed(1)),
      bpmOurs: mine.audio.tempo.bpm,
      keyEssentia: `${eKey} ${key.scale}`,
      keyOurs: `${mine.audio.key.key} ${mine.audio.key.mode}`,
      sameKeySignature: pc(eKey, key.scale) === pc(mine.audio.key.key, mine.audio.key.mode),
      onsetRateEssentia: Number(onsets.onsetRate.toFixed(2)),
      onsetRateOurs: mine.audio.onsets.perSecond,
      essentiaMs: ms,
    })
    console.log(JSON.stringify(rows.at(-1)))
  }
}
const out = join(dir, 'essentia-crosscheck.json')
if (rows.length) writeFileSync(out, JSON.stringify(rows, null, 1))
if (!existsSync(out)) console.error('no recordings with analysis found')
