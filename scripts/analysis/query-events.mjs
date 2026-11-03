#!/usr/bin/env node
/**
 * Every event each song of a songs.json (scripts/render-songs.ts) actually plays, as Strudel
 * produces it: pattern genes, fills, thinning and arrangement included. Uses the song's
 * `analysisCode`, where each layer is labelled with `.color(name)`.
 * Needs Playwright's Chromium (Node can't import @strudel/core). No audio is produced.
 * Usage: node scripts/analysis/query-events.mjs <songs.json> <out.json>
 * Writes { [channel]: { tempo, bars, events: [{ t, d, layer, s, note, gain, velocity, nudge }] } },
 * t and d in bars (cycles).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const [songsFile, outFile] = process.argv.slice(2)
if (!songsFile || !outFile) {
  console.error('Usage: node scripts/analysis/query-events.mjs <songs.json> <out.json>')
  process.exit(1)
}
const songs = JSON.parse(readFileSync(songsFile, 'utf8'))
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dist = join(root, 'node_modules/@strudel/web/dist')
const PAGE = `<!doctype html><script type="module">
import * as strudel from '/strudel/index.mjs'
window.events = async (code, bars) => {
  await strudel.initStrudel()
  const pattern = await strudel.evaluate(code, false)
  const out = []
  for (let b = 0; b < bars; b++) {
    for (const h of pattern.queryArc(b, b + 1)) {
      if (!h.hasOnset()) continue
      const v = h.value
      const note = typeof v.note === 'string' ? v.note : v.note
      out.push({ t: h.whole.begin.valueOf(), d: h.whole.end.valueOf() - h.whole.begin.valueOf(), layer: v.color ?? null, s: v.s ?? null, sound: v.sound ?? null, note: note ?? null, gain: v.gain ?? 1, velocity: v.velocity ?? 1, nudge: v.nudge ?? 0 })
    }
  }
  return out
}
window.ready = true
</script>`
const server = createServer((req, res) => {
  if (req.url === '/') return res.end(PAGE)
  try {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(readFileSync(join(dist, req.url.slice('/strudel/'.length).split('?')[0])))
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(0, r))
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const result = {}
for (const song of songs) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error(`[${song.channel}] page error:`, e.message))
  await page.goto(`http://localhost:${server.address().port}/`)
  await page.waitForFunction(() => window.ready === true)
  const code = song.analysisCode ?? song.code
  const events = await page.evaluate(([c, b]) => window.events(c, b), [code, song.bars])
  await page.close()
  result[song.channel] = { tempo: song.tempo, bars: song.bars, events }
  console.log(`${song.channel}: ${events.length} events`)
}
writeFileSync(outFile, JSON.stringify(result))
await browser.close()
server.close()
