/**
 * Fit the prosody model (prosody.ts) to recorded speech: phone durations and the tune's shape,
 * from the aligned CMU ARCTIC awb prompts (corpus/extract-prosody.py). Training uses prompts
 * before arctic_b0490; the report uses the held-out ones from there on.
 *
 *   npx tsx scripts/speech/fit-prosody.ts <awb-prosody.json> <out-model.json> [--sweeps 6]
 *
 * Durations: coordinate descent in log space over the duration table and Klatt's rule factors,
 * minimising the RMS log-ratio of predicted to natural phone durations (pauses excluded), with
 * a weak pull towards Klatt's values so rare phones stay sensible.
 * Pitch: the plan is laid on the natural timing (ProsodyOptions.timing), so only the tune is
 * judged; minimises RMSE in semitones over frames voiced in the recording, after removing each
 * contour's mean (the voices differ in register).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { analyzeText, getVoicePreset } from '../../src/speech'
import { KLATT_MODEL, phraseSlots, planProsody, klattDuration, type ProsodyModel, type Slot } from '../../src/speech/prosody'
import { pitchAt } from '../../src/speech/plan'
import type { SpeechVoice } from '../../src/speech/voice'
import { loadNodeLexicon } from './lexicon-node'

const args = process.argv.slice(2)
const flag = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args.splice(i, 2)[1]! : d
}
const sweeps = Number(flag('sweeps', '6'))
const [dataPath, outPath] = args
if (!dataPath || !outPath) throw new Error('usage: fit-prosody.ts <awb-prosody.json> <out.json>')

type Nat = { text: string; phones: [string, number, number, number, number][]; f0: number[] }
const data = JSON.parse(readFileSync(dataPath, 'utf8')) as Record<string, Nat>
const lexicon = loadNodeLexicon()
const voice0 = getVoicePreset('alder')

interface Item {
  id: string
  held: boolean
  utt: ReturnType<typeof analyzeText>
  /** per phrase slots, with natural durations of each non-pause phone */
  phrases: Slot[][]
  nat: number[]
  /** natural duration of every segment (pauses included), in plan order */
  timing: number[]
  f0: number[]
}

const items: Item[] = []
let skipped = 0
for (const [id, d] of Object.entries(data)) {
  const utt = analyzeText(d.text.toLowerCase(), { lexicon })
  const plan = planProsody(utt, voice0)
  const natPh = d.phones.map((p) => p[0])
  const planPh = plan.segments.map((s) => s.phone)
  if (natPh.join(' ') !== planPh.join(' ')) {
    skipped++
    continue
  }
  const phrases: Slot[][] = []
  let w = 0
  for (const s of utt.sentences)
    for (const ph of s.phrases) {
      phrases.push(phraseSlots(ph, w))
      w += ph.words.length
    }
  const timing = d.phones.map((p) => Math.max(0.012, p[2] - p[1]))
  items.push({ id, held: id >= 'arctic_b0490', utt, phrases, nat: d.phones.filter((p) => p[0] !== '_').map((p) => Math.max(0.015, p[2] - p[1])), timing, f0: d.f0 })
}
const train = items.filter((i) => !i.held)
const test = items.filter((i) => i.held)
console.log(`${items.length} utterances match their alignment (${skipped} skipped): ${train.length} train, ${test.length} held out`)

// ---------- durations ----------
function durationScore(m: ProsodyModel, set: Item[], voice: SpeechVoice = voice0) {
  let se = 0
  let n = 0
  let predSum = 0
  let natSum = 0
  for (const it of set) {
    let k = 0
    for (const slots of it.phrases)
      for (let i = 0; i < slots.length; i++) {
        const p = klattDuration(slots, i, voice, m)
        const q = it.nat[k++]!
        const e = Math.log(p / q)
        se += e * e
        n++
        predSum += p
        natSum += q
      }
  }
  return { rms: Math.sqrt(se / n), ratio: predSum / natSum }
}

const clone = (m: ProsodyModel): ProsodyModel => ({
  durations: Object.fromEntries(Object.entries(m.durations).map(([k, v]) => [k, [v[0], v[1]] as const])),
  rules: { ...m.rules },
  tune: { ...m.tune },
})

/** Coordinate descent in log space: try multiplicative steps on each parameter, keep improvements. */
function descend<P>(p: P, keys: { get: (p: P) => number; set: (p: P, v: number) => void; name: string }[], cost: (p: P) => number, rounds: number, steps = [0.7, 0.85, 0.94, 1.06, 1.18, 1.4]) {
  let best = cost(p)
  for (let r = 0; r < rounds; r++) {
    const scale = r < 2 ? 1 : 0.5
    for (const k of keys) {
      const v0 = k.get(p)
      let bv = v0
      for (const s of steps) {
        const v = v0 * (1 + (s - 1) * scale)
        k.set(p, v)
        const c = cost(p)
        if (c < best - 1e-9) {
          best = c
          bv = v
        }
      }
      k.set(p, bv)
    }
    console.log(`  round ${r + 1}: ${best.toFixed(4)}`)
  }
  return best
}

const base = clone(KLATT_MODEL)
const before = { train: durationScore(base, train), test: durationScore(base, test) }
console.log('durations, Klatt:', before)

