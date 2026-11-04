/**
 * Objective speech measurements for the benchmark and (M4) multi-objective fitness.
 *
 * These are diagnostics, not a quality score: intelligibility is measured with listeners and,
 * as an auxiliary check only, with speech recognition (word error rate against the normalised
 * reference). Each function is independent so experiments can pick the objectives they need.
 */
import { rulesPronunciation } from './g2p'
import type { Lexicon } from './lexicon'
import { utteranceWords, type PronunciationSource, type Utterance } from './linguistic'
import { normalizeText } from './normalize'
import { fft } from '../analysis/audio'
import { isVowel, mannerOf, PHONEME_IDS } from './phonemes'
import { PAUSE, pitchAt, type SpeechPlan } from './plan'

const semitones = (a: number, b: number) => 12 * Math.log2(a / b)

export interface PlanMetrics {
  /** syllables per second of speech (pauses excluded); conversational English is ~4–6 */
  syllablesPerSecond: number
  meanStressedVowelMs: number
  meanUnstressedVowelMs: number
  shortestSegmentMs: number
  longestSegmentMs: number
  /** segments outside 15–450 ms */
  implausibleSegments: number
  f0MinHz: number
  f0MaxHz: number
  f0RangeSemitones: number
  /** f0 change over the last 250 ms of speech, semitones (positive = rising) */
  finalSlopeSemitones: number
  pauseSeconds: number
}

export function planMetrics(plan: SpeechPlan): PlanMetrics {
  const speech = plan.segments.filter((s) => s.phone !== PAUSE)
  const speechTime = speech.reduce((t, s) => t + s.duration, 0)
  const nuclei = speech.filter((s) => s.role === 'nucleus')
  const stressed = nuclei.filter((s) => s.stress === 1)
  const unstressed = nuclei.filter((s) => s.stress === 0)
  const mean = (xs: { duration: number }[]) => (xs.length ? (xs.reduce((t, s) => t + s.duration, 0) / xs.length) * 1000 : 0)
  const durs = speech.map((s) => s.duration * 1000)
  const voicedHz = speech.filter((s) => isVowel(s.phone)).map((s) => pitchAt(plan.pitch, s.start + s.duration / 2))
  const f0Min = voicedHz.length ? Math.min(...voicedHz) : 0
  const f0Max = voicedHz.length ? Math.max(...voicedHz) : 0
  const last = speech[speech.length - 1]
  const endT = last ? last.start + last.duration : 0
  return {
    syllablesPerSecond: speechTime ? nuclei.length / speechTime : 0,
    meanStressedVowelMs: mean(stressed),
    meanUnstressedVowelMs: mean(unstressed),
    shortestSegmentMs: durs.length ? Math.min(...durs) : 0,
    longestSegmentMs: durs.length ? Math.max(...durs) : 0,
    implausibleSegments: durs.filter((d) => d < 15 || d > 450).length,
    f0MinHz: f0Min,
    f0MaxHz: f0Max,
    f0RangeSemitones: f0Min > 0 ? semitones(f0Max, f0Min) : 0,
    finalSlopeSemitones: last ? semitones(pitchAt(plan.pitch, endT), pitchAt(plan.pitch, Math.max(0, endT - 0.25))) : 0,
    pauseSeconds: plan.duration - speechTime,
  }
}

export interface AudioMetrics {
  peak: number
  rmsDb: number
  /** samples at or above full scale */
  clipped: number
  nonFinite: number
  dcOffset: number
  /** largest sample-to-sample step relative to the signal's RMS (clicks show up as spikes) */
  maxStepRatio: number
  /** share of vowel nuclei where the audio is periodic (autocorrelation peak > 0.5) */
  voicedVowelShare: number
  /** median |measured − planned| f0 over vowel nuclei, semitones */
  f0ErrorSemitones: number
}

