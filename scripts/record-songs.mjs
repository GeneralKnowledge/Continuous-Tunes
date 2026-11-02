#!/usr/bin/env node
/**
 * Record songs written by scripts/render-songs.ts to MP3, in real time, through headless Chromium.
 * Needs Playwright with Chromium, ffmpeg, and network access to the dirt-samples on GitHub.
 * Usage: node scripts/record-songs.mjs <songs.json> <outDir> [maxSeconds] [parallel]
 *
 * Recording gotchas: the page must call initStrudel with the dirt-samples prebake AND initAudio()
 * (else no drum samples and no worklet synths), and the destination tap must skip
 * OfflineAudioContext (Strudel renders reverb impulses offline).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const [songsFile, outDir, maxArg, parArg] = process.argv.slice(2)
if (!songsFile || !outDir) {
  console.error('Usage: node scripts/record-songs.mjs <songs.json> <outDir> [maxSeconds] [parallel]')
  process.exit(1)
}
const maxSeconds = Number(maxArg ?? 300)
const parallel = Number(parArg ?? 2)
const songs = JSON.parse(readFileSync(songsFile, 'utf8'))
// RECORD_ONLY=house,dnb records a subset
const only = new Set((process.env.RECORD_ONLY ?? '').split(',').filter(Boolean))
mkdirSync(outDir, { recursive: true })

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const strudelDist = join(root, 'node_modules/@strudel/web/dist')

const PAGE = `<!doctype html><meta charset="utf-8"><body><script type="module">
import * as strudel from '/strudel/index.mjs'
const taps = new Map()
const connect = AudioNode.prototype.connect
AudioNode.prototype.connect = function (target, ...rest) {
  const ctx = this.context
  if (target instanceof AudioDestinationNode && !(ctx instanceof OfflineAudioContext)) {
    let tap = taps.get(ctx)
    if (!tap) { tap = ctx.createMediaStreamDestination(); taps.set(ctx, tap) }
    connect.call(this, tap)
  }
  return connect.call(this, target, ...rest)
}
window.record = async (code, seconds) => {
  await strudel.initStrudel({ prebake: async () => { await strudel.samples('github:tidalcycles/dirt-samples') } })
  await strudel.initAudio()
  // Warm up: load every sample the code names before the clock starts
  const names = new Set()
  for (const m of code.matchAll(/s\\("([^"]*)"\\)/g)) {
    for (const t of m[1].split(/[\\s,\\[\\]<>*]+/)) if (/^[a-z]/.test(t)) names.add(t)
  }
  const warm = ['note("c3").sound("sine").gain(0.0001)']
  if (names.size) warm.push('s("' + [...names].join(' ') + '").gain(0.0001)')
  await strudel.evaluate('stack(' + warm.join(', ') + ')')
  // Samples load on first use; wait until something has reached the speakers, then a little more
  for (let i = 0; i < 60 && taps.size === 0; i++) await new Promise((r) => setTimeout(r, 500))
  await new Promise((r) => setTimeout(r, 4000))
  strudel.hush()
  const tap = [...taps.values()][0]
  if (!tap) throw new Error('no audio destination tapped')
  const rec = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 })
  const chunks = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  const done = new Promise((r) => (rec.onstop = r))
  rec.start(1000)
  await strudel.evaluate(code)
  await new Promise((r) => setTimeout(r, seconds * 1000))
  strudel.hush()
  await new Promise((r) => setTimeout(r, 1500))
  rec.stop()
  await done
  const buf = new Uint8Array(await new Blob(chunks).arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}
window.ready = true
</script>`

const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE)
    return
  }
  if (req.url?.startsWith('/strudel/')) {
    try {
      const body = readFileSync(join(strudelDist, req.url.slice('/strudel/'.length).split('?')[0]))
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end()
    }
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
})

async function recordOne(song) {
  if (only.size && !only.has(song.channel)) return
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error(`[${song.channel}] page error: ${e.message}`))
  if (process.env.RECORD_DEBUG) page.on('console', (m) => console.error(`[${song.channel}] ${m.text()}`))
  await page.goto(`http://localhost:${port}/`)
  await page.waitForFunction(() => window.ready === true)
  const seconds = Math.min(maxSeconds, song.seconds + 2)
  const t0 = Date.now()
  const b64 = await page.evaluate(([code, s]) => window.record(code, s), [song.code, seconds])
  await page.close()
  const webm = join(outDir, `${song.channel}.webm`)
  writeFileSync(webm, Buffer.from(b64, 'base64'))
  const mp3 = join(outDir, `${song.channel}.mp3`)
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3])
  console.log(`${song.channel}: ${seconds.toFixed(0)} s recorded in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${mp3}`)
}

const queue = [...songs]
await Promise.all(
  Array.from({ length: parallel }, async () => {
    while (queue.length) {
      const song = queue.shift()
      for (let attempt = 1; ; attempt++) {
        try {
          await recordOne(song)
          break
        } catch (e) {
          if (attempt >= 3) throw e
          console.error(`${song.channel}: attempt ${attempt} failed (${e.message.split('\n')[0]}), retrying`)
        }
      }
    }
  }),
)
await browser.close()
server.close()
