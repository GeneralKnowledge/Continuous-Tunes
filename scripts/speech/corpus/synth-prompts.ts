/**
 * Render the prompts of a recorded corpus (Festival txt.done.data format, e.g. CMU ARCTIC) with any
 * backend, keeping the plans.
 *
 * Two uses:
 * - synthesis-based alignment (align.py): render everything with the formant backend, then map our
 *   phone boundaries onto the recordings by DTW (Malfrère & Dutoit 1997);
 * - comparison with natural speech (natural-compare.py): render the held-out prompts with each
 *   engine; the plan JSON lets outside engines (external/render.py) say the same thing.
 *
 *   npx tsx scripts/speech/corpus/synth-prompts.ts <txt.done.data> <outDir>
 *       [--voice alder|file.json] [--backend id] [--units dir] [--pulses file.json] [--from arctic_b0490]
 *
 * Writes <outDir>/<id>.wav and <outDir>/<id>.json (the plan, with id and text).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeWav, getVoicePreset, speak, validateVoice, type SpeechVoice } from '../../../src/speech'
import { setUnitDatabase } from '../../../src/speech/backends/units'
import { setExcitationPulses } from '../../../src/speech/backends/formant/klatt'
import { loadNodeLexicon } from '../lexicon-node'
import { loadNodeUnits } from '../units-node'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const voiceSpec = flag('voice') ?? 'alder'
const backend = flag('backend')
const unitsDir = flag('units')
const from = flag('from')
const pulsesFile = flag('pulses')
if (pulsesFile) setExcitationPulses((JSON.parse(readFileSync(pulsesFile, 'utf8')) as { pulses: number[][] }).pulses)
const [prompts, outDir] = args
if (!prompts || !outDir) throw new Error('usage: synth-prompts.ts <txt.done.data> <outDir> [--voice] [--backend] [--units] [--from]')
if (unitsDir) setUnitDatabase(loadNodeUnits(unitsDir))
mkdirSync(outDir, { recursive: true })
const lexicon = loadNodeLexicon()
const voice: SpeechVoice = voiceSpec.endsWith('.json') ? validateVoice(JSON.parse(readFileSync(voiceSpec, 'utf8')) as SpeechVoice).voice : getVoicePreset(voiceSpec)
let n = 0
for (const line of readFileSync(prompts, 'utf8').split('\n')) {
  const m = /^\(\s*(\S+)\s+"(.*)"\s*\)\s*$/.exec(line)
  if (!m) continue
  const [, id, text] = m
  if (from && id! < from) continue
  const r = speak(text!.toLowerCase(), voice, { lexicon, seed: 1, ...(backend ? { backend } : {}) })
  writeFileSync(join(outDir, `${id}.wav`), encodeWav(r.samples, r.sampleRate))
  writeFileSync(join(outDir, `${id}.json`), JSON.stringify({ id, text, ...r.plan }))
  n++
}
console.log(`rendered ${n} prompts to ${outDir}`)