/** Normalised autocorrelation pitch estimate for a frame; 0 if aperiodic. */
export function estimateF0(frame: Float32Array, sampleRate: number, minHz = 60, maxHz = 450): { hz: number; strength: number } {
  const minLag = Math.floor(sampleRate / maxHz)
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / minHz))
  let energy = 0
  for (const s of frame) energy += s * s
  if (energy < 1e-9) return { hz: 0, strength: 0 }
  let best = 0
  let bestLag = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0
    let e1 = 0
    let e2 = 0
    for (let i = 0; i + lag < frame.length; i++) {
      acc += frame[i]! * frame[i + lag]!
      e1 += frame[i]! * frame[i]!
      e2 += frame[i + lag]! * frame[i + lag]!
    }
    const r = acc / Math.sqrt(e1 * e2 + 1e-12)
    if (r > best) {
      best = r
      bestLag = lag
    }
  }
  // prefer the shortest lag close to the best (avoids octave errors)
  for (let k = 2; k <= 4; k++) {
    const lag = Math.round(bestLag / k)
    if (lag < minLag) break
    let acc = 0
    let e1 = 0
    let e2 = 0
    for (let i = 0; i + lag < frame.length; i++) {
      acc += frame[i]! * frame[i + lag]!
      e1 += frame[i]! * frame[i]!
      e2 += frame[i + lag]! * frame[i + lag]!
    }
    const r = acc / Math.sqrt(e1 * e2 + 1e-12)
    if (r > 0.9 * best) {
      bestLag = lag
      best = r
    }
  }
  return bestLag ? { hz: sampleRate / bestLag, strength: best } : { hz: 0, strength: 0 }
}

export function audioMetrics(samples: Float32Array, sampleRate: number, plan: SpeechPlan): AudioMetrics {
  let peak = 0
  let sum = 0
  let sq = 0
  let clipped = 0
  let nonFinite = 0
  let maxStep = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!
    if (!Number.isFinite(s)) {
      nonFinite++
      continue
    }
    peak = Math.max(peak, Math.abs(s))
    if (Math.abs(s) >= 0.999) clipped++
    sum += s
    sq += s * s
    if (i) maxStep = Math.max(maxStep, Math.abs(s - samples[i - 1]!))
  }
  const n = Math.max(1, samples.length)
  const rms = Math.sqrt(sq / n)
  const errors: number[] = []
  let voiced = 0
  let vowels = 0
  for (const seg of plan.segments) {
    if (!isVowel(seg.phone) || seg.duration < 0.05) continue
    vowels++
    const mid = seg.start + seg.duration / 2
    const len = Math.floor(0.04 * sampleRate)
    const a = Math.max(0, Math.floor(mid * sampleRate) - (len >> 1))
    const frame = samples.subarray(a, a + len)
    const est = estimateF0(frame, sampleRate)
    if (est.strength > 0.5) {
      voiced++
      errors.push(Math.abs(semitones(est.hz, pitchAt(plan.pitch, mid))))
    }
  }
  errors.sort((x, y) => x - y)
  return {
    peak,
    rmsDb: 20 * Math.log10(rms + 1e-12),
    clipped,
    nonFinite,
    dcOffset: sum / n,
    maxStepRatio: rms > 0 ? maxStep / rms : 0,
    voicedVowelShare: vowels ? voiced / vowels : 0,
    f0ErrorSemitones: errors.length ? errors[Math.floor(errors.length / 2)]! : 0,
  }
}

export interface CoverageMetrics {
  phonemesUsed: string[]
  phonemesMissing: string[]
  /** distinct phone-to-phone transitions (diphones) in the material */
  diphones: number
  sources: Partial<Record<PronunciationSource, number>>
  /** words that no dictionary had */
  guessedWords: string[]
}

export function coverage(utterances: readonly Utterance[]): CoverageMetrics {
  const used = new Set<string>()
  const diphones = new Set<string>()
  const sources: Partial<Record<PronunciationSource, number>> = {}
  const guessed = new Set<string>()
  for (const u of utterances) {
    for (const s of u.sentences) {
      for (const p of s.phrases) {
        const phones = p.words.flatMap((w) => w.phones.map((x) => x.id))
        phones.forEach((id, i) => {
          used.add(id)
          diphones.add(`${i ? phones[i - 1] : PAUSE}-${id}`)
        })
        if (phones.length) diphones.add(`${phones[phones.length - 1]}-${PAUSE}`)
      }
    }
    for (const w of utteranceWords(u)) {
      sources[w.pronSource] = (sources[w.pronSource] ?? 0) + 1
      if (w.pronSource === 'rules' || w.pronSource === 'morphology') guessed.add(w.text)
    }
  }
  return {
    phonemesUsed: PHONEME_IDS.filter((p) => used.has(p)),
    phonemesMissing: PHONEME_IDS.filter((p) => !used.has(p)),
    diphones: diphones.size,
    sources,
    guessedWords: [...guessed].sort(),
  }
}

/** Levenshtein distance over arrays. */
export function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]!
}

