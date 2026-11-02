#!/usr/bin/env tsx
/**
 * Measure human drumming in the Groove MIDI Dataset (Magenta, CC BY 4.0) and write the
 * statistics Continuous-Tunes uses as its groove reference.
 *
 * Usage: npx tsx scripts/analysis/groove-gmd.ts <groove-dir> [out.json] [--emit-ts src/music/groove-reference.ts]
 *   <groove-dir> is the unzipped groove-v1.0.0-midionly.zip (the folder holding info.csv).
 *
 * Nothing from the dataset is copied: only aggregate numbers (means, deviations, rates) per style.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMidi, type MidiNote } from './midi'

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: npx tsx scripts/analysis/groove-gmd.ts <groove-dir> [out.json] [--emit-ts file]')
  process.exit(1)
}
const outJson = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'gmd-groove-stats.json'
const emitIdx = process.argv.indexOf('--emit-ts')
const emitTs = emitIdx > 0 ? process.argv[emitIdx + 1] : undefined

// Roland TD-11 mapping used by the dataset, reduced to the instruments Continuous-Tunes plays
const CLASS: Record<number, Inst> = {
  36: 'kick',
  38: 'snare', 40: 'snare', 37: 'snare',
  42: 'hat', 22: 'hat', 44: 'hat', 46: 'hat', 26: 'hat',
  51: 'ride', 59: 'ride', 53: 'ride',
  43: 'tom', 58: 'tom', 47: 'tom', 50: 'tom', 48: 'tom', 45: 'tom',
  49: 'crash', 55: 'crash', 57: 'crash', 52: 'crash',
}
const INSTS = ['kick', 'snare', 'hat', 'ride', 'tom', 'crash'] as const
type Inst = (typeof INSTS)[number]

interface Row {
  drummer: string
  style: string
  bpm: number
  beatType: string
  ts: string
  midi: string
  duration: number
}

const rows: Row[] = readFileSync(join(dir, 'info.csv'), 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((l) => l.split(','))
  .map((c) => ({ drummer: c[0]!, style: c[3]!.split('/')[0]!, bpm: Number(c[4]), beatType: c[5]!, ts: c[6]!, midi: c[7]!, duration: Number(c[9]) }))
  .filter((r) => r.ts === '4-4')

/** Running sums for mean / deviation. */
class Acc {
  n = 0
  s = 0
  ss = 0
  add(v: number) {
    this.n++
    this.s += v
    this.ss += v * v
  }
  get mean() {
    return this.n ? this.s / this.n : 0
  }
  get std() {
    return this.n > 1 ? Math.sqrt(Math.max(0, this.ss / this.n - this.mean ** 2)) : 0
  }
}

interface InstStats {
  hits: number
  /** Per 16th position: share of bars with a hit there. */
  rate: number[]
  /** Per position: mean timing offset in 16ths (+ = late) and its spread. */
  offset: Acc[]
  /** Per position: velocity 0–1. */
  vel: Acc[]
  /** Spread of timing within a position inside one performance (the "random" part), ms. */
  jitterMs: Acc
  /** Spread of the per-position means inside one performance (the "systematic" part), ms. */
  systematicMs: Acc
  /** Velocity spread inside one position of one performance (0–1). */
  velJitter: Acc
}

interface StyleStats {
  files: number
  bars: number
  bpm: Acc
  inst: Record<Inst, InstStats>
  /** Snare hits under half the performance's backbeat level (ghost notes): share of snare hits. */
  ghostShare: Acc
  /** Where ghost notes fall (per position, count). */
  ghostPos: number[]
  /** Distance between consecutive bars' patterns (Jaccard over kick/snare/hat onsets). */
  barChange: Acc
  /** Distance from the performance's most common bar, by bar position in a 4-bar phrase. */
  phraseDistance: Acc[]
  /** Mean velocity by bar position in a 4-bar phrase (relative to the performance mean). */
  phraseVelocity: Acc[]
  /** Distinct bar patterns per 8 bars. */
  distinctPer8: Acc
  /** Kick and snare on the same 16th: share of snare hits. */
  kickSnareTogether: Acc
  /** Fill files: share of tom hits, onsets per 16th, velocity slope per bar (0–1 units). */
  fillToms: Acc
  fillDensity: Acc
  fillVelSlope: Acc
  /** Hats: mean velocity on quarters vs. off-beat 8ths vs. 16th off-beats (accent shape). */
  hatAccent: { quarter: Acc; eighth: Acc; sixteenth: Acc }
}

