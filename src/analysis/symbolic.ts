/**
 * Symbolic analysis of what a song actually plays: the events Strudel produces for it (see
 * scripts/analysis/query-events.mjs), not the genome. Pattern genes, fills, thinning and
 * arrangement are all included, so this is what the listener hears, minus the sound.
 *
 * Ideas borrowed (re-implemented, no runtime dependency):
 * - MusPy (Dong et al., ISMIR 2020, MIT): pitch-class entropy, scale consistency, empty-beat rate,
 *   groove consistency, polyphony.
 * - Libretto (descriptive fingerprints, "typicality not quality"): per-bar rhythmic and melodic
 *   fingerprints, bar distinctness, density variation, harmonic rhythm, chord variety.
 * - Groove MIDI Dataset statistics (see docs/research/groove-analysis.md) as the human reference
 *   for bar-to-bar drum variation, ghost notes and velocity spread.
 *
 * Nothing here is imported by the generator: it describes, it doesn't steer.
 */

export interface PlayedEvent {
  /** Onset in bars (cycles). */
  t: number
  /** Length in bars. */
  d: number
  layer: string | null
  s: string | null
  sound: string | null
  note: string | number | null
  gain: number
  velocity: number
  /** Onset shift in seconds (micro-timing). */
  nudge: number
}

export interface SectionInfo {
  role: string
  bars: number
  material?: string
}

export const DRUM_LAYERS = new Set(['kick', 'snare', 'hihat', 'perc', 'loop', 'fill', 'ramp', 'crash'])
export const TONAL_LAYERS = ['bass', 'melody', 'counter', 'chords', 'arp'] as const

const PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

