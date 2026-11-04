/**
 * Blind A/B listening comparison of two speech configurations on identical text.
 *
 *   npx tsx scripts/speech/ab.ts <outDir> <A> <B> [--set core|diagnostic|all] [--seed n]
 *
 * A and B are each a voice preset id (e.g. alder, alder-m1) or a SpeechVoice JSON file; the voice's
 * own backend is used, so `alder-m1` vs `alder` compares the frozen M1 engine with the current one.
 * Writes <outDir>/a/*.wav, <outDir>/b/*.wav and <outDir>/ab.html: each item plays as "1" and "2" in
 * a per-item random order; the listener picks the more natural/intelligible one (or "same"), and
 * Export gives the tally with the hidden order resolved.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeWav, getVoicePreset, speak, validateVoice, withControls, type SpeechVoice } from '../../src/speech'
import { BENCHMARK_SETS, type BenchmarkSet } from '../../src/speech/benchmark'
import { voiceHash } from '../../src/speech/metrics'
import { Rng } from '../../src/lib/rng'
import { loadNodeLexicon } from './lexicon-node'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const set = (flag('set') ?? 'core') as BenchmarkSet
const seed = Number(flag('seed') ?? 1)
const [outDir = 'speech-ab', specA = 'alder-m1', specB = 'alder'] = args
const load = (spec: string): SpeechVoice =>
  spec.endsWith('.json') ? validateVoice(JSON.parse(readFileSync(spec, 'utf8')) as SpeechVoice).voice : getVoicePreset(spec)
const voices = { a: load(specA), b: load(specB) }
const lexicon = loadNodeLexicon()
const items = BENCHMARK_SETS[set]
for (const side of ['a', 'b'] as const) {
  mkdirSync(join(outDir, side), { recursive: true })
  for (const item of items) {
    const r = speak(item.text, withControls(voices[side], { rate: item.rate ?? 1 }), { lexicon, seed })
    writeFileSync(join(outDir, side, `${item.id}.wav`), encodeWav(r.samples, r.sampleRate))
  }
}
const rng = new Rng(seed * 7919)
const order = items.map(() => (rng.next() < 0.5 ? 'ab' : 'ba'))
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Speech A/B</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;background:#fafafa;color:#222}
.item{border:1px solid #ddd;border-radius:6px;padding:.6rem .8rem;margin:.6rem 0;background:#fff}.row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
audio{height:32px}button.sel{background:#264;color:#fff}.ref{color:#666;font-size:.9em}</style></head><body>
<h1>Speech A/B</h1><p>Two renderings of the same text, in random order per item. Pick the one that sounds more natural and is easier to understand. The text is shown so you can judge clarity.
Configurations are hidden until you export.</p><p class="ref">Set ${esc(set)}, seed ${seed}. A = ${esc(specA)} (${voiceHash(voices.a)}), B = ${esc(specB)} (${voiceHash(voices.b)}).</p>
<button id="export">Export result</button><pre id="out"></pre>
${items.map((it, i) => {
  const [first, second] = order[i] === 'ab' ? ['a', 'b'] : ['b', 'a']
  return `<div class="item" data-id="${it.id}" data-order="${order[i]}"><div class="ref">${esc(it.text)}</div><div class="row">1 <audio controls preload="none" src="${first}/${it.id}.wav"></audio> 2 <audio controls preload="none" src="${second}/${it.id}.wav"></audio>
<button data-v="1">1 better</button><button data-v="0">same</button><button data-v="2">2 better</button></div></div>`
}).join('\n')}
<script>
for (const d of document.querySelectorAll('.item')) for (const b of d.querySelectorAll('button')) b.onclick = () => { d.dataset.pick = b.dataset.v; for (const x of d.querySelectorAll('button')) x.classList.toggle('sel', x === b) }
document.getElementById('export').onclick = () => {
  const t = { A: 0, B: 0, same: 0, unrated: 0, items: {} }
  for (const d of document.querySelectorAll('.item')) {
    const p = d.dataset.pick
    const w = p === undefined ? 'unrated' : p === '0' ? 'same' : (p === '1') === (d.dataset.order === 'ab') ? 'A' : 'B'
    t[w]++; t.items[d.dataset.id] = w
  }
  document.getElementById('out').textContent = JSON.stringify(t, null, 1)
}
</script></body></html>`
writeFileSync(join(outDir, 'ab.html'), html)
console.log(`wrote ${items.length} pairs and ab.html to ${outDir}`)
