#!/usr/bin/env tsx
/**
 * Analyse a recording collection: symbolic (played events), structural and audio measurements
 * for every song, weakness flags, and per-genre aggregates.
 *
 * Usage: npx tsx scripts/analysis/analyze.ts <collectionDir>
 *   <collectionDir>/seed-<n>/songs.json    from scripts/render-songs.ts (required)
 *   <collectionDir>/seed-<n>/events.json   from scripts/analysis/query-events.mjs (optional)
 *   <collectionDir>/seed-<n>/<channel>.mp3 from scripts/record-songs.mjs (optional)
 * Writes <collectionDir>/report.json and <collectionDir>/report.md.
 * Needs ffmpeg to decode the MP3s.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyseAudio, type AudioAnalysis } from '../../src/analysis/audio'
import { detectFlags, type Flag } from '../../src/analysis/flags'
import { analyseSong, jaccardDistance, noteToMidi, type PlayedEvent, type SongAnalysis } from '../../src/analysis/symbolic'

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: npx tsx scripts/analysis/analyze.ts <collectionDir>')
  process.exit(1)
}
const SR = 22050

interface SongRecord {
  channel: string
  tempo: number
  bars: number
  sections: { role: string; bars: number; material?: string }[]
  rngSeed?: number
}

export interface SongReport {
  genre: string
  seed: string
  tempo: number
  bars: number
  form: string
  symbolic: SongAnalysis | null
  audio: AudioAnalysis | null
  flags: Flag[]
  melodyFingerprints: string[]
}

function decode(file: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}

const seeds = readdirSync(dir).filter((d) => d.startsWith('seed-') && existsSync(join(dir, d, 'songs.json'))).sort()
const reports: SongReport[] = []
for (const sd of seeds) {
  const songs: SongRecord[] = JSON.parse(readFileSync(join(dir, sd, 'songs.json'), 'utf8'))
  const evFile = join(dir, sd, 'events.json')
  const events: Record<string, { events: PlayedEvent[] }> = existsSync(evFile) ? JSON.parse(readFileSync(evFile, 'utf8')) : {}
  for (const song of songs) {
    const ev = events[song.channel]?.events
    const symbolic = ev ? analyseSong(ev, song.sections, song.tempo) : null
    const mp3 = join(dir, sd, `${song.channel}.mp3`)
    const audio = existsSync(mp3) ? analyseAudio(decode(mp3), SR, { tempo: song.tempo, sections: song.sections }) : null
    const fps = ev ? melodyBars(ev, song.bars) : []
    reports.push({
      genre: song.channel,
      seed: sd.slice(5),
      tempo: song.tempo,
      bars: song.bars,
      form: song.sections.map((s) => `${s.role}:${s.bars}${s.material === 'B' ? 'B' : ''}`).join(' '),
      symbolic,
      audio,
      flags: detectFlags(song.channel, symbolic, audio),
      melodyFingerprints: fps,
    })
    console.log(`${sd} ${song.channel}: ${symbolic ? 'symbolic' : '-'} ${audio ? 'audio' : '-'} flags ${reports.at(-1)!.flags.map((f) => f.id).join(',')}`)
  }
}

/** Absolute pitch + rhythm fingerprints of the melody's bars, for comparing seeds. */
function melodyBars(ev: readonly PlayedEvent[], bars: number): string[] {
  const out: string[] = []
  for (let b = 0; b < bars; b++) {
    const ns = ev.filter((e) => e.layer === 'melody' && Math.floor(e.t + 1e-6) === b).map((e) => `${Math.round((e.t - b) * 16)}:${noteToMidi(e.note)}`)
    if (ns.length >= 2) out.push(ns.sort().join(' '))
  }
  return out
}

// ---- Aggregates
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–')
const secMean = (r: SongReport, pick: (s: SongAnalysis['sections'][number]) => number | null | undefined) => {
  const vs = (r.symbolic?.sections ?? []).map(pick).filter((v): v is number => typeof v === 'number')
  return mean(vs)
}

export interface Row {
  genre: string
  seed: string
  bpmHeard: number
  lufs: number
  lra: number
  onsetsPerSec: number
  centroid: number
  barRepetition: number
  audioSectionStep: number
  sectionContrast: number
  materialContrast: number
  drumDistinct8: number
  drumBarChange: number
  drumVelSpread: number
  ghostShare: number
  timingMs: number
  melodyDistinct: number
  melodyDistinctShare: number
  melodyVaried: number
  melodyNovel: number
  predictability: number
  bassOnKick: number
  counterWithMelody: number
  callResponse: number
  loopRun: number
  flags: string[]
}