const fitted = clone(KLATT_MODEL)
const prior = (m: ProsodyModel) => {
  // weak pull to Klatt's values (log distance), so rarely seen phones and rules stay sensible
  let s = 0
  for (const [k, v] of Object.entries(m.durations)) {
    const b = KLATT_MODEL.durations[k]!
    s += Math.log(v[0] / b[0]) ** 2 + Math.log(v[1] / b[1]) ** 2
  }
  for (const [k, v] of Object.entries(m.rules)) s += Math.log(Math.max(1e-3, v) / Math.max(1e-3, (KLATT_MODEL.rules as Record<string, number>)[k]!)) ** 2
  return 0.0005 * s
}
const durKeys = [
  ...Object.keys(fitted.durations).flatMap((ph) => [
    { name: `${ph}.inh`, get: (m: ProsodyModel) => m.durations[ph]![0], set: (m: ProsodyModel, v: number) => { m.durations[ph] = [Math.max(v, m.durations[ph]![1] + 5), m.durations[ph]![1]] } },
    { name: `${ph}.min`, get: (m: ProsodyModel) => m.durations[ph]![1], set: (m: ProsodyModel, v: number) => { m.durations[ph] = [m.durations[ph]![0], Math.min(Math.max(8, v), m.durations[ph]![0] - 5)] } },
  ]),
  ...Object.keys(fitted.rules).map((r) => ({
    name: r,
    get: (m: ProsodyModel) => (m.rules as Record<string, number>)[r]!,
    set: (m: ProsodyModel, v: number) => { (m.rules as Record<string, number>)[r] = Math.min(3, Math.max(0.1, v)) },
  })),
]
console.log('fitting durations…')
descend(fitted, durKeys, (m) => durationScore(m, train).rms + prior(m), sweeps)
const after = { train: durationScore(fitted, train), test: durationScore(fitted, test) }
console.log('durations, fitted:', after)

// ---------- pitch ----------
type PitchParams = { accentSemitones: number; declination: number; finalFall: number } & Record<string, number>
function pitchScore(pp: PitchParams, tune: ProsodyModel['tune'], set: Item[]) {
  const voice: SpeechVoice = { ...voice0, pitch: { ...voice0.pitch, accentSemitones: pp.accentSemitones, declination: pp.declination, finalFall: pp.finalFall } }
  const model: ProsodyModel = { ...fitted, tune }
  let se = 0
  let n = 0
  let corrSum = 0
  let sdA = 0
  let sdB = 0
  for (const it of set) {
    const plan = planProsody(it.utt, voice, { model, timing: it.timing })
    const a: number[] = []
    const b: number[] = []
    it.f0.forEach((hz, k) => {
      if (hz <= 0) return
      a.push(12 * Math.log2(hz))
      b.push(12 * Math.log2(pitchAt(plan.pitch, k * 0.01)))
    })
    if (a.length < 10) continue
    // robust: drop octave errors (more than 9 semitones from the utterance median)
    const med = [...a].sort((x, y) => x - y)[a.length >> 1]!
    const keep = a.map((x) => Math.abs(x - med) < 9)
    const A = a.filter((_, i) => keep[i])
    const B = b.filter((_, i) => keep[i])
    const ma = A.reduce((s, x) => s + x, 0) / A.length
    const mb = B.reduce((s, x) => s + x, 0) / B.length
    let sab = 0
    let saa = 0
    let sbb = 0
    for (let i = 0; i < A.length; i++) {
      const da = A[i]! - ma
      const db = B[i]! - mb
      se += (da - db) ** 2
      sab += da * db
      saa += da * da
      sbb += db * db
    }
    n += A.length
    sdA += Math.sqrt(saa / A.length)
    sdB += Math.sqrt(sbb / A.length)
    corrSum += sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0
  }
  return { rmseSt: Math.sqrt(se / n), corr: corrSum / set.length, sdNatural: sdA / set.length, sdModel: sdB / set.length }
}

const pp0: PitchParams = { accentSemitones: voice0.pitch.accentSemitones, declination: voice0.pitch.declination, finalFall: voice0.pitch.finalFall }
const pBefore = { train: pitchScore(pp0, KLATT_MODEL.tune, train), test: pitchScore(pp0, KLATT_MODEL.tune, test) }
console.log('pitch, hand-set:', pBefore)
const fitP = { pp: { ...pp0 }, tune: { ...KLATT_MODEL.tune } }
type FP = typeof fitP
const pitchKeys = [
  ...(['accentSemitones', 'declination', 'finalFall'] as const).map((k) => ({ name: k, get: (p: FP) => p.pp[k], set: (p: FP, v: number) => { p.pp[k] = Math.min(10, Math.max(0.05, v)) } })),
  ...Object.keys(fitP.tune).map((k) => ({
    name: k,
    get: (p: FP) => (p.tune as Record<string, number>)[k]!,
    set: (p: FP, v: number) => { (p.tune as Record<string, number>)[k] = k === 'peakAlign' ? Math.min(1.5, Math.max(0.05, v)) : Math.min(4, Math.max(0.01, v)) },
  })),
]
console.log('fitting tune…')
// tune evaluation is slower (a plan per utterance): fit on every second training item
const trainP = train.filter((_, i) => i % 2 === 0)
descend(fitP, pitchKeys, (p) => pitchScore(p.pp, p.tune, trainP).rmseSt, Math.max(3, sweeps - 2))
const pAfter = { train: pitchScore(fitP.pp, fitP.tune, train), test: pitchScore(fitP.pp, fitP.tune, test) }
console.log('pitch, fitted:', pAfter)

const r3 = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))
writeFileSync(outPath, JSON.stringify({
  durations: fitted.durations,
  rules: r3(fitted.rules),
  tune: r3(fitP.tune),
  pitch: r3(fitP.pp),
  report: { utterances: { train: train.length, test: test.length, skipped }, durations: { before, after }, pitch: { before: pBefore, after: pAfter } },
}, null, 1))
console.log(`wrote ${outPath}`)
