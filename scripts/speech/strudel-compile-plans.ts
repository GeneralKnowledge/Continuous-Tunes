/**
 * Compile exported plans (export-plans.ts) into Strudel programs for strudel-render.mjs, so the
 * Strudel voice is scored on exactly the same phones, timing and pitch as the other engines.
 *
 *   npx tsx scripts/speech/strudel-compile-plans.ts <plansDir> <items.json> [voice] [--step 0.02]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getVoicePreset } from '../../src/speech'
import type { SpeechPlan } from '../../src/speech/plan'
import { compileStrudelSpeech } from '../../src/speech/strudel/compile'

const args = process.argv.slice(2)
const si = args.indexOf('--step')
const step = si >= 0 ? Number(args.splice(si, 2)[1]) : undefined
const [plansDir, out, voiceId = 'alder'] = args
if (!plansDir || !out) throw new Error('usage: strudel-compile-plans.ts <plansDir> <items.json> [voice] [--step s]')
const voice = getVoicePreset(voiceId)
const items = readdirSync(plansDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    const p = JSON.parse(readFileSync(join(plansDir, f), 'utf8')) as SpeechPlan & { id: string; text: string }
    const r = compileStrudelSpeech(p, voice, { text: p.text, step, tail: 0.3, tune: process.env.STRUDEL_TUNE ? JSON.parse(process.env.STRUDEL_TUNE) : undefined })
    return { id: p.id, code: r.code, seconds: r.seconds, speech: r.seconds - 0.3, events: r.events }
  })
writeFileSync(out, JSON.stringify(items))
const ev = items.reduce((s, x) => s + x.events / x.seconds, 0) / items.length
const len = items.reduce((s, x) => s + x.code.length, 0) / items.length
console.log(`${items.length} programs, ${ev.toFixed(0)} events/s, ${len.toFixed(0)} chars on average`)