function newInst(): InstStats {
  return {
    hits: 0,
    rate: Array(16).fill(0),
    offset: Array.from({ length: 16 }, () => new Acc()),
    vel: Array.from({ length: 16 }, () => new Acc()),
    jitterMs: new Acc(),
    systematicMs: new Acc(),
    velJitter: new Acc(),
  }
}

function newStyle(): StyleStats {
  return {
    files: 0,
    bars: 0,
    bpm: new Acc(),
    inst: Object.fromEntries(INSTS.map((i) => [i, newInst()])) as Record<Inst, InstStats>,
    ghostShare: new Acc(),
    ghostPos: Array(16).fill(0),
    barChange: new Acc(),
    phraseDistance: Array.from({ length: 4 }, () => new Acc()),
    phraseVelocity: Array.from({ length: 4 }, () => new Acc()),
    distinctPer8: new Acc(),
    kickSnareTogether: new Acc(),
    fillToms: new Acc(),
    fillDensity: new Acc(),
    fillVelSlope: new Acc(),
    hatAccent: { quarter: new Acc(), eighth: new Acc(), sixteenth: new Acc() },
  }
}

const styles = new Map<string, StyleStats>()
const get = (s: string) => {
  if (!styles.has(s)) styles.set(s, newStyle())
  return styles.get(s)!
}

interface Hit {
  inst: Inst
  bar: number
  pos: number
  /** Offset from the grid in 16ths. */
  off: number
  vel: number
}

/**
 * Hits on the 16th grid of the click. Offsets are taken relative to the bar's own beat (the mean
 * offset of the hits on its quarter notes), so a drummer drifting ahead of or behind the click over
 * a take does not count as micro-timing: what is left is timing relative to the pulse they play.
 */
