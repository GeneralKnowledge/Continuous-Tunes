/**
 * Turn rendered speech (one WAV per item) into Strudel programs that play it
 * (src/speech/strudel/recorded.ts), in the items format strudel-render.mjs reads.
 *
 *   npx tsx scripts/speech/neural/compile.ts <wavDir> <items.json> <out.json> [--kbps 48]
 *
 * Audio is encoded as mono MP3 with ffmpeg (decodable by every browser's decodeAudioData).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { compileStrudelRecording } from '../../../src/speech/strudel/recorded'

const args = process.argv.slice(2)
const ki = args.indexOf('--kbps')
const kbps = ki >= 0 ? args.splice(ki, 2)[1]! : '48'
const [wavDir, itemsFile, out] = args
if (!wavDir || !itemsFile || !out) throw new Error('usage: compile.ts <wavDir> <items.json|plansDir> <out.json>')
const items: { id: string; text: string }[] = JSON.parse(readFileSync(itemsFile, 'utf8'))
const res = items
  .filter((it) => existsSync(join(wavDir, `${it.id}.wav`)))
  .map((it) => {
    const wav = join(wavDir, `${it.id}.wav`)
    const mp3 = execFileSync('ffmpeg', ['-v', 'error', '-i', wav, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-f', 'mp3', '-'], { maxBuffer: 1 << 26 })
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString())
    const r = compileStrudelRecording({ audio: mp3.toString('base64'), seconds: dur, text: it.text, tail: 0.3, source: 'neural TTS' })
    return { id: it.id, code: r.code, seconds: r.seconds, speech: dur, events: 1 }
  })
writeFileSync(out, JSON.stringify(res))
const len = res.reduce((s, x) => s + x.code.length, 0) / res.length
console.log(`${res.length} programs, ${len.toFixed(0)} chars on average`)