/** Strudel note name ("cs4", "eb3", "c#2") or MIDI number → MIDI. */
export function noteToMidi(note: string | number | null): number | null {
  if (note === null) return null
  if (typeof note === 'number') return note
  const m = /^([a-g])(s|#|b|f)?(-?\d+)$/i.exec(note.trim())
  if (!m) return null
  let pc = PC[m[1]!.toLowerCase()]!
  if (m[2] === 's' || m[2] === '#') pc++
  if (m[2] === 'b' || m[2] === 'f') pc--
  return pc + 12 * (Number(m[3]) + 1)
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const std = (xs: readonly number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const median = (xs: readonly number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}
const r3 = (v: number) => Number(v.toFixed(3))

function entropy(counts: readonly number[]): number {
  const n = counts.reduce((a, b) => a + b, 0)
  if (!n) return 0
  return -counts.filter((c) => c > 0).reduce((a, c) => a + (c / n) * Math.log2(c / n), 0)
}

export function jaccardDistance(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return 1 - inter / (a.size + b.size - inter)
}

/** 16th position of an onset in its bar. */
function pos16(t: number): number {
  return ((Math.round((t - Math.floor(t + 1e-6)) * 16) % 16) + 16) % 16
}

/** The bar an onset belongs to (onsets a hair before the barline from swing round up). */
function barOf(t: number): number {
  return Math.floor(t + 1e-6)
}

export interface SectionAnalysis {
  role: string
  material: string
  bars: number
  start: number
  /** Onsets per bar by layer. */
  density: Record<string, number>
  activeLayers: string[]
  /** Mean played level (gain × velocity) of drums and of the melody. */
  level: { drums: number; melody: number }
  /** Median MIDI pitch per tonal layer. */
  register: Record<string, number>
  drums: {
    /** Mean Jaccard distance between consecutive bars' drum patterns (GMD humans: ~0.3–0.4). */
    barChange: number
    /** Distinct drum bars per 8 bars (GMD humans: ~6–7; a fixed loop: 1–2). */
    distinctPer8: number
    /** MusPy groove consistency: 1 − mean Hamming distance between consecutive bars' onsets. */
    grooveConsistency: number
    /** Velocity spread inside one instrument at one position, across bars (0 = machine-identical). */
    velocitySpread: number
    /** Share of snare hits under half the backbeat level. */
    ghostShare: number
    /** Spread of micro-timing nudges, ms. */
    timingSpreadMs: number
  } | null
  melody: {
    notes: number
    pitchRange: number
    pitchClassEntropy: number
    stepwise: number
    /** Share of bars whose rhythm + interval fingerprint repeats the previous bar exactly. */
    barRepeat: number
    /** Velocity spread across the melody's notes. */
    velocitySpread: number
  } | null
  harmony: { changesPerBar: number; distinctChords: number }
  relations: {
    /** Bass onsets on a kick, share of bass onsets. */
    bassOnKick: number | null
    /** Counter onsets that start together with a melody onset (low = it fills gaps). */
    counterWithMelody: number | null
    /** Semitones between the melody's and the counter's median pitch. */
    melodyCounterGap: number | null
    /** Correlation of melody and counter/arp activity per half bar (negative = call and response). */
    callResponse: number | null
  }
}

export interface SongAnalysis {
  bars: number
  seconds: number
  sections: SectionAnalysis[]
  /** MusPy-style whole-song measures over the tonal layers. */
  song: {
    scaleConsistency: number
    pitchClassEntropy: number
    emptyBeatRate: number
    polyphony: number
    /**
     * The melody's distinct bars (rhythm + intervals): how many there are per melody bar played
     * (low = few ideas repeated), and of those, the share that are variants of another distinct
     * bar (development) or resemble none (unrelated material).
     */
    melodyBars: { distinct: number; distinctShare: number; varied: number; novel: number }
    /** Entropy of the melody's interval trigrams, normalised 0–1 (low = predictable). */
    melodicPredictability: number
    /** Longest stretch, in bars, where every layer exactly repeats a 1-, 2-, 4- or 8-bar loop. */
    longestLoopRun: number
    /** Mean feature distance between adjacent sections (0 = no contrast). */
    sectionContrast: number
    /** Feature distance between the A and B material sections. */
    materialContrast: number | null
    /** Section-to-section feature distances. */
    similarity: number[][]
    onsetsPerSecond: number
  }
  transitions: { from: string; to: string; densityChange: number; prepared: boolean }[]
}

interface Bucketed {
  byBar: Map<number, PlayedEvent[]>
}

function bucket(events: readonly PlayedEvent[]): Bucketed {
  const byBar = new Map<number, PlayedEvent[]>()
  for (const e of events) {
    const b = barOf(e.t)
    if (!byBar.has(b)) byBar.set(b, [])
    byBar.get(b)!.push(e)
  }
  return { byBar }
}

function drumFingerprint(evs: readonly PlayedEvent[]): Set<string> {
  const out = new Set<string>()
  for (const e of evs) if (e.layer && DRUM_LAYERS.has(e.layer) && e.layer !== 'loop') out.add(`${e.layer}${pos16(e.t)}`)
  return out
}

/** Rhythm positions plus intervals between successive notes (transposition-invariant). */
function melodyFingerprint(evs: readonly PlayedEvent[]): string {
  const ns = evs
    .filter((e) => e.layer === 'melody')
    .map((e) => ({ p: pos16(e.t), m: noteToMidi(e.note) }))
    .filter((x): x is { p: number; m: number } => x.m !== null)
    .sort((a, b) => a.p - b.p)
  return ns.map((n, i) => `${n.p}${i ? ':' + (n.m - ns[i - 1]!.m) : ''}`).join(' ')
}

function fingerprintDistance(a: string, b: string): number {
  return jaccardDistance(new Set(a.split(' ').filter(Boolean)), new Set(b.split(' ').filter(Boolean)))
}

function fullFingerprint(evs: readonly PlayedEvent[]): string {
  return evs
    .filter((e) => e.layer !== 'loop')
    .map((e) => `${e.layer}${pos16(e.t)}${e.note ?? ''}`)
    .sort()
    .join(' ')
}

function corr(a: readonly number[], b: readonly number[]): number | null {
  if (a.length < 4) return null
  const ma = mean(a)
  const mb = mean(b)
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb)
    da += (a[i]! - ma) ** 2
    db += (b[i]! - mb) ** 2
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null
}

function analyseSection(sec: SectionInfo, start: number, bk: Bucketed, tempo: number): SectionAnalysis {
  const bars = Array.from({ length: sec.bars }, (_, i) => bk.byBar.get(start + i) ?? [])
  const all = bars.flat()
  const layers = new Set(all.map((e) => e.layer ?? '?'))
  const density: Record<string, number> = {}
  for (const l of layers) {
    // Chords: one onset per chord, not per voice
    const evs = all.filter((e) => e.layer === l)
    const n = l === 'chords' ? new Set(evs.map((e) => e.t.toFixed(4))).size : evs.length
    density[l] = r3(n / sec.bars)
  }
  const lvl = (pred: (e: PlayedEvent) => boolean) => r3(mean(all.filter(pred).map((e) => e.gain * e.velocity)))
  const register: Record<string, number> = {}
  for (const l of TONAL_LAYERS) {
    const ms = all.filter((e) => e.layer === l).map((e) => noteToMidi(e.note)).filter((m): m is number => m !== null)
    if (ms.length) register[l] = median(ms)
  }

  // Drums
  const drumBars = bars.map(drumFingerprint)
  let drums: SectionAnalysis['drums'] = null
  if (drumBars.some((b) => b.size > 0)) {
    const changes = drumBars.slice(1).map((b, i) => jaccardDistance(b, drumBars[i]!))
    const per8: number[] = []
    for (let b = 0; b + 8 <= drumBars.length; b += 8) per8.push(new Set(drumBars.slice(b, b + 8).map((s) => [...s].sort().join(' '))).size)
    if (per8.length === 0) per8.push((new Set(drumBars.map((s) => [...s].sort().join(' '))).size * 8) / Math.max(1, drumBars.length))
    const onsetVec = (s: Set<string>) => {
      const v: boolean[] = Array(16).fill(false)
      for (const k of s) v[Number(/\d+$/.exec(k)![0])] = true
      return v
    }
    const hamming = drumBars.slice(1).map((b, i) => {
      const x = onsetVec(b)
      const y = onsetVec(drumBars[i]!)
      return x.filter((v, k) => v !== y[k]).length / 16
    })
    const cells = new Map<string, number[]>()
    for (const e of all) {
      if (!e.layer || !['kick', 'snare', 'hihat', 'perc'].includes(e.layer)) continue
      const key = `${e.layer}${pos16(e.t)}`
      if (!cells.has(key)) cells.set(key, [])
      cells.get(key)!.push(e.gain * e.velocity)
    }
    const spreads = [...cells.values()].filter((v) => v.length >= 3).map((v) => std(v) / Math.max(1e-6, mean(v)))
    const snares = all.filter((e) => e.layer === 'snare')
    const back = snares.filter((e) => pos16(e.t) === 4 || pos16(e.t) === 12).map((e) => e.gain)
    const ref = back.length ? median(back) : median(snares.map((e) => e.gain))
    drums = {
      barChange: r3(mean(changes)),
      distinctPer8: r3(mean(per8)),
      grooveConsistency: r3(1 - mean(hamming)),
      velocitySpread: r3(mean(spreads)),
      ghostShare: r3(snares.length ? snares.filter((e) => e.gain < ref * 0.5).length / snares.length : 0),
      timingSpreadMs: r3(std(all.filter((e) => e.layer && DRUM_LAYERS.has(e.layer)).map((e) => e.nudge * 1000))),
    }
  }

  // Melody
  const mel = all.filter((e) => e.layer === 'melody')
  let melody: SectionAnalysis['melody'] = null
  if (mel.length >= 4) {
    const ms = mel.map((e) => noteToMidi(e.note)).filter((m): m is number => m !== null)
    const ivs = ms.slice(1).map((m, i) => Math.abs(m - ms[i]!))
    const pcs = Array(12).fill(0)
    for (const m of ms) pcs[m % 12]++
    const fps = bars.map(melodyFingerprint)
    const rep = fps.slice(1).filter((f, i) => f && f === fps[i]).length / Math.max(1, fps.slice(1).filter(Boolean).length)
    melody = {
      notes: mel.length,
      pitchRange: Math.max(...ms) - Math.min(...ms),
      pitchClassEntropy: r3(entropy(pcs)),
      stepwise: r3(ivs.length ? ivs.filter((v) => v <= 2).length / ivs.length : 0),
      barRepeat: r3(rep),
      velocitySpread: r3(std(mel.map((e) => e.gain * e.velocity)) / Math.max(1e-6, mean(mel.map((e) => e.gain * e.velocity)))),
    }
  }

  // Harmony: the chord of each bar as its pitch-class set
  const chordOf = (evs: readonly PlayedEvent[]) =>
    [...new Set(evs.filter((e) => e.layer === 'chords').map((e) => noteToMidi(e.note)).filter((m): m is number => m !== null).map((m) => m % 12))].sort((a, b) => a - b).join(',')
  const chords = bars.map(chordOf).filter(Boolean)
  const harmony = {
    changesPerBar: r3(chords.length > 1 ? chords.slice(1).filter((c, i) => c !== chords[i]).length / (chords.length - 1) : 0),
    distinctChords: new Set(chords).size,
  }

  // Relations between parts
  const at = (l: string) => new Set(all.filter((e) => e.layer === l).map((e) => `${barOf(e.t)}:${pos16(e.t)}`))
  const kicks = at('kick')
  const bassOn = all.filter((e) => e.layer === 'bass')
  const counter = all.filter((e) => e.layer === 'counter')
  const melodyAt = at('melody')
  const halfBars = (l: string[]) => {
    const v = Array(sec.bars * 2).fill(0)
    for (const e of all) if (e.layer && l.includes(e.layer)) v[Math.min(v.length - 1, Math.floor((e.t - start) * 2))]++
    return v
  }
  const melAct = halfBars(['melody'])
  const ansAct = halfBars(['counter', 'arp'])
  const relations = {
    bassOnKick: bassOn.length && kicks.size ? r3(bassOn.filter((e) => kicks.has(`${barOf(e.t)}:${pos16(e.t)}`)).length / bassOn.length) : null,
    counterWithMelody: counter.length && mel.length ? r3(counter.filter((e) => melodyAt.has(`${barOf(e.t)}:${pos16(e.t)}`)).length / counter.length) : null,
    melodyCounterGap: register.melody !== undefined && register.counter !== undefined ? register.melody - register.counter : null,
    callResponse: mel.length && ansAct.some(Boolean) ? (() => { const c = corr(melAct, ansAct); return c === null ? null : r3(c) })() : null,
  }
  void tempo
  return {
    role: sec.role,
    material: sec.material ?? 'A',
    bars: sec.bars,
    start,
    density,
    activeLayers: [...layers].filter((l) => l !== '?').sort(),
    level: { drums: lvl((e) => !!e.layer && DRUM_LAYERS.has(e.layer)), melody: lvl((e) => e.layer === 'melody') },
    register,
    drums,
    melody,
    harmony,
    relations,
  }
}

/** A section as a feature vector for similarity: per-layer density (log), level and register. */
function sectionVector(s: SectionAnalysis): number[] {
  const keys = ['kick', 'snare', 'hihat', 'perc', 'bass', 'melody', 'counter', 'chords', 'arp']
  return [
    ...keys.map((k) => Math.log2(1 + (s.density[k] ?? 0)) / 5),
    s.level.drums,
    s.level.melody,
    ((s.register.melody ?? 60) - 60) / 24,
    s.drums ? s.drums.distinctPer8 / 8 : 0,
  ]
}

function vecDistance(a: readonly number[], b: readonly number[]): number {
  return Math.sqrt(a.reduce((acc, x, i) => acc + (x - b[i]!) ** 2, 0) / a.length)
}

/** Major / natural minor scale consistency (MusPy): the best-fitting key's share of notes. */
function scaleConsistency(midis: readonly number[]): number {
  if (!midis.length) return 0
  const MAJOR = [0, 2, 4, 5, 7, 9, 11]
  let best = 0
  for (let root = 0; root < 12; root++) {
    const set = new Set(MAJOR.map((x) => (x + root) % 12))
    best = Math.max(best, midis.filter((m) => set.has(m % 12)).length / midis.length)
  }
  return best
}

export function analyseSong(events: readonly PlayedEvent[], sections: readonly SectionInfo[], tempo: number): SongAnalysis {
  const bk = bucket(events)
  const totalBars = sections.reduce((a, s) => a + s.bars, 0)
  const secs: SectionAnalysis[] = []
  let start = 0
  for (const s of sections) {
    secs.push(analyseSection(s, start, bk, tempo))
    start += s.bars
  }
  const tonal = events.filter((e) => e.layer && (TONAL_LAYERS as readonly string[]).includes(e.layer))
  const midis = tonal.map((e) => noteToMidi(e.note)).filter((m): m is number => m !== null)
  const pcs = Array(12).fill(0)
  for (const m of midis) pcs[m % 12]++
  // Empty beats: quarter-note slots with no onset at all
  const beats = new Set(events.map((e) => Math.floor(e.t * 4 + 1e-6)))
  // Polyphony: mean simultaneous tonal notes where any sounds, sampled on 16ths
  const sounding = Array(totalBars * 16).fill(0)
  for (const e of tonal) for (let k = Math.round(e.t * 16); k < Math.round((e.t + e.d) * 16) && k < sounding.length; k++) sounding[k]++
  const on = sounding.filter((v) => v > 0)

  const melBars = Array.from({ length: totalBars }, (_, b) => melodyFingerprint(bk.byBar.get(b) ?? [])).filter((f) => f.split(' ').length >= 2)
  const distinct = [...new Set(melBars)]
  let varied = 0
  distinct.forEach((f, i) => {
    let best = 1
    for (let j = 0; j < distinct.length; j++) if (j !== i) best = Math.min(best, fingerprintDistance(f, distinct[j]!))
    if (best <= 0.5) varied++
  })
  const nd = Math.max(1, distinct.length)

  const melNotes = events.filter((e) => e.layer === 'melody').sort((a, b) => a.t - b.t).map((e) => noteToMidi(e.note)).filter((m): m is number => m !== null)
  const ivs = melNotes.slice(1).map((m, i) => Math.max(-7, Math.min(7, m - melNotes[i]!)))
  const tri = new Map<string, number>()
  for (let i = 0; i + 2 < ivs.length; i++) {
    const k = `${ivs[i]},${ivs[i + 1]},${ivs[i + 2]}`
    tri.set(k, (tri.get(k) ?? 0) + 1)
  }
  const triN = [...tri.values()].reduce((a, b) => a + b, 0)
  const predictability = triN > 1 ? entropy([...tri.values()]) / Math.log2(Math.min(triN, 15 ** 3)) : 0

  const full = Array.from({ length: totalBars }, (_, b) => fullFingerprint(bk.byBar.get(b) ?? []))
  let longest = 0
  for (const L of [1, 2, 4, 8]) {
    let run = 0
    for (let b = L; b < full.length; b++) {
      run = full[b] && full[b] === full[b - L] ? run + 1 : 0
      if (run > 0) longest = Math.max(longest, run + L)
    }
  }

  const vecs = secs.map(sectionVector)
  const similarity = vecs.map((a) => vecs.map((b) => r3(vecDistance(a, b))))
  const adjacent = vecs.slice(1).map((v, i) => vecDistance(v, vecs[i]!))
  const aIdx = secs.map((s, i) => (s.material === 'A' && s.role !== 'intro' && s.role !== 'outro' ? i : -1)).filter((i) => i >= 0)
  const bIdx = secs.map((s, i) => (s.material === 'B' ? i : -1)).filter((i) => i >= 0)
  const materialContrast = aIdx.length && bIdx.length ? r3(mean(aIdx.flatMap((a) => bIdx.map((b) => vecDistance(vecs[a]!, vecs[b]!))))) : null

  const transitions = secs.slice(1).map((s, i) => {
    const prev = secs[i]!
    const dens = (x: SectionAnalysis) => Object.entries(x.density).filter(([k]) => k !== 'fill' && k !== 'ramp' && k !== 'crash').reduce((a, [, v]) => a + v, 0)
    const lastBar = bk.byBar.get(s.start - 1) ?? []
    const firstBar = bk.byBar.get(s.start) ?? []
    return {
      from: prev.role,
      to: s.role,
      densityChange: r3((dens(s) - dens(prev)) / Math.max(1, dens(prev))),
      prepared: lastBar.some((e) => e.layer === 'fill' || e.layer === 'ramp') || firstBar.some((e) => e.layer === 'crash'),
    }
  })
  const seconds = (totalBars * 4 * 60) / tempo
  return {
    bars: totalBars,
    seconds: r3(seconds),
    sections: secs,
    song: {
      scaleConsistency: r3(scaleConsistency(midis)),
      pitchClassEntropy: r3(entropy(pcs)),
      emptyBeatRate: r3(1 - beats.size / Math.max(1, totalBars * 4)),
      polyphony: r3(mean(on)),
      melodyBars: { distinct: distinct.length, distinctShare: r3(distinct.length / Math.max(1, melBars.length)), varied: r3(distinct.length > 1 ? varied / nd : 0), novel: r3(distinct.length > 1 ? (distinct.length - varied) / nd : 0) },
      melodicPredictability: r3(predictability),
      longestLoopRun: longest,
      sectionContrast: r3(mean(adjacent)),
      materialContrast,
      similarity,
      onsetsPerSecond: r3(events.length / seconds),
    },
    transitions,
  }
}