function quantise(notes: MidiNote[], bpm: number): Hit[] {
  const sixteenth = 60 / bpm / 4
  const out: Hit[] = []
  for (const n of notes) {
    const inst = CLASS[n.pitch]
    if (!inst) continue
    const g = n.time / sixteenth
    const step = Math.round(g)
    out.push({ inst, bar: Math.floor(step / 16), pos: ((step % 16) + 16) % 16, off: g - step, vel: n.velocity / 127 })
  }
  const beatRef = new Map<number, Acc>()
  const all = new Acc()
  for (const h of out) {
    if (h.pos % 4 !== 0 || h.inst === 'crash') continue
    if (!beatRef.has(h.bar)) beatRef.set(h.bar, new Acc())
    beatRef.get(h.bar)!.add(h.off)
    all.add(h.off)
  }
  for (const h of out) {
    const ref = beatRef.get(h.bar)
    h.off -= ref && ref.n >= 2 ? ref.mean : all.mean
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return 1 - inter / (a.size + b.size - inter)
}

function analyseBeat(st: StyleStats, hits: Hit[], bpm: number) {
  const msPer16 = (60 / bpm / 4) * 1000
  const bars = hits.length ? Math.max(...hits.map((h) => h.bar)) + 1 : 0
  if (bars < 2) return
  st.files++
  st.bars += bars
  st.bpm.add(bpm)
  for (const inst of INSTS) {
    const hs = hits.filter((h) => h.inst === inst)
    const s = st.inst[inst]
    s.hits += hs.length
    const seen = new Set<string>()
    const perPos = Array.from({ length: 16 }, () => new Acc())
    const perPosVel = Array.from({ length: 16 }, () => new Acc())
    for (const h of hs) {
      const key = `${h.bar}:${h.pos}`
      if (!seen.has(key)) {
        seen.add(key)
        s.rate[h.pos] += 1
      }
      s.offset[h.pos]!.add(h.off)
      s.vel[h.pos]!.add(h.vel)
      perPos[h.pos]!.add(h.off * msPer16)
      perPosVel[h.pos]!.add(h.vel)
    }
    const means: number[] = []
    for (let p = 0; p < 16; p++) {
      if (perPos[p]!.n >= 4) {
        s.jitterMs.add(perPos[p]!.std)
        s.velJitter.add(perPosVel[p]!.std)
        means.push(perPos[p]!.mean)
      }
    }
    if (means.length >= 2) {
      const m = means.reduce((a, b) => a + b, 0) / means.length
      s.systematicMs.add(Math.sqrt(means.reduce((a, b) => a + (b - m) ** 2, 0) / means.length))
    }
  }
  // Ghost notes: snares well under the performance's backbeat level
  const snares = hits.filter((h) => h.inst === 'snare')
  const back = snares.filter((h) => h.pos === 4 || h.pos === 12).map((h) => h.vel).sort((a, b) => a - b)
  if (snares.length && back.length) {
    const ref = back[Math.floor(back.length / 2)]!
    const ghosts = snares.filter((h) => h.vel < ref * 0.5)
    st.ghostShare.add(ghosts.length / snares.length)
    for (const g of ghosts) st.ghostPos[g.pos]++
    const kicks = new Set(hits.filter((h) => h.inst === 'kick').map((h) => `${h.bar}:${h.pos}`))
    st.kickSnareTogether.add(snares.filter((h) => kicks.has(`${h.bar}:${h.pos}`)).length / snares.length)
  }
  // Bar patterns
  const pat: Set<string>[] = Array.from({ length: bars }, () => new Set())
  for (const h of hits) if (h.inst === 'kick' || h.inst === 'snare' || h.inst === 'hat' || h.inst === 'ride') pat[h.bar]!.add(`${h.inst === 'ride' ? 'hat' : h.inst}${h.pos}`)
  for (let b = 1; b < bars; b++) st.barChange.add(jaccard(pat[b]!, pat[b - 1]!))
  const keyOf = (s: Set<string>) => [...s].sort().join(' ')
  const counts = new Map<string, number>()
  for (const p of pat) counts.set(keyOf(p), (counts.get(keyOf(p)) ?? 0) + 1)
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  const modalSet = new Set(modal.split(' ').filter(Boolean))
  // Phrase position = bar index mod 4 (takes start on the first bar of a phrase); the last bar
  // (often a stop) is skipped
  for (let b = 0; b < bars - 1; b++) st.phraseDistance[b % 4]!.add(jaccard(pat[b]!, modalSet))
  for (let b = 0; b + 8 <= bars; b += 8) st.distinctPer8.add(new Set(pat.slice(b, b + 8).map(keyOf)).size)
  const vmean = hits.reduce((a, h) => a + h.vel, 0) / hits.length
  for (let b = 0; b < bars - 1; b++) {
    const hb = hits.filter((h) => h.bar === b)
    if (hb.length) st.phraseVelocity[b % 4]!.add(hb.reduce((a, h) => a + h.vel, 0) / hb.length / vmean)
  }
  for (const h of hits) {
    if (h.inst !== 'hat' && h.inst !== 'ride') continue
    if (h.pos % 4 === 0) st.hatAccent.quarter.add(h.vel)
    else if (h.pos % 2 === 0) st.hatAccent.eighth.add(h.vel)
    else st.hatAccent.sixteenth.add(h.vel)
  }
}

function analyseFill(st: StyleStats, hits: Hit[]) {
  if (hits.length < 4) return
  st.fillToms.add(hits.filter((h) => h.inst === 'tom').length / hits.length)
  const span = Math.max(...hits.map((h) => h.bar * 16 + h.pos)) - Math.min(...hits.map((h) => h.bar * 16 + h.pos)) + 1
  st.fillDensity.add(hits.length / span)
  // Velocity slope over the last bar (does the fill crescendo?)
  const last = Math.max(...hits.map((h) => h.bar))
  const hb = hits.filter((h) => h.bar === last && h.inst !== 'crash')
  if (hb.length >= 4) {
    const xs = hb.map((h) => h.pos / 16)
    const ys = hb.map((h) => h.vel)
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length
    const my = ys.reduce((a, b) => a + b, 0) / ys.length
    const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0)
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
    if (den > 0) st.fillVelSlope.add(num / den)
  }
}

