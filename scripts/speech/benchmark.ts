/**
 * Render the speech benchmark and measure it.
 *
 *   npx tsx scripts/speech/benchmark.ts <outDir> [voiceId|voice.json,…] [--set core|diagnostic|all] [--backend id]
 *
 * --seed n changes the noise and jitter of every clip (default 1): rerun with a few seeds to see how
 * much of a score difference is just chance.
 *
 * Writes <outDir>/<voice>/<id>.wav, <outDir>/report.json, <outDir>/report.md and a blind
 * listening page <outDir>/listening.html (type what you hear, then reveal the text).
 * A voice can be a preset id or a JSON file holding a SpeechVoice (an experiment's genome).
 * If <outDir>/asr*.json exist (from scripts/speech/asr_whisper.py; asr.json = Whisper base.en,
 * asr.small.json = small.en, …), word error rates and diagnostic scores are added per model.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { encodeWav, getVoicePreset, speak, validateVoice, withControls, type SpeechVoice } from '../../src/speech'
import { BENCHMARK_SETS, scoreDiagnostic, type BenchmarkSet } from '../../src/speech/benchmark'
import {
  audioHash,
  audioMetrics,
  coverage,
  g2pAccuracy,
  normalisedWords,
  planMetrics,
  segmentAcoustics,
  summarisePhoneAcoustics,
  voiceHash,
  wordErrorRate,
  type SegmentAcoustics,
} from '../../src/speech/metrics'
import { formatPronunciation } from '../../src/speech/phonemes'
import { loadNodeLexicon } from './lexicon-node'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const setName = (flag('set') ?? 'core') as BenchmarkSet
const backendOverride = flag('backend')
const seed = Number(flag('seed') ?? 1)
const BENCHMARK = BENCHMARK_SETS[setName]
if (!BENCHMARK) throw new Error(`unknown set ${setName}`)
const outDir = args[0] ?? 'speech-benchmark'
const voiceSpecs = (args[1] ?? 'alder').split(',')
const voices: SpeechVoice[] = voiceSpecs.map((spec) =>
  spec.endsWith('.json') ? validateVoice(JSON.parse(readFileSync(spec, 'utf8')) as SpeechVoice).voice : getVoicePreset(spec),
)
const voiceIds = voices.map((v, i) => (voiceSpecs[i]!.endsWith('.json') ? basename(voiceSpecs[i]!, '.json') : v.id))
const lexicon = loadNodeLexicon()
mkdirSync(outDir, { recursive: true })

// asr.json is Whisper base.en (the M1 setting); asr.<model>.json are other recognisers
const asrModels: Record<string, Record<string, string>> = {}
for (const f of readdirSync(outDir)) {
  const m = /^asr(?:\.([\w-]+))?\.json$/.exec(f)
  if (m) asrModels[m[1] ?? 'base'] = JSON.parse(readFileSync(join(outDir, f), 'utf8'))
}
const asr = asrModels.base ?? {}
const modelNames = Object.keys(asrModels).sort()

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
  /** per recogniser: transcript, WER and (diagnostic items) what was heard in the slot */
  byModel: Record<string, { text: string; wer: number; heard?: string; correct?: boolean; foil?: boolean }>
  contrast?: string
  target?: string
  renderMs: number
}

const rows: Row[] = []
const utterances = []
const acoustics: Record<string, SegmentAcoustics[]> = {}
let audioSeconds = 0
let renderSeconds = 0
for (const [vi, voiceId] of voiceIds.entries()) {
  mkdirSync(join(outDir, voiceId), { recursive: true })
  acoustics[voiceId] = []
  for (const item of BENCHMARK) {
    const voice = withControls(voices[vi]!, { rate: item.rate ?? 1 })
    const opts = { lexicon, seed, ...(backendOverride ? { backend: backendOverride } : {}) }
    const t0 = performance.now()
    const r = speak(item.text, voice, opts)
    const renderMs = performance.now() - t0
    audioSeconds += r.samples.length / r.sampleRate
    renderSeconds += renderMs / 1000
    const again = speak(item.text, voice, opts)
    acoustics[voiceId]!.push(...segmentAcoustics(r.samples, r.sampleRate, r.plan))
    const file = `${voiceId}/${item.id}.wav`
    writeFileSync(join(outDir, file), encodeWav(r.samples, r.sampleRate))
    if (voiceId === voiceIds[0]) utterances.push(r.utterance)
    const hyp = asr[file]
    const byModel: Row['byModel'] = {}
    for (const m of modelNames) {
      const text = asrModels[m]![file]
      if (text === undefined) continue
      byModel[m] = { text, wer: wordErrorRate(item.text, text), ...(item.target ? scoreDiagnostic(item, normalisedWords(text)) : {}) }
    }
    rows.push({
      byModel,
      renderMs,
      ...(item.contrast ? { contrast: item.contrast, target: item.target } : {}),
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
    wer: withAsr.some((r) => r.category !== 'diagnostic') ? mean(withAsr.filter((r) => r.category !== 'diagnostic').map((r) => r.wer!)) : null,
    werByCategory: byCat,
    // WER over the core benchmark only (the M1 item set), so it stays comparable across runs
    werByModel: Object.fromEntries(modelNames.map((m) => {
      const xs = rs.filter((r) => r.byModel[m] && r.category !== 'diagnostic').map((r) => r.byModel[m]!.wer)
      return [m, xs.length ? mean(xs) : null]
    })),
    diagnosticByModel: Object.fromEntries(modelNames.map((m) => {
      const ds = rs.filter((r) => r.contrast && r.byModel[m])
      const byContrast: Record<string, number> = {}
      for (const c of new Set(ds.map((r) => r.contrast!))) byContrast[c] = mean(ds.filter((r) => r.contrast === c).map((r) => (r.byModel[m]!.correct ? 1 : 0)))
      return [m, { accuracy: ds.length ? mean(ds.map((r) => (r.byModel[m]!.correct ? 1 : 0))) : null, byContrast }]
    })),
    phoneAcoustics: summarisePhoneAcoustics(acoustics[v] ?? []),
    voiceHash: voiceHash(voices[voiceIds.indexOf(v)]!),
  }
})
const realTimeFactor = renderSeconds / Math.max(1e-9, audioSeconds)

writeFileSync(join(outDir, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), seed, set: setName, backend: backendOverride ?? null, voices, realTimeFactor, summary, coverage: cov, g2p, rows }, null, 2))

