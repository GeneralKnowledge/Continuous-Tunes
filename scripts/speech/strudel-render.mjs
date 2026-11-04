#!/usr/bin/env node
/**
 * Record Strudel programs to WAV through headless Chromium with the same @strudel/web the app
 * uses, as the standard REPL would play them (no samples needed for speech code).
 *
 *   node scripts/speech/strudel-render.mjs <items.json> <outDir> [parallel]
 *
 * items.json: [{ id, code, seconds, speech? }] (speech = length of the utterance, seconds). Each program plays for one cycle (`seconds`) plus a short
 * tail; the output is tapped as PCM before the speakers, so nothing is lossy-encoded.
 * Writes <outDir>/<id>.wav (mono, the AudioContext's rate). Rendering is real time.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const [itemsFile, outDir, parArg] = process.argv.slice(2)
if (!itemsFile || !outDir) {
  console.error('Usage: node scripts/speech/strudel-render.mjs <items.json> <outDir> [parallel]')
  process.exit(1)
}
const items = JSON.parse(readFileSync(itemsFile, 'utf8'))
const parallel = Number(parArg ?? 3)
mkdirSync(outDir, { recursive: true })
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const strudelDist = join(root, 'node_modules/@strudel/web/dist')

const PAGE = `<!doctype html><meta charset="utf-8"><body><script type="module">
import * as strudel from '/strudel/index.mjs'
const taps = new Map()
const connect = AudioNode.prototype.connect
AudioNode.prototype.connect = function (target, ...rest) {
  const ctx = this.context
  if (target instanceof AudioDestinationNode && !(ctx instanceof OfflineAudioContext)) {
    let tap = taps.get(ctx)
    if (!tap) {
      const sp = ctx.createScriptProcessor(4096, 1, 1)
      tap = { sp, chunks: [], on: false }
      sp.onaudioprocess = (e) => { if (tap.on) tap.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))) }
      const sink = ctx.createGain(); sink.gain.value = 0
      connect.call(sp, sink); connect.call(sink, ctx.destination)
      taps.set(ctx, tap)
    }
    connect.call(this, tap.sp)
  }
  return connect.call(this, target, ...rest)
}
window.record = async (code, seconds) => {
  await strudel.initStrudel()
  await strudel.initAudio()
  await strudel.evaluate('note("c3").s("sine").gain(0.0001)')
  for (let i = 0; i < 40 && taps.size === 0; i++) await new Promise((r) => setTimeout(r, 250))
  await new Promise((r) => setTimeout(r, 1000))
  strudel.hush()
  await new Promise((r) => setTimeout(r, 500))
  const tap = [...taps.values()][0]
  tap.chunks = []; tap.on = true
  await strudel.evaluate(code)
  await new Promise((r) => setTimeout(r, seconds * 1000 + 300))
  strudel.hush()
  await new Promise((r) => setTimeout(r, 300))
  tap.on = false
  const n = tap.chunks.reduce((s, c) => s + c.length, 0)
  const out = new Float32Array(n); let o = 0
  for (const c of tap.chunks) { out.set(c, o); o += c.length }
  const rate = tap.sp.context.sampleRate
  const b = new Uint8Array(out.buffer); let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return { rate, data: btoa(s) }
}
window.ready = true
</script>`

const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(PAGE)
  }
  if (req.url?.startsWith('/strudel/')) {
    try {
      const body = readFileSync(join(strudelDist, req.url.slice('/strudel/'.length).split('?')[0]))
      res.writeHead(200, { 'content-type': 'text/javascript' })
      return res.end(body)
    } catch {}
  }
  res.writeHead(404)
  res.end()
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] })

function wav(samples, rate, keep) {
  // trim the leading silence before the first sound so items line up with their text
  let a = 0
  while (a < samples.length && Math.abs(samples[a]) < 1e-4) a++
  const from = Math.max(0, a - Math.round(rate * 0.05))
  // keep one pass only: the pattern loops, so cut before the next cycle starts
  const x = samples.subarray(from, keep ? from + Math.round(rate * (keep + 0.1)) : samples.length)
  const buf = Buffer.alloc(44 + x.length * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + x.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(x.length * 2, 40)
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2)
  return buf
}

async function one(item) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error(`[${item.id}] page error: ${e.message}`))
  await page.goto(`http://localhost:${port}/`)
  await page.waitForFunction(() => window.ready === true)
  const { rate, data } = await page.evaluate(([c, s]) => window.record(c, s), [item.code, item.seconds])
  await page.close()
  const raw = Buffer.from(data, 'base64')
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
  writeFileSync(join(outDir, `${item.id}.wav`), wav(samples, rate, item.speech))
}

const queue = [...items]
let done = 0
await Promise.all(
  Array.from({ length: parallel }, async () => {
    while (queue.length) {
      const item = queue.shift()
      for (let attempt = 1; ; attempt++) {
        try {
          await one(item)
          break
        } catch (e) {
          if (attempt >= 3) throw e
          console.error(`${item.id}: attempt ${attempt} failed (${String(e.message).split('\n')[0]})`)
        }
      }
      if (++done % 10 === 0) console.error(`${done}/${items.length}`)
    }
  }),
)
await browser.close()
server.close()
