/**
 * Compile the Strudel voice corpus (src/speech/strudel/corpus.ts) into Strudel programs for
 * strudel-render.mjs, with either the instrument (default) or the PR #19 pattern compiler.
 *
 *   npx tsx scripts/speech/voice-corpus.ts <items.json> [--engine instrument|patterns] [--ids a,b] [--voice alder]
 *
 * Writes [{ id, category, text, code, seconds, speech }] and prints the program sizes.
 */
import { writeFileSync } from 'node:fs'
import { analyzeText, getVoicePreset, planProsody } from '../../src/speech'
import { compileStrudelSpeech } from '../../src/speech/strudel/compile'
import { VOICE_CORPUS } from '../../src/speech/strudel/corpus'
import { compileStrudelVoice } from '../../src/speech/strudel/instrument/compile'
import { loadNodeLexicon } from './lexicon-node'

const args = process.argv.slice(2)
const opt = (k: string, d: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args.splice(i, 2)[1]! : d
}
const engine = opt('--engine', 'instrument')
const ids = opt('--ids', '')
const voice = getVoicePreset(opt('--voice', 'alder'))
const [out] = args
if (!out) throw new Error('usage: voice-corpus.ts <items.json> [--engine instrument|patterns] [--ids a,b]')
const lexicon = loadNodeLexicon()
const pick = ids ? VOICE_CORPUS.filter((c) => ids.split(',').includes(c.id)) : VOICE_CORPUS
const tail = 0.3
const items = pick.map((c) => {
  const plan = planProsody(analyzeText(c.text, { lexicon }), voice)
  const r = engine === 'patterns' ? compileStrudelSpeech(plan, voice, { text: c.text, tail }) : compileStrudelVoice(plan, voice, { text: c.text, tail })
  return { id: c.id, category: c.category, text: c.text, code: r.code, seconds: r.seconds, speech: r.seconds - tail }
})
writeFileSync(out, JSON.stringify(items))
const len = items.reduce((s, x) => s + x.code.length, 0) / items.length
console.log(`${items.length} programs (${engine}), ${len.toFixed(0)} chars on average`)