const f = (x: number, d = 2) => x.toFixed(d)
const md: string[] = [
  '# Speech benchmark',
  '',
  `Set \`${setName}\`: ${BENCHMARK.length} items × ${voiceIds.length} voices (${voiceIds.join(', ')}). Backend ${backendOverride ?? voices.map((v) => v.backend).join('/')}, 22.05 kHz. Render real-time factor ${f(realTimeFactor, 3)} (one Node thread). Voice hashes: ${summary.map((s) => `${s.voice} ${s.voiceHash}`).join(', ')}.`,
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
  ...(modelNames.length
    ? ['### By recogniser', '', 'WER over the core items (the M1 set); diagnostic = share of diagnostic target words heard (closed set). base/small are Whisper (strong language model); citrinet (CTC) and zipformer (transducer) lean much less on language and so track the acoustics more closely.', '', '| voice | ' + modelNames.map((m) => `WER ${m}`).join(' | ') + ' | mean WER | ' + modelNames.map((m) => `diagnostic ${m}`).join(' | ') + ' | mean diagnostic |',
       '|---|' + modelNames.map(() => '---|').join('').repeat(2) + '---|---|',
       ...summary.map((s) => {
         const w = modelNames.map((m) => s.werByModel[m]).filter((x): x is number => x != null)
         const d = modelNames.map((m) => s.diagnosticByModel[m]!.accuracy).filter((x): x is number => x != null)
         return `| ${s.voice} | ${modelNames.map((m) => (s.werByModel[m] == null ? '–' : f(s.werByModel[m]! * 100, 0) + '%')).join(' | ')} | ${w.length ? f(mean(w) * 100, 1) + '%' : '–'} | ${modelNames.map((m) => (s.diagnosticByModel[m]!.accuracy == null ? '–' : f(s.diagnosticByModel[m]!.accuracy! * 100, 0) + '%')).join(' | ')} | ${d.length ? f(mean(d) * 100, 1) + '%' : '–'} |`
       }), '']
    : []),
  ...(rows.some((r) => r.contrast) && modelNames.length
    ? ['### Diagnostic contrasts (share of target words heard correctly)', '',
       '| contrast | ' + summary.flatMap((s) => modelNames.map((m) => `${s.voice} ${m}`)).join(' | ') + ' |',
       '|---|' + summary.flatMap(() => modelNames.map(() => '---|')).join(''),
       ...[...new Set(rows.filter((r) => r.contrast).map((r) => r.contrast!))].map((c) => `| ${c} | ${summary.flatMap((s) => modelNames.map((m) => f((s.diagnosticByModel[m]!.byContrast[c] ?? 0) * 100, 0) + '%')).join(' | ')} |`), '']
    : []),
  '## Per-phone acoustics',
  '',
  'Level relative to stressed vowels; centroid of the segment centre; low = share of energy under 500 Hz; release = 30 ms around a stop release. ⚠ marks values outside the rough natural ranges in `NATURAL_RANGES` (metrics.ts).',
  '',
  ...summary.flatMap((s) => [`**${s.voice}**`, '', '| phone | n | level dB | centroid Hz | low | release dB | release centroid | |', '|---|---|---|---|---|---|---|---|',
    ...s.phoneAcoustics.map((p) => `| ${p.phone} | ${p.n} | ${f(p.levelDb, 1)} | ${f(p.centroid, 0)} | ${f(p.low, 2)} | ${p.releaseLevelDb === undefined ? '' : f(p.releaseLevelDb, 1)} | ${p.releaseCentroid === undefined ? '' : f(p.releaseCentroid, 0)} | ${p.outside.length ? '⚠ ' + p.outside.join(', ') : ''} |`), '']),
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
  '| voice | id | text | s | ' + (modelNames.length ? modelNames.join(' | ') : 'ASR') + ' |',
  '|---|---|---|---|' + (modelNames.length ? modelNames.map(() => '---|').join('') : '---|'),
  ...rows.map((r) => `| ${r.voice} | ${r.id} | ${r.text.replace(/\|/g, '/')} | ${f(r.duration, 1)} | ${modelNames.length ? modelNames.map((m) => { const b = r.byModel[m]; return b ? `${b.text.replace(/\|/g, '/')} (${b.heard !== undefined ? (b.correct ? '✓' : '✗ ' + b.heard) : f(b.wer * 100, 0) + '%'})` : '' }).join(' | ') : ''} |`),
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
console.log(md.slice(0, md.indexOf('## Per-phone acoustics')).join('\n'))
console.log(`\nwrote ${rows.length} clips, report.md, report.json, listening.html to ${outDir}`)
