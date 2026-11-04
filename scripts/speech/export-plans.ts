/**
 * Export the SpeechPlan of every benchmark item as JSON, so engines outside the app (MBROLA,
 * VocalTractLab, TGSpeechBox, …: scripts/speech/external/) synthesise exactly the same phones,
 * durations and pitch as the built-in backends.
 *
 *   npx tsx scripts/speech/export-plans.ts <outDir> [voice] [--set core|diagnostic|all]
 *
 * Writes <outDir>/<id>.json: { id, text, rate, duration, segments[], pitch[], words[] }.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeText, getVoicePreset, planProsody, withControls } from '../../src/speech'
import { BENCHMARK_SETS, type BenchmarkSet } from '../../src/speech/benchmark'
import { loadNodeLexicon } from './lexicon-node'

const args = process.argv.slice(2)
const i = args.indexOf('--set')
const set = (i >= 0 ? args.splice(i, 2)[1] : 'all') as BenchmarkSet
const [outDir = 'speech-plans', voiceId = 'alder'] = args
const lexicon = loadNodeLexicon()
mkdirSync(outDir, { recursive: true })
for (const item of BENCHMARK_SETS[set]) {
  const voice = withControls(getVoicePreset(voiceId), { rate: item.rate ?? 1 })
  const plan = planProsody(analyzeText(item.text, { lexicon, connectedSpeech: voice.frontend !== 'm1' }), voice)
  writeFileSync(join(outDir, `${item.id}.json`), JSON.stringify({ id: item.id, text: item.text, rate: item.rate ?? 1, ...plan }))
}
console.log(`wrote ${BENCHMARK_SETS[set].length} plans to ${outDir}`)
