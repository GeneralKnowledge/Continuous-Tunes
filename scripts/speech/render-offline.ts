/**
 * Render sentences with the Strudel voice instrument's own worklet DSP, offline in Node
 * (offline.ts: the processor code Strudel runs, driven block by block). Much faster than the
 * real-time browser render, for acoustic measurements and quick experiments; anything reported
 * as a result is confirmed with strudel-render.mjs.
 *
 *   npx tsx scripts/speech/render-offline.ts <outDir> <items.json|arctic:<from>-<to>> [--voice alder] [--rate 16000]
 *
 * items.json: [{ id, text }]. Writes <outDir>/x/<id>.wav (mono int16) and <outDir>/plans/<id>.json
 * (the plan's segments, for measuring phones at known times).
 * Env CONS: consonant settings JSON (consonants.ts) for experiments.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeText, encodeWav, getVoicePreset, planProsody } from '../../src/speech'
import { strudelVoiceOptions } from '../../src/speech/strudel/instrument/compile'
import { renderOffline } from '../../src/speech/strudel/instrument/offline'
import { loadNodeLexicon } from './lexicon-node'

const args = process.argv.slice(2)
const opt = (k: string, d: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args.splice(i, 2)[1]! : d
}
const voice = getVoicePreset(opt('--voice', 'alder'))
const rate = Number(opt('--rate', '16000'))
const [outDir, src] = args
if (!outDir || !src) throw new Error('usage: render-offline.ts <outDir> <items.json|arctic:a-b>')

let items: { id: string; text: string }[]
if (src.startsWith('arctic:')) {
  const [from, to] = src.slice(7).split('-')
  items = []
  for (const line of readFileSync(`${process.env.HOME}/research/awb/etc/txt.done.data`, 'utf8').split('\n')) {
    const m = line.match(/\( (\S+) "(.*)" \)/)
    if (m && m[1]! >= `arctic_${from}` && m[1]! <= `arctic_${to}`) items.push({ id: m[1]!, text: m[2]! })
  }
} else items = JSON.parse(readFileSync(src, 'utf8'))

const lexicon = loadNodeLexicon()
mkdirSync(join(outDir, 'x'), { recursive: true })
mkdirSync(join(outDir, 'plans'), { recursive: true })
for (const it of items) {
  const plan = planProsody(analyzeText(it.text, { lexicon }), voice)
  const { settings, track } = strudelVoiceOptions(plan, voice, process.env.CONS ? { consonants: JSON.parse(process.env.CONS) } : {})
  const audio = renderOffline({ ...settings, track }, rate)
  writeFileSync(join(outDir, 'x', `${it.id}.wav`), encodeWav(audio.subarray(0, Math.ceil((plan.duration + 0.1) * rate)), rate))
  writeFileSync(join(outDir, 'plans', `${it.id}.json`), JSON.stringify({ id: it.id, text: it.text, segments: plan.segments }))
}
console.log(`${items.length} rendered to ${outDir}`)