export function rowOf(r: SongReport): Row {
  const s = r.symbolic?.song
  return {
    genre: r.genre,
    seed: r.seed,
    bpmHeard: r.audio?.tempo.bpm ?? NaN,
    lufs: r.audio?.loudness.integrated ?? NaN,
    lra: r.audio?.loudness.range ?? NaN,
    onsetsPerSec: r.audio?.onsets.perSecond ?? NaN,
    centroid: r.audio?.spectrum.centroid ?? NaN,
    barRepetition: r.audio?.barRepetition ?? NaN,
    audioSectionStep: r.audio?.sectionLoudnessStep ?? NaN,
    sectionContrast: s?.sectionContrast ?? NaN,
    materialContrast: s?.materialContrast ?? NaN,
    drumDistinct8: secMean(r, (x) => (x.bars >= 8 ? x.drums?.distinctPer8 : null)),
    drumBarChange: secMean(r, (x) => x.drums?.barChange),
    drumVelSpread: secMean(r, (x) => x.drums?.velocitySpread),
    ghostShare: secMean(r, (x) => (x.drums && (x.density.snare ?? 0) > 0 ? x.drums.ghostShare : null)),
    timingMs: secMean(r, (x) => x.drums?.timingSpreadMs),
    melodyDistinct: s?.melodyBars.distinct ?? NaN,
    melodyDistinctShare: s?.melodyBars.distinctShare ?? NaN,
    melodyVaried: s?.melodyBars.varied ?? NaN,
    melodyNovel: s?.melodyBars.novel ?? NaN,
    predictability: s?.melodicPredictability ?? NaN,
    bassOnKick: secMean(r, (x) => x.relations.bassOnKick),
    counterWithMelody: secMean(r, (x) => x.relations.counterWithMelody),
    callResponse: secMean(r, (x) => x.relations.callResponse),
    loopRun: s?.longestLoopRun ?? NaN,
    flags: r.flags.map((x) => x.id),
  }
}

const rows = reports.map(rowOf)
const genres = [...new Set(rows.map((r) => r.genre))]
const crossSeed = Object.fromEntries(
  genres.map((g) => {
    const rs = reports.filter((r) => r.genre === g)
    const ds: number[] = []
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) ds.push(jaccardDistance(new Set(rs[i]!.melodyFingerprints), new Set(rs[j]!.melodyFingerprints)))
    return [g, mean(ds)]
  }),
)

const COLS: [keyof Row, string, number][] = [
  ['bpmHeard', 'BPM heard', 1],
  ['lufs', 'LUFS', 1],
  ['lra', 'LRA', 1],
  ['audioSectionStep', 'sect ΔLU', 1],
  ['onsetsPerSec', 'onsets/s', 1],
  ['centroid', 'centroid Hz', 0],
  ['barRepetition', 'audio bar rep', 2],
  ['sectionContrast', 'sect contrast', 3],
  ['drumDistinct8', 'drum bars/8', 1],
  ['drumBarChange', 'drum barΔ', 2],
  ['drumVelSpread', 'drum vel spread', 3],
  ['ghostShare', 'ghosts', 2],
  ['timingMs', 'timing ms', 1],
  ['melodyDistinct', 'mel distinct bars', 0],
  ['melodyDistinctShare', 'mel distinct share', 2],
  ['melodyVaried', 'mel varied', 2],
  ['melodyNovel', 'mel new', 2],
  ['bassOnKick', 'bass on kick', 2],
  ['counterWithMelody', 'counter w/ mel', 2],
  ['callResponse', 'call/resp r', 2],
  ['loopRun', 'unchanged loop bars', 0],
]

const table = (rs: Row[], label: (r: Row) => string) => {
  const head = `| | ${COLS.map((c) => c[1]).join(' | ')} | flags |\n|---|${COLS.map(() => '---:').join('|')}|---|`
  const body = rs.map((r) => `| ${label(r)} | ${COLS.map(([k, , d]) => f(r[k] as number, d)).join(' | ')} | ${[...new Set(r.flags)].join(', ')} |`)
  return [head, ...body].join('\n')
}

const aggregate: Row[] = genres.map((g) => {
  const rs = rows.filter((r) => r.genre === g)
  const out: Record<string, unknown> = { genre: g, seed: 'mean' }
  for (const [k] of COLS) out[k] = mean(rs.map((r) => r[k] as number).filter(Number.isFinite))
  const counts = new Map<string, number>()
  for (const r of rs) for (const fl of new Set(r.flags)) counts.set(fl, (counts.get(fl) ?? 0) + 1)
  out.flags = [...counts.entries()].map(([k, n]) => `${k}×${n}`)
  return out as unknown as Row
})

const flagTotals = new Map<string, number>()
for (const r of reports) for (const fl of r.flags) flagTotals.set(fl.id, (flagTotals.get(fl.id) ?? 0) + 1)

const md = `# Analysis report: ${dir.split('/').filter(Boolean).pop()}

${reports.length} songs, ${genres.length} genres, seeds ${seeds.map((s) => s.slice(5)).join(', ')}. Generated by \`scripts/analysis/analyze.ts\`.
Measurements describe the music; none of them is a quality score. Flags are prompts for listening.

## Per genre (mean over seeds)

${table(aggregate, (r) => r.genre)}

Cross-seed melodic distance (1 = seeds share no melody bar, 0 = identical): ${genres.map((g) => `${g} ${f(crossSeed[g]!)}`).join(', ')}.

## Flags across the collection

${[...flagTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- **${k}**: ${n}`).join('\n')}

## Every song

${table(rows, (r) => `${r.genre} ${r.seed}`)}

## Flag details

${reports.map((r) => `### ${r.genre} seed ${r.seed}\n\nForm: ${r.form}\n\n${r.flags.length ? r.flags.map((x) => `- ${x.id} (${x.where}): ${x.detail}`).join('\n') : '- none'}`).join('\n\n')}
`

writeFileSync(join(dir, 'report.json'), JSON.stringify({ rows, aggregate, crossSeed, reports }, null, 1))
writeFileSync(join(dir, 'report.md'), md)
console.log(`wrote ${join(dir, 'report.md')}`)
