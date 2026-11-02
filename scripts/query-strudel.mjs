#!/usr/bin/env node
/**
 * Evaluate Strudel code in headless Chromium (no audio) and print the events it produces, so a
 * compiled genome can be checked against the composition it came from.
 * Usage: node scripts/query-strudel.mjs <file-with-code | -e code> [fromCycle] [toCycle]
 * Prints JSON lines: { begin, end, value }.
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const args = process.argv.slice(2)
const code = args[0] === '-e' ? args[1] : readFileSync(args[0], 'utf8')
const rest = args[0] === '-e' ? args.slice(2) : args.slice(1)
const from = Number(rest[0] ?? 0)
const to = Number(rest[1] ?? 1)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'node_modules/@strudel/web/dist')
const PAGE = `<!doctype html><script type="module">
import * as strudel from '/strudel/index.mjs'
window.query = async (code, a, b) => {
  await strudel.initStrudel()
  const pattern = await strudel.evaluate(code, false)
  return pattern.queryArc(a, b).filter((h) => h.hasOnset()).map((h) => ({ begin: h.whole.begin.valueOf(), end: h.whole.end.valueOf(), value: h.value }))
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
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.goto(`http://localhost:${server.address().port}/`)
await page.waitForFunction(() => window.ready === true)
const haps = await page.evaluate(([c, a, b]) => window.query(c, a, b), [code, from, to])
for (const h of haps) console.log(JSON.stringify(h))
await browser.close()
server.close()