const CONTRACTIONS: [RegExp, string][] = [
  [/n't\b/g, ' not'],
  [/'re\b/g, ' are'],
  [/'m\b/g, ' am'],
  [/'ll\b/g, ' will'],
  [/'ve\b/g, ' have'],
  [/'d\b/g, ' would'],
]

/** Words as the normaliser reads them, so "£5" and "five pounds", "you're" and "you are" compare equal. */
export function normalisedWords(text: string): string[] {
  let t = text.toLowerCase().replace(/\bcan't\b/g, 'can not').replace(/\bwon't\b/g, 'will not')
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep)
  return normalizeText(t)
    .flatMap((s) => s.phrases.flatMap((p) => p.words.map((w) => w.text)))
    .map((w) => w.replace(/'/g, ''))
}

/** Word error rate of a recogniser transcript against the reference text. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalisedWords(reference)
  const hyp = normalisedWords(hypothesis)
  return ref.length ? editDistance(ref, hyp) / ref.length : hyp.length ? 1 : 0
}

/**
 * Letter-to-sound accuracy against a lexicon: phone error rate of the rules on a deterministic
 * sample of dictionary words (stress ignored). Measures how much to trust the fallback.
 */
export function g2pAccuracy(lexicon: Lexicon, words: readonly string[]): { words: number; phoneErrorRate: number; exact: number } {
  let errors = 0
  let total = 0
  let exact = 0
  let n = 0
  for (const w of words) {
    const ref = lexicon.lookup(w)[0]?.pron.map((p) => p.id)
    if (!ref) continue
    const hyp = rulesPronunciation(w).map((p) => p.id)
    const d = editDistance(ref, hyp)
    errors += d
    total += ref.length
    if (d === 0) exact++
    n++
  }
  return { words: n, phoneErrorRate: total ? errors / total : 0, exact: n ? exact / n : 0 }
}

/** FNV-1a hash of 16-bit samples: equal hashes mean bit-identical audio. */
export function audioHash(samples: Float32Array): string {
  let h = 0x811c9dc5
  for (const s of samples) {
    const v = Math.round(Math.max(-1, Math.min(1, s)) * 32767) & 0xffff
    h ^= v & 0xff
    h = Math.imul(h, 0x01000193)
    h ^= v >> 8
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------------------------
// Per-phone acoustics (M2): level and spectral shape of each segment in the rendered audio, so
// consonant problems can be traced to a cause (a nasal murmur that is too weak or too bright, a
// fricative in the wrong band) instead of only showing up as recogniser errors.

export interface SegmentAcoustics {
  phone: string
  /** RMS level of the segment's centre relative to the utterance's stressed vowels, dB */
  levelDb: number
  /** spectral centroid, Hz */
  centroid: number
  /** energy shares below 500 Hz, 500–2500 Hz and above 2500 Hz */
  low: number
  mid: number
  high: number
  /** stops and affricates: the release (10 ms before to 20 ms after the segment's end) */
  release?: { levelDb: number; centroid: number; peakHz: number }
}

function spectrumStats(x: Float32Array, sr: number): { power: number; centroid: number; low: number; mid: number; high: number; peakHz: number } {
  const size = 1024
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  const n = Math.min(size, x.length)
  for (let i = 0; i < n; i++) re[i] = x[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)))
  fft(re, im)
  let total = 0
  let w = 0
  let low = 0
  let mid = 0
  let high = 0
  let peak = 0
  let peakHz = 0
  for (let k = 1; k < size / 2; k++) {
    const f = (k * sr) / size
    const p = re[k]! * re[k]! + im[k]! * im[k]!
    total += p
    w += p * f
    if (f < 500) low += p
    else if (f < 2500) mid += p
    else high += p
    if (f > 1000 && p > peak) {
      peak = p
      peakHz = f
    }
  }
  const t = total || 1
  let sq = 0
  for (let i = 0; i < x.length; i++) sq += x[i]! * x[i]!
  return { power: sq / Math.max(1, x.length), centroid: w / t, low: low / t, mid: mid / t, high: high / t, peakHz }
}

export function segmentAcoustics(samples: Float32Array, sampleRate: number, plan: SpeechPlan): SegmentAcoustics[] {
  const slice = (a: number, b: number) => samples.subarray(Math.max(0, Math.floor(a * sampleRate)), Math.min(samples.length, Math.floor(b * sampleRate)))
  const centre = (s: { start: number; duration: number }) => slice(s.start + s.duration * 0.2, s.start + s.duration * 0.8)
  const vowelPowers = plan.segments
    .filter((s) => isVowel(s.phone) && s.stress === 1 && s.duration > 0.05)
    .map((s) => spectrumStats(centre(s), sampleRate).power)
    .sort((a, b) => a - b)
  const ref = vowelPowers[Math.floor(vowelPowers.length / 2)] ?? 1e-6
  const db = (p: number) => 10 * Math.log10((p + 1e-12) / ref)
  const out: SegmentAcoustics[] = []
  for (const s of plan.segments) {
    if (s.phone === PAUSE || s.duration < 0.02) continue
    const st = spectrumStats(centre(s), sampleRate)
    const row: SegmentAcoustics = { phone: s.phone, levelDb: db(st.power), centroid: st.centroid, low: st.low, mid: st.mid, high: st.high }
    const manner = isVowel(s.phone) ? 'vowel' : mannerOf(s.phone)
    if (manner === 'stop' || manner === 'affricate') {
      const end = s.start + s.duration
      const r = spectrumStats(slice(end - 0.01, end + 0.02), sampleRate)
      row.release = { levelDb: db(r.power), centroid: r.centroid, peakHz: r.peakHz }
    }
    out.push(row)
  }
  return out
}

/**
 * Approximate ranges for natural adult male speech (levels relative to stressed vowels; centroids
 * for a 22 kHz recording). From Jongman, Wayland & Wong 2000 (fricative spectral moments and
 * amplitudes), Stevens 1998 "Acoustic Phonetics" (nasal murmurs, voice bars, bursts) and Kent & Read
 * 2002. They are guides for spotting gross errors, not targets to optimise towards.
 */
export const NATURAL_RANGES: Record<string, { levelDb?: [number, number]; centroid?: [number, number]; low?: [number, number]; releaseCentroid?: [number, number] }> = {
  m: { levelDb: [-14, -3], low: [0.75, 1] },
  n: { levelDb: [-14, -3], low: [0.75, 1] },
  ŋ: { levelDb: [-14, -3], low: [0.7, 1] },
  b: { levelDb: [-35, -15], low: [0.85, 1] },
  d: { levelDb: [-35, -15], low: [0.85, 1] },
  g: { levelDb: [-35, -15], low: [0.85, 1] },
  p: { levelDb: [-80, -35], releaseCentroid: [800, 3500] },
  t: { levelDb: [-80, -35], releaseCentroid: [3500, 7000] },
  k: { levelDb: [-80, -35], releaseCentroid: [1500, 4000] },
  s: { levelDb: [-20, -6], centroid: [5000, 8000] },
  z: { levelDb: [-22, -6], centroid: [4000, 8000] },
  ʃ: { levelDb: [-20, -6], centroid: [3000, 5000] },
  f: { levelDb: [-35, -18], centroid: [3500, 7000] },
  θ: { levelDb: [-35, -18], centroid: [3500, 7500] },
  v: { levelDb: [-28, -10] },
  ð: { levelDb: [-28, -10] },
}

export interface PhoneAcousticSummary {
  phone: string
  n: number
  levelDb: number
  centroid: number
  low: number
  releaseLevelDb?: number
  releaseCentroid?: number
  /** fields outside NATURAL_RANGES */
  outside: string[]
}

export function summarisePhoneAcoustics(rows: readonly SegmentAcoustics[]): PhoneAcousticSummary[] {
  const by = new Map<string, SegmentAcoustics[]>()
  for (const r of rows) by.set(r.phone, [...(by.get(r.phone) ?? []), r])
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  return PHONEME_IDS.filter((p) => by.has(p)).map((phone) => {
    const rs = by.get(phone)!
    const rel = rs.filter((r) => r.release)
    const sum: PhoneAcousticSummary = {
      phone,
      n: rs.length,
      levelDb: avg(rs.map((r) => r.levelDb)),
      centroid: avg(rs.map((r) => r.centroid)),
      low: avg(rs.map((r) => r.low)),
      ...(rel.length ? { releaseLevelDb: avg(rel.map((r) => r.release!.levelDb)), releaseCentroid: avg(rel.map((r) => r.release!.centroid)) } : {}),
      outside: [],
    }
    const nat = NATURAL_RANGES[phone]
    const check = (name: string, v: number | undefined, r?: [number, number]) => {
      if (r && v !== undefined && (v < r[0] || v > r[1])) sum.outside.push(name)
    }
    check('level', sum.levelDb, nat?.levelDb)
    check('centroid', sum.centroid, nat?.centroid)
    check('low', sum.low, nat?.low)
    check('release', sum.releaseCentroid, nat?.releaseCentroid)
    return sum
  })
}

/** Stable short hash of a voice (sorted-key JSON, FNV-1a): names an exact configuration in experiment logs. */
export function voiceHash(voice: unknown): string {
  const canon = (v: unknown): string =>
    v && typeof v === 'object'
      ? Array.isArray(v)
        ? `[${v.map(canon).join(',')}]`
        : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(v)
  let h = 0x811c9dc5
  for (const ch of canon(voice)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