for (const r of rows) {
  const midi = parseMidi(readFileSync(join(dir, r.midi)))
  const bpm = r.bpm || midi.bpm
  const hits = quantise(midi.notes, bpm)
  for (const st of [get(r.style), get('all')]) {
    if (r.beatType === 'beat') analyseBeat(st, hits, bpm)
    else analyseFill(st, hits)
  }
}

const r3 = (v: number) => Number(v.toFixed(3))
function summarise(st: StyleStats) {
  const inst = Object.fromEntries(
    INSTS.map((i) => {
      const s = st.inst[i]
      return [
        i,
        {
          hitsPerBar: r3(s.hits / Math.max(1, st.bars)),
          rate: s.rate.map((v) => r3(v / Math.max(1, st.bars))),
          offset16: s.offset.map((a) => r3(a.mean)),
          offsetStd16: s.offset.map((a) => r3(a.std)),
          velocity: s.vel.map((a) => r3(a.mean)),
          velocityStd: s.vel.map((a) => r3(a.std)),
          jitterMs: r3(s.jitterMs.mean),
          systematicMs: r3(s.systematicMs.mean),
          velocityJitter: r3(s.velJitter.mean),
        },
      ]
    }),
  )
  return {
    files: st.files,
    bars: st.bars,
    bpm: r3(st.bpm.mean),
    inst,
    ghostShare: r3(st.ghostShare.mean),
    ghostPositions: st.ghostPos,
    barChange: r3(st.barChange.mean),
    phraseDistance: st.phraseDistance.map((a) => r3(a.mean)),
    phraseVelocity: st.phraseVelocity.map((a) => r3(a.mean)),
    distinctBarsPer8: r3(st.distinctPer8.mean),
    kickSnareTogether: r3(st.kickSnareTogether.mean),
    fills: { files: st.fillToms.n, tomShare: r3(st.fillToms.mean), onsetsPer16th: r3(st.fillDensity.mean), velocitySlopePerBar: r3(st.fillVelSlope.mean) },
    hatAccent: { quarter: r3(st.hatAccent.quarter.mean), eighth: r3(st.hatAccent.eighth.mean), sixteenth: r3(st.hatAccent.sixteenth.mean) },
  }
}

