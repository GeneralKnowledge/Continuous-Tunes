/**
 * Diphone backend (experimental): recorded diphones concatenated and re-timed/re-pitched with
 * TD-PSOLA (Moulines & Charpentier 1990) to the SpeechPlan's durations and pitch contour.
 *
 * The unit database is built offline from a recorded corpus (scripts/speech/corpus/: synthesis-
 * based DTW alignment, then one diphone per phone pair) and handed in with setUnitDatabase();
 * nothing recorded ships in the repository. A missing diphone leaves silence of the right length
 * (listed in `lastStats.missing`), so coverage problems are audible and countable.
 *
 * TD-PSOLA in brief: the source has pitch marks (glottal closures). For every output pitch mark,
 * placed at the plan's f0, take the source mark at the corresponding time (via the time map that
 * stretches each half-phone to its planned length), cut two periods around it with a Hann window
 * and overlap-add it at the output mark. Unvoiced stretches use fixed 6 ms grains (plain OLA).
 */
import { PAUSE, pitchAt, type SpeechPlan } from '../../plan'
import type { SpeechVoice } from '../../voice'
import type { RenderOptions, SpeechBackend } from '../types'

export interface UnitEntry {
  offset: number
  length: number
  /** boundary between the two phones, samples from the unit start */
  mid: number
  /** pitch marks, samples from the unit start */
  marks: number[]
}

export interface UnitDatabase {
  sampleRate: number
  speakerF0: number
  units: Record<string, UnitEntry>
  pcm: Int16Array
}

let db: UnitDatabase | null = null
export const lastStats = { units: 0, missing: [] as string[] }

export function setUnitDatabase(d: UnitDatabase | null): void {
  db = d
}

export function hasUnitDatabase(): boolean {
  return db !== null
}

function lookup(a: string, b: string): { key: string; unit: UnitEntry } | null {
  const d = db!
  const exact = d.units[`${a}-${b}`]
  if (exact) return { key: `${a}-${b}`, unit: exact }
  return null
}

/** Source segment for one half-phone: [from, to) in database samples, with its pitch marks. */
interface Piece {
  from: number
  to: number
  marks: number[]
  /** output span, seconds */
  outStart: number
  outEnd: number
  voiced: boolean
}

export function renderUnits(plan: SpeechPlan, _voice: SpeechVoice, opts: RenderOptions = {}): Float32Array {
  if (!db) throw new Error('units backend: no unit database loaded (setUnitDatabase)')
  const d = db
  const outRate = opts.sampleRate ?? 22050
  const segs = plan.segments
  const pieces: Piece[] = []
  lastStats.units = 0
  lastStats.missing = []
  // each diphone covers mid(seg i) → mid(seg i+1); its halves map to the halves of the two segments
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i]!, b = segs[i + 1]!
    const midA = a.start + a.duration / 2
    const midB = b.start + b.duration / 2
    const hit = lookup(a.phone, b.phone)
    if (!hit) {
      lastStats.missing.push(`${a.phone}-${b.phone}`)
      continue
    }
    lastStats.units++
    const u = hit.unit
    const marks = u.marks.map((m) => m + u.offset)
    const voicedA = u.marks.filter((m) => m < u.mid).length >= 2
    const voicedB = u.marks.filter((m) => m >= u.mid).length >= 2
    pieces.push({ from: u.offset, to: u.offset + u.mid, marks: marks.filter((m) => m < u.offset + u.mid), outStart: midA, outEnd: b.start, voiced: voicedA && a.phone !== PAUSE })
    pieces.push({ from: u.offset + u.mid, to: u.offset + u.length, marks: marks.filter((m) => m >= u.offset + u.mid), outStart: b.start, outEnd: midB, voiced: voicedB && b.phone !== PAUSE })
  }

  const srcRate = d.sampleRate
  const pcm = d.pcm
  const out = new Float32Array(Math.ceil(plan.duration * outRate) + outRate)
  const src = (n: number) => (n >= 0 && n < pcm.length ? pcm[n]! / 32768 : 0)
  // linear-interpolated read of the source at a fractional position, resampled to the output rate
  const read = (pos: number) => {
    const i = Math.floor(pos)
    const f = pos - i
    return src(i) * (1 - f) + src(i + 1) * f
  }
  const ratio = srcRate / outRate

  /** add one Hann-windowed grain from the source centred at `centre` (src samples), half-width `half`, at output time t */
  const addGrain = (centre: number, half: number, t: number, gain = 1) => {
    const oc = t * outRate
    const halfOut = half / ratio
    const start = Math.ceil(oc - halfOut)
    const end = Math.floor(oc + halfOut)
    for (let n = Math.max(0, start); n <= end && n < out.length; n++) {
      const x = (n - oc) / halfOut // -1..1
      const w = 0.5 + 0.5 * Math.cos(Math.PI * x)
      out[n] += w * gain * read(centre + x * half)
    }
  }

  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k]!
    const outDur = p.outEnd - p.outStart
    if (outDur <= 0 || p.to <= p.from) continue
    const srcAt = (t: number) => p.from + ((t - p.outStart) / outDur) * (p.to - p.from)
    if (p.voiced && p.marks.length >= 2) {
      // output pitch marks at the plan's f0
      let t = p.outStart
      while (t < p.outEnd) {
        const f0 = Math.max(50, pitchAt(plan.pitch, t))
        const s = srcAt(t)
        // nearest source mark and the local source period around it
        let j = 0
        let best = Infinity
        for (let m = 0; m < p.marks.length; m++) {
          const dd = Math.abs(p.marks[m]! - s)
          if (dd < best) [best, j] = [dd, m]
        }
        const prev = p.marks[j - 1] ?? p.marks[j]! - (p.marks[j + 1]! - p.marks[j]!)
        const next = p.marks[j + 1] ?? p.marks[j]! + (p.marks[j]! - p.marks[j - 1]!)
        const period = Math.max(srcRate / 400, Math.min(srcRate / 50, (next - prev) / 2))
        // window: two source periods, but never longer than two output periods (Moulines 1990)
        const half = Math.min(period, (srcRate / f0) * 1.0)
        addGrain(p.marks[j]!, half, t)
        t += 1 / f0
      }
    } else {
      // unvoiced: plain OLA with 50% overlapping 6 ms grains following the time map
      const hop = 0.003
      for (let t = p.outStart; t < p.outEnd; t += hop) addGrain(srcAt(t), 0.006 * srcRate, t, 0.5)
    }
  }
  return out.subarray(0, Math.ceil(plan.duration * outRate))
}

export const unitsBackend: SpeechBackend = {
  id: 'units',
  name: 'Diphones + TD-PSOLA (experimental)',
  description: 'Recorded diphones from an aligned corpus, re-timed and re-pitched to the plan with TD-PSOLA',
  render: renderUnits,
}
