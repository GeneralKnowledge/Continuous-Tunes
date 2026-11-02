#!/usr/bin/env tsx
/**
 * Compare two analysed collections (scripts/analysis/analyze.ts) and build a blind A/B
 * listening page for them.
 *
 * Usage: npx tsx scripts/analysis/compare.ts <baselineDir> <candidateDir> <outDir>
 * Writes <outDir>/comparison.md and <outDir>/listening.html. The page links the MP3s by paths
 * relative to <outDir>, so keep the collections next to it (e.g. outDir/baseline, outDir/improved).
 *
 * The page plays each pair in a hidden, fixed random order (A/B), records a preference and notes
 * per pair in the browser, and exports them as JSON. Metrics never decide which version is better.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Row } from './analyze'

const [baseDir, candDir, outDir] = process.argv.slice(2)
if (!baseDir || !candDir || !outDir) {
  console.error('Usage: npx tsx scripts/analysis/compare.ts <baselineDir> <candidateDir> <outDir>')
  process.exit(1)
}
const load = (d: string): { rows: Row[]; aggregate: Row[] } => JSON.parse(readFileSync(join(d, 'report.json'), 'utf8'))
const base = load(baseDir)
const cand = load(candDir)

const METRICS: [keyof Row, string, number][] = [
  ['lufs', 'LUFS', 1],
  ['lra', 'loudness range LU', 1],
  ['onsetsPerSec', 'audio onsets/s', 1],
  ['barRepetition', 'audio bar repetition', 2],
  ['drumDistinct8', 'distinct drum bars per 8', 1],
  ['drumVelSpread', 'drum velocity spread', 3],
  ['ghostShare', 'ghost share', 2],
  ['timingMs', 'drum timing spread ms', 1],
  ['bassOnKick', 'bass on kick', 2],
  ['melodyDistinct', 'distinct melody bars', 0],
  ['sectionContrast', 'section contrast', 3],
]
const f = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '–')
const lines: string[] = []
lines.push(`# Comparison: ${baseDir.split('/').pop()} → ${candDir.split('/').pop()}`, '')
lines.push('Per-genre means over seeds, baseline → candidate. A change in a number is not an improvement by itself; listen.', '')
lines.push(`| genre | ${METRICS.map((m) => m[1]).join(' | ')} | flags before | flags after |`)
lines.push(`|---|${METRICS.map(() => '---').join('|')}|---|---|`)
for (const b of base.aggregate) {
  const c = cand.aggregate.find((x) => x.genre === b.genre)
  if (!c) continue
  const cells = METRICS.map(([k, , d]) => `${f(b[k] as number, d)} → ${f(c[k] as number, d)}`)
  lines.push(`| ${b.genre} | ${cells.join(' | ')} | ${b.flags.join(', ')} | ${c.flags.join(', ')} |`)
}
const count = (rows: Row[]) => {
  const m = new Map<string, number>()
  for (const r of rows) for (const fl of r.flags) m.set(fl, (m.get(fl) ?? 0) + 1)
  return m
}
const cb = count(base.rows)
const cc = count(cand.rows)
lines.push('', '## Flag counts (all songs, every occurrence)', '', '| flag | baseline | candidate |', '|---|---:|---:|')
for (const k of [...new Set([...cb.keys(), ...cc.keys()])].sort()) lines.push(`| ${k} | ${cb.get(k) ?? 0} | ${cc.get(k) ?? 0} |`)
writeFileSync(join(outDir, 'comparison.md'), lines.join('\n') + '\n')

// ---- Listening page
interface Pair {
  id: string
  genre: string
  seed: string
  a: string
  b: string
  /** Which side is the candidate (hidden until revealed). */
  candidate: 'A' | 'B'
}
const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
const pairs: Pair[] = base.rows
  .filter((r) => cand.rows.some((c) => c.genre === r.genre && c.seed === r.seed))
  .map((r) => {
    const pb = relative(outDir, join(baseDir, `seed-${r.seed}`, `${r.genre}.mp3`))
    const pc = relative(outDir, join(candDir, `seed-${r.seed}`, `${r.genre}.mp3`))
    const flip = hash(`${r.genre}${r.seed}`) % 2 === 1
    return { id: `${r.genre}-${r.seed}`, genre: r.genre, seed: r.seed, a: flip ? pc : pb, b: flip ? pb : pc, candidate: flip ? 'A' : 'B' }
  })

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Listening test</title>
<style>
:root { --bg:#fbfaf7; --fg:#1d1c1a; --muted:#6b675f; --line:#e3dfd6; --card:#fff; --accent:#2f5d8a; }
@media (prefers-color-scheme: dark) { :root { --bg:#151514; --fg:#ecebe7; --muted:#a29e95; --line:#34332f; --card:#1e1e1c; --accent:#8db6e0; } }
* { box-sizing: border-box } body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif }
main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px }
h1 { font-size: 22px; margin: 0 0 4px } p.lead { color: var(--muted); margin: 0 0 20px }
.pair { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin: 12px 0 }
.pair h2 { font-size: 16px; margin: 0 0 8px; display:flex; justify-content:space-between; gap:8px }
.row { display: grid; grid-template-columns: 28px 1fr; gap: 8px; align-items: center; margin: 4px 0 }
audio { width: 100% } label { margin-right: 12px; white-space: nowrap } textarea { width:100%; min-height: 48px; font: inherit; background: transparent; color: inherit; border:1px solid var(--line); border-radius:6px; padding:6px }
.controls { display:flex; flex-wrap:wrap; gap:6px 14px; margin: 8px 0 } .muted { color: var(--muted); font-size: 13px }
button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer }
.bar { position: sticky; top: 0; background: var(--bg); padding: 10px 0; border-bottom: 1px solid var(--line); display:flex; gap:8px; flex-wrap:wrap; z-index:1 }
</style></head><body><main>
<h1>Listening test</h1>
<p class="lead">Each pair is the same genre and seed, rendered by two versions of the generator in a hidden order. Listen to both (same section, same volume), pick the one you prefer and note why. Your answers stay in this browser until you export them.</p>
<div class="bar"><button id="export">Export answers (JSON)</button><button id="reveal">Reveal which is new</button><span class="muted" id="count"></span></div>
<div id="pairs"></div>
</main>
<script>
const PAIRS = ${JSON.stringify(pairs)};
const KEY = 'ct-listening-v1';
let answers = {};
try { answers = JSON.parse(localStorage.getItem(KEY) || '{}') } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(answers)) } catch {} ; count() };
const count = () => { document.getElementById('count').textContent = Object.values(answers).filter(a => a.pref).length + ' / ' + PAIRS.length + ' rated' };
const root = document.getElementById('pairs');
for (const p of PAIRS) {
  const a = answers[p.id] || (answers[p.id] = {});
  const el = document.createElement('section');
  el.className = 'pair';
  const radios = (name, opts) => opts.map(o => '<label><input type="radio" name="' + p.id + name + '" value="' + o + '"' + (a[name] === o ? ' checked' : '') + '> ' + o + '</label>').join('');
  el.innerHTML = '<h2><span>' + p.genre + ' · seed ' + p.seed + '</span><span class="muted reveal" hidden>new = ' + p.candidate + '</span></h2>' +
    '<div class="row"><b>A</b><audio controls preload="none" src="' + p.a + '"></audio></div>' +
    '<div class="row"><b>B</b><audio controls preload="none" src="' + p.b + '"></audio></div>' +
    '<div class="controls"><span class="muted">Prefer:</span>' + radios('pref', ['A', 'B', 'same']) + '</div>' +
    '<div class="controls"><span class="muted">Groove feels more human in:</span>' + radios('groove', ['A', 'B', 'same']) + '</div>' +
    '<div class="controls"><span class="muted">More interesting over time:</span>' + radios('interest', ['A', 'B', 'same']) + '</div>' +
    '<textarea placeholder="What did you hear? (timing, dynamics, repetition, transitions, mix)">' + (a.notes || '') + '</textarea>';
  el.addEventListener('change', (e) => { const t = e.target; if (t.type === 'radio') { a[t.name.slice(p.id.length)] = t.value; save() } });
  el.querySelector('textarea').addEventListener('input', (e) => { a.notes = e.target.value; save() });
  // One player at a time
  el.querySelectorAll('audio').forEach(au => au.addEventListener('play', () => document.querySelectorAll('audio').forEach(o => o !== au && o.pause())));
  root.appendChild(el);
}
count();
document.getElementById('reveal').onclick = () => document.querySelectorAll('.reveal').forEach(r => r.hidden = !r.hidden);
document.getElementById('export').onclick = () => {
  const out = PAIRS.map(p => ({ id: p.id, genre: p.genre, seed: p.seed, candidateSide: p.candidate, ...answers[p.id],
    prefersCandidate: answers[p.id]?.pref ? (answers[p.id].pref === 'same' ? null : answers[p.id].pref === p.candidate) : undefined }));
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'listening-answers.json'; link.click();
};
</script></body></html>
`
writeFileSync(join(outDir, 'listening.html'), html)
console.log(`wrote ${join(outDir, 'comparison.md')} and ${join(outDir, 'listening.html')} (${pairs.length} pairs)`)
