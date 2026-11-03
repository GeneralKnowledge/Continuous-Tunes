/**
 * Render the speech benchmark and measure it.
 *
 *   npx tsx scripts/speech/benchmark.ts <outDir> [voiceId,voiceId…]
 *
 * Writes <outDir>/<voice>/<id>.wav, <outDir>/report.json, <outDir>/report.md and a blind
 * listening page <outDir>/listening.html (type what you hear, then reveal the text).
 * If <outDir>/asr.json exists (from scripts/speech/asr_whisper.py), word error rates are added.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeWav, getVoicePreset, speak, withControls } from '../../src/speech'
import { BENCHMARK } from '../../src/speech/benchmark'
import { audioHash, audioMetrics, coverage, g2pAccuracy, planMetrics, wordErrorRate } from '../../src/speech/metrics'
import { formatPronunciation } from '../../src/speech/phonemes'
import { loadNodeLexicon } from './lexicon-node'
import { createRequire } from 'node:module'

const outDir = process.argv[2] ?? 'speech-benchmark'
const voiceIds = (process.argv[3] ?? 'alder,cedar').split(',')
const lexicon = loadNodeLexicon()
mkdirSync(outDir, { recursive: true })

const asrPath = join(outDir, 'asr.json')
const asr: Record<string, string> = existsSync(asrPath) ? JSON.parse(readFileSync(asrPath, 'utf8')) : {}

interface Row {
  voice: string
  id: string
  category: string
  text: string
  file: string
  duration: number
  phones: string
  hash: string
  reproducible: boolean
  plan: ReturnType<typeof planMetrics>
  audio: ReturnType<typeof audioMetrics>
  asr?: string
  wer?: number
}

const rows: Row[] = []
const utterances = []
for (const voiceId of voiceIds) {
  mkdirSync(join(outDir, voiceId), { recursive: true })
  for (const item of BENCHMARK) {
    const voice = withControls(getVoicePreset(voiceId), { rate: item.rate ?? 1 })
    const r = speak(item.text, voice, { lexicon })
    const again = speak(item.text, voice, { lexicon })
    const file = `${voiceId}/${item.id}.wav`
    writeFileSync(join(outDir, file), encodeWav(r.samples, r.sampleRate))
    if (voiceId === voiceIds[0]) utterances.push(r.utterance)
    const hyp = asr[file]
    rows.push({
      voice: voiceId,
      id: item.id,
      category: item.category,
      text: item.text,
      file,
      duration: r.plan.duration,
      phones: r.utterance.sentences
        .flatMap((s) => s.phrases.flatMap((p) => p.words.map((w) => formatPronunciation(w.phones))))
        .join(' | '),
      hash: audioHash(r.samples),
      reproducible: audioHash(again.samples) === audioHash(r.samples),
      plan: planMetrics(r.plan),
      audio: audioMetrics(r.samples, r.sampleRate, r.plan),
      ...(hyp !== undefined ? { asr: hyp, wer: wordErrorRate(item.text, hyp) } : {}),
    })
  }
}

// G2P accuracy on a deterministic sample of Britfone words
const require = createRequire(import.meta.url)
const britWords = readFileSync(require.resolve('britfone/britfone.main.3.0.1.csv'), 'utf8')
  .split('\n')
  .map((l) => l.split(',')[0]!.replace(/\(\d+\)$/, '').toLowerCase())
  .filter((w) => /^[a-z]+$/.test(w))
const sample = britWords.filter((_, i) => i % 8 === 0)
const g2p = g2pAccuracy(lexicon, sample)
const cov = coverage(utterances)

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const summary = voiceIds.map((v) => {
  const rs = rows.filter((r) => r.voice === v)
  const withAsr = rs.filter((r) => r.wer !== undefined)
  const byCat: Record<string, number> = {}
  for (const c of new Set(withAsr.map((r) => r.category))) byCat[c] = mean(withAsr.filter((r) => r.category === c).map((r) => r.wer!))
  return {
    voice: v,
    items: rs.length,
    reproducible: rs.every((r) => r.reproducible),
    syllablesPerSecond: mean(rs.filter((r) => !r.id.startsWith('rate-')).map((r) => r.plan.syllablesPerSecond)),
    stressedVowelMs: mean(rs.map((r) => r.plan.meanStressedVowelMs)),
    unstressedVowelMs: mean(rs.map((r) => r.plan.meanUnstressedVowelMs)),
    implausibleSegments: rs.reduce((n, r) => n + r.plan.implausibleSegments, 0),
    clipped: rs.reduce((n, r) => n + r.audio.clipped, 0),
    nonFinite: rs.reduce((n, r) => n + r.audio.nonFinite, 0),
    voicedVowelShare: mean(rs.map((r) => r.audio.voicedVowelShare)),
    f0ErrorSemitones: mean(rs.map((r) => r.audio.f0ErrorSemitones)),
    yesNoFinalSlope: mean(rs.filter((r) => r.id === 'q-02' || r.id === 'q-04').map((r) => r.plan.finalSlopeSemitones)),
    statementFinalSlope: mean(rs.filter((r) => r.id === 'q-01' || r.id === 'q-05').map((r) => r.plan.finalSlopeSemitones)),
    wer: withAsr.length ? mean(withAsr.map((r) => r.wer!)) : null,
    werByCategory: byCat,
  }
})

writeFileSync(join(outDir, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), summary, coverage: cov, g2p, rows }, null, 2))

const f = (x: number, d = 2) => x.toFixed(d)
const md: string[] = [
  '# Speech benchmark',
  '',
  `${BENCHMARK.length} items × ${voiceIds.length} voices (${voiceIds.join(', ')}). Formant backend, 22.05 kHz.`,
  '',
  '## Summary',
  '',
  '| voice | reproducible | syll/s | stressed V ms | unstressed V ms | odd segments | clipped | voiced vowels | f0 err (st) | yes/no end (st) | statement end (st) | ASR WER |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...summary.map((s) =>
    `| ${s.voice} | ${s.reproducible ? 'yes' : 'NO'} | ${f(s.syllablesPerSecond)} | ${f(s.stressedVowelMs, 0)} | ${f(s.unstressedVowelMs, 0)} | ${s.implausibleSegments} | ${s.clipped} | ${f(s.voicedVowelShare * 100, 0)}% | ${f(s.f0ErrorSemitones)} | ${f(s.yesNoFinalSlope, 1)} | ${f(s.statementFinalSlope, 1)} | ${s.wer === null ? 'not run' : f(s.wer * 100, 0) + '%'} |`,
  ),
  '',
  ...(summary.some((s) => s.wer !== null)
    ? ['### ASR word error rate by category (auxiliary, not ground truth)', '', '| category | ' + voiceIds.join(' | ') + ' |', '|---|' + voiceIds.map(() => '---|').join(''),
       ...Object.keys(summary[0]!.werByCategory).map((c) => `| ${c} | ${summary.map((s) => f((s.werByCategory[c] ?? 0) * 100, 0) + '%').join(' | ')} |`), '']
    : []),
  '## Coverage',
  '',
  `Phonemes used: ${cov.phonemesUsed.length}/${cov.phonemesUsed.length + cov.phonemesMissing.length}${cov.phonemesMissing.length ? ` (missing: ${cov.phonemesMissing.join(' ')})` : ''}. Distinct diphones: ${cov.diphones}.`,
  '',
  `Pronunciation sources: ${Object.entries(cov.sources).map(([k, v]) => `${k} ${v}`).join(', ')}. Guessed words: ${cov.guessedWords.join(', ') || 'none'}.`,
  '',
  `Letter-to-sound rules on ${g2p.words} Britfone words: phone error rate ${f(g2p.phoneErrorRate * 100, 1)}%, exact ${f(g2p.exact * 100, 1)}%.`,
  '',
  '## Items',
  '',
  '| voice | id | text | s | ASR |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.voice} | ${r.id} | ${r.text.replace(/\|/g, '/')} | ${f(r.duration, 1)} | ${r.asr === undefined ? '' : `${r.asr.replace(/\|/g, '/')} (${f(r.wer! * 100, 0)}%)`} |`),
  '',
]
writeFileSync(join(outDir, 'report.md'), md.join('\n'))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Speech listening test</title><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;background:#fafafa;color:#222}
.item{border:1px solid #ddd;border-radius:6px;padding:.6rem .8rem;margin:.6rem 0;background:#fff}input{width:100%;padding:.3rem;margin:.3rem 0}
.ref{display:none;color:#555}.shown .ref{display:block}button{margin-right:.5rem}</style></head><body>
<h1>Speech listening test</h1><p>Play each clip, type what you hear, then press Reveal. Order is shuffled per voice. Your answers stay in this page; Export copies them as JSON.</p>
<button id="export">Export answers</button><pre id="out"></pre>
${voiceIds.map((v) => `<h2>${esc(v)}</h2>` + rows.filter((r) => r.voice === v).map((r) => `<div class="item" data-file="${r.file}"><audio controls preload="none" src="${r.file}"></audio><input placeholder="What did you hear?"><button class="rev">Reveal</button><span class="ref">${esc(r.text)}</span></div>`).join('')).join('\n')}
<script>
for (const b of document.querySelectorAll('.rev')) b.onclick = () => b.parentElement.classList.toggle('shown')
document.getElementById('export').onclick = () => { const a = {}; for (const d of document.querySelectorAll('.item')) a[d.dataset.file] = d.querySelector('input').value; document.getElementById('out').textContent = JSON.stringify(a, null, 1) }
</script></body></html>`
writeFileSync(join(outDir, 'listening.html'), html)
console.log(md.slice(0, 14).join('\n'))
console.log(`\nwrote ${rows.length} clips, report.md, report.json, listening.html to ${outDir}`)