const result = Object.fromEntries(
  [...styles.entries()].filter(([, s]) => s.files >= 3).sort((a, b) => b[1].files - a[1].files).map(([k, s]) => [k, summarise(s)]),
)
const doc = {
  source: 'Groove MIDI Dataset v1.0.0 (Gillick et al. 2019), magenta.withgoogle.com/datasets/groove, CC BY 4.0',
  note: 'Aggregate statistics only. Offsets in 16ths (+ = late). Velocities 0-1. 4/4 performances; beats and fills analysed separately.',
  styles: result,
}
writeFileSync(outJson, JSON.stringify(doc, null, 1))
console.log(`wrote ${outJson}`)
for (const [k, s] of Object.entries(result)) {
  const sn = s.inst.snare
  const hh = s.inst.hat
  console.log(
    `${k.padEnd(11)} files ${String(s.files).padStart(3)} bars ${String(s.bars).padStart(4)} bpm ${s.bpm.toFixed(0).padStart(3)} | ghost ${s.ghostShare.toFixed(2)} barΔ ${s.barChange.toFixed(2)} phraseΔ ${s.phraseDistance.map((v) => v.toFixed(2)).join('/')} | snare@2/4 off ${sn.offset16[4]!.toFixed(3)}/${sn.offset16[12]!.toFixed(3)} | hat off8 ${hh.offset16[2]!.toFixed(3)} off16 ${hh.offset16[1]!.toFixed(3)} | jit kick ${s.inst.kick.jitterMs.toFixed(1)} sn ${sn.jitterMs.toFixed(1)} hh ${hh.jitterMs.toFixed(1)}ms sys hh ${hh.systematicMs.toFixed(1)}ms | hat acc ${s.hatAccent.quarter.toFixed(2)}/${s.hatAccent.eighth.toFixed(2)}/${s.hatAccent.sixteenth.toFixed(2)}`,
  )
}

if (emitTs) {
  // The compact template the engine reads: per reference style, per instrument, the mean offset
  // and velocity at each 16th, the within-position spreads, ghost share and phrase shape.
  const pick = ['all', 'rock', 'funk', 'hiphop', 'soul', 'jazz', 'latin', 'pop', 'dance', 'afrobeat', 'neworleans']
  const tmpl = Object.fromEntries(
    pick
      .filter((k) => result[k])
      .map((k) => {
        const s = result[k]!
        const inst = (i: Inst) => ({
          offset: s.inst[i].offset16,
          velocity: s.inst[i].velocity,
          jitterMs: s.inst[i].jitterMs,
          velocityJitter: s.inst[i].velocityJitter,
        })
        return [k, { bpm: s.bpm, kick: inst('kick'), snare: inst('snare'), hat: inst('hat'), ghostShare: s.ghostShare, phraseDistance: s.phraseDistance, phraseVelocity: s.phraseVelocity, fillVelocitySlope: s.fills.velocitySlopePerBar }]
      }),
  )
  const ts = `/**
 * Human drumming reference, measured from the Groove MIDI Dataset v1.0.0 by
 * scripts/analysis/groove-gmd.ts (generated file: re-run the script rather than editing it).
 *
 * Dataset: Jon Gillick, Adam Roberts, Jesse Engel, Douglas Eck, David Bamman, "Learning to Groove
 * with Inverse Sequence Transformations", ICML 2019. https://magenta.withgoogle.com/datasets/groove
 * Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Only aggregate statistics
 * (means and spreads per style) are included here; no performances are copied.
 *
 * offset: mean timing per 16th position in 16ths (+ = late); velocity: mean 0–1 per position
 * (0 where the style never plays there); jitterMs: timing spread within a position;
 * velocityJitter: velocity spread within a position; phraseDistance / phraseVelocity: how far bar
 * 1–4 of a phrase strays from the performance's usual bar, and how loud it is relative to the mean.
 */
export interface InstrumentReference {
  offset: readonly number[]
  velocity: readonly number[]
  jitterMs: number
  velocityJitter: number
}

export interface GrooveReference {
  bpm: number
  kick: InstrumentReference
  snare: InstrumentReference
  hat: InstrumentReference
  ghostShare: number
  phraseDistance: readonly number[]
  phraseVelocity: readonly number[]
  fillVelocitySlope: number
}

export const GROOVE_REFERENCE: Readonly<Record<string, GrooveReference>> = ${JSON.stringify(tmpl, null, 2).replace(/\[[\s\d.,-]+\]/g, (m) => m.replace(/\s+/g, ' ').replace('[ ', '[').replace(' ]', ']'))}
`
  writeFileSync(emitTs, ts)
  console.log(`wrote ${emitTs}`)
}
