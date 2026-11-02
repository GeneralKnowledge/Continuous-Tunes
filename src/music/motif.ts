/**
 * Motif development: a motif is a short cell of notes (onset and length in steps, pitch in scale
 * degrees relative to its first note) and these are the classical ways to develop one: diatonic
 * transposition and sequence, inversion, retrograde, retrograde inversion, augmentation,
 * diminution, fragmentation, rhythmic displacement, extension, contraction, repetition with
 * variation, and call and response.
 *
 * Everything is diatonic by construction (degrees are scale steps), so a transformed motif stays
 * in the key; `placeCell` then lands it on the harmony where the ear reads it (the head of the
 * cell and the downbeats), the way libcantus's developMotif does, and leaves the rest as passing
 * motion so the shape stays recognisable.
 */
import type { Rng } from '../lib/rng'
import { SCALE_DEGREE_MAX, SCALE_DEGREE_MIN } from './genome'

export interface MotifNote {
  /** Onset in steps from the start of the cell. */
  at: number
  /** Length in steps (at least 1). */
  len: number
  /** Scale degrees relative to the cell's first note. */
  deg: number
}

export interface MotifCell {
  notes: MotifNote[]
  /** Length of the cell in steps (a bar, usually). */
  span: number
}

const byOnset = (a: MotifNote, b: MotifNote) => a.at - b.at

function cell(notes: MotifNote[], span: number): MotifCell {
  const sorted = notes.filter((n) => n.at >= 0 && n.at < span).sort(byOnset)
  // Relative to the first note again, so every cell starts on 0
  const first = sorted[0]?.deg ?? 0
  return { notes: sorted.map((n) => ({ ...n, deg: n.deg - first, len: Math.max(1, Math.min(n.len, span - n.at)) })), span }
}

/** The notes of steps [from, from + span) as a cell; lengths run to the next onset (or the end). */
export function cellFrom(line: readonly (number | null)[], from: number, span: number): MotifCell | null {
  const onsets: { at: number; deg: number }[] = []
  for (let s = 0; s < span; s++) {
    const d = line[from + s]
    if (d !== null && d !== undefined) onsets.push({ at: s, deg: d })
  }
  if (onsets.length === 0) return null
  const notes = onsets.map((o, i) => ({ at: o.at, deg: o.deg, len: (onsets[i + 1]?.at ?? span) - o.at }))
  return cell(notes, span)
}

/** Degree of the first note of the cell in a line (its anchor), or null. */
export function cellAnchor(line: readonly (number | null)[], from: number, span: number): number | null {
  for (let s = 0; s < span; s++) {
    const d = line[from + s]
    if (d !== null && d !== undefined) return d
  }
  return null
}

// ─── Transformations ────────────────────────────────────────────────

/** Diatonic transposition (a sequence step when applied bar after bar). */
export function transpose(c: MotifCell, steps: number): MotifCell {
  return { ...c, notes: c.notes.map((n) => ({ ...n, deg: n.deg + steps })) }
}

/** Mirror the intervals around the first note: rising steps fall. */
export function invert(c: MotifCell): MotifCell {
  return { ...c, notes: c.notes.map((n) => ({ ...n, deg: 0 - n.deg })) }
}

/** The notes backwards in time, each keeping its length. */
export function retrograde(c: MotifCell): MotifCell {
  const last = c.notes[c.notes.length - 1]
  if (!last) return c
  const end = last.at + last.len
  const back = c.notes.map((n) => ({ ...n, at: end - (n.at + n.len) }))
  // Keep the head where the original head was
  const shift = (c.notes[0]?.at ?? 0) - Math.min(...back.map((n) => n.at))
  return cell(
    back.map((n) => ({ ...n, at: n.at + shift })),
    c.span,
  )
}

export function retrogradeInversion(c: MotifCell): MotifCell {
  return retrograde(invert(c))
}

/** Every onset and length scaled by `factor` (2 = augmentation, 0.5 = diminution); the span grows or shrinks too. */
export function stretch(c: MotifCell, factor: number): MotifCell {
  const notes = c.notes.map((n) => ({ ...n, at: Math.round(n.at * factor), len: Math.max(1, Math.round(n.len * factor)) }))
  // Diminution can fold two onsets together: keep the first
  const seen = new Set<number>()
  const kept = notes.filter((n) => (seen.has(n.at) ? false : (seen.add(n.at), true)))
  return cell(kept, Math.max(1, Math.round(c.span * factor)))
}

export const augment = (c: MotifCell) => stretch(c, 2)
export const diminish = (c: MotifCell) => stretch(c, 0.5)

/** The first `count` notes (the head), or the last ones when `count` is negative (the tail). */
export function fragment(c: MotifCell, count: number): MotifCell {
  const notes = count >= 0 ? c.notes.slice(0, count) : c.notes.slice(count)
  if (count < 0 && notes.length > 0) {
    const shift = notes[0]!.at - (c.notes[0]?.at ?? 0)
    return cell(
      notes.map((n) => ({ ...n, at: n.at - shift })),
      c.span,
    )
  }
  return cell(notes, c.span)
}

/** Every onset moved `steps` later (earlier when negative); notes pushed past the span drop out. */
export function displace(c: MotifCell, steps: number): MotifCell {
  return cell(
    c.notes.map((n) => ({ ...n, at: n.at + steps })),
    c.span,
  )
}

/** One more note continuing the motif's last motion by step, in the gap after it (if there is room). */
export function extend(c: MotifCell): MotifCell {
  const last = c.notes[c.notes.length - 1]
  if (!last || last.len < 2) return c
  const prev = c.notes[c.notes.length - 2]
  const dir = prev ? Math.sign(last.deg - prev.deg) || 1 : 1
  const half = Math.max(1, Math.floor(last.len / 2))
  return cell(
    [...c.notes.slice(0, -1), { ...last, len: half }, { at: last.at + half, len: last.len - half, deg: last.deg + dir }],
    c.span,
  )
}

/** The motif without its last note (the previous one held into its place). */
export function contract(c: MotifCell): MotifCell {
  if (c.notes.length <= 1) return c
  const notes = c.notes.slice(0, -1)
  const last = notes[notes.length - 1]!
  const dropped = c.notes[c.notes.length - 1]!
  notes[notes.length - 1] = { ...last, len: dropped.at + dropped.len - last.at }
  return cell(notes, c.span)
}

/**
 * Repetition with variation: the motif again with one small change, so it is heard as the same
 * idea: an inner note moved by a step, the last note moved to a neighbour, or one note split in two.
 */
export function vary(c: MotifCell, rng: Rng): MotifCell {
  if (c.notes.length === 0) return c
  const kind = rng.pick(['inner', 'ending', 'split'] as const)
  const notes = c.notes.map((n) => ({ ...n }))
  if (kind === 'inner' && notes.length >= 3) {
    const i = rng.int(1, notes.length - 2)
    notes[i]!.deg += rng.pick([-1, 1])
  } else if (kind === 'split') {
    const longs = notes.map((n, i) => (n.len >= 2 ? i : -1)).filter((i) => i >= 0)
    if (longs.length === 0) return transpose(c, 0)
    const i = rng.pick(longs)
    const n = notes[i]!
    const half = Math.floor(n.len / 2)
    notes.splice(i, 1, { ...n, len: half }, { at: n.at + half, len: n.len - half, deg: n.deg + rng.pick([-1, 1, 2]) })
  } else {
    notes[notes.length - 1]!.deg += rng.pick([-1, 1, -2])
  }
  return cell(notes, c.span)
}

/**
 * Call and response: the response keeps the call's rhythm and answers its direction (mirrored),
 * ending a step from where it started so the pair closes.
 */
export function respond(c: MotifCell): MotifCell {
  const r = invert(c)
  if (r.notes.length < 2) return r
  const notes = r.notes.map((n) => ({ ...n }))
  notes[notes.length - 1]!.deg = notes[0]!.deg - 1
  return cell(notes, c.span)
}

export const MOTIF_TRANSFORMS = [
  'transpose',
  'invert',
  'retrograde',
  'retrogradeInversion',
  'augment',
  'diminish',
  'fragment',
  'displace',
  'extend',
  'contract',
  'vary',
  'respond',
] as const
export type MotifTransform = (typeof MOTIF_TRANSFORMS)[number]

/** Apply a named transformation; `rng` picks its parameters. */
export function transformCell(c: MotifCell, kind: MotifTransform, rng: Rng): MotifCell {
  switch (kind) {
    case 'transpose':
      return transpose(c, rng.pick([-2, -1, 1, 2, 3]))
    case 'invert':
      return invert(c)
    case 'retrograde':
      return retrograde(c)
    case 'retrogradeInversion':
      return retrogradeInversion(c)
    case 'augment': {
      // Augmented to the same span: the first half of the cell, twice as slow
      const a = augment(c)
      return cell(a.notes, c.span)
    }
    case 'diminish': {
      // Diminished and stated twice, the second time a step higher (a sequence in small)
      const d = diminish(c)
      const second = transpose(displace({ ...d, span: c.span }, d.span), rng.pick([1, -1, 2]))
      return cell([...d.notes, ...second.notes.map((n) => ({ ...n, deg: n.deg + (d.notes[0]?.deg ?? 0) }))], c.span)
    }
    case 'fragment':
      return fragment(c, rng.chance(0.75) ? Math.max(1, Math.ceil(c.notes.length / 2)) : -Math.max(1, Math.floor(c.notes.length / 2)))
    case 'displace':
      return displace(c, rng.pick([-2, 2, 4, -4, 3]))
    case 'extend':
      return extend(c)
    case 'contract':
      return contract(c)
    case 'vary':
      return vary(c, rng)
    case 'respond':
      return respond(c)
  }
}

// ─── Placement ──────────────────────────────────────────────────────

export interface PlaceOptions {
  /** Chord-tone degrees (mod scale length) for the bar each step falls in. */
  chordTonesAt: (step: number) => ReadonlySet<number>
  scaleLength: number
  range?: readonly [number, number]
}

const mod = (n: number, m: number) => ((n % m) + m) % m

/**
 * Write a cell into a line at `start`, its first note on `anchor`. The head of the cell and any
 * note on a downbeat land on a chord tone (the nearest, keeping the motif's direction); other
 * notes keep their intervals. Returns the onsets written, so callers can set lengths.
 */
export function placeCell(
  line: (number | null)[],
  c: MotifCell,
  start: number,
  anchor: number,
  stepsPerBar: number,
  opts: PlaceOptions,
): number[] {
  const [lo, hi] = opts.range ?? [SCALE_DEGREE_MIN, SCALE_DEGREE_MAX]
  const placed: number[] = []
  let prevSrc: number | null = null
  let prevOut: number | null = null
  for (const n of c.notes) {
    const step = start + n.at
    if (step < 0 || step >= line.length) continue
    let d = anchor + n.deg
    const structural = n.at === (c.notes[0]?.at ?? 0) || step % stepsPerBar === 0
    if (structural) {
      const tones = opts.chordTonesAt(step)
      if (!tones.has(mod(d, opts.scaleLength))) {
        const dir = prevSrc === null ? 0 : Math.sign(n.deg - prevSrc)
        const order = dir >= 0 ? [1, -1, 2, -2, 3, -3] : [-1, 1, -2, 2, -3, 3]
        for (const k of order) {
          if (tones.has(mod(d + k, opts.scaleLength))) {
            d += k
            break
          }
        }
      }
    }
    // A repeated note in the source stays repeated; a moving one keeps moving
    if (prevOut !== null && prevSrc !== null && n.deg !== prevSrc && d === prevOut) d += Math.sign(n.deg - prevSrc)
    d = Math.max(lo, Math.min(hi, d))
    line[step] = d
    placed.push(step)
    prevSrc = n.deg
    prevOut = d
  }
  return placed
}

/** Steps of a line as a cell list, one per bar (null for empty bars). */
export function barCells(line: readonly (number | null)[], stepsPerBar: number): (MotifCell | null)[] {
  return Array.from({ length: Math.floor(line.length / stepsPerBar) }, (_, b) => cellFrom(line, b * stepsPerBar, stepsPerBar))
}

/** Onset rhythm similarity of two cells (Jaccard over onset steps), 0–1. */
export function rhythmSimilarity(a: MotifCell, b: MotifCell): number {
  const sa = new Set(a.notes.map((n) => n.at))
  const sb = new Set(b.notes.map((n) => n.at))
  const union = new Set([...sa, ...sb]).size
  if (union === 0) return 1
  let both = 0
  for (const x of sa) if (sb.has(x)) both++
  return both / union
}

/** Contour similarity: share of successive moves going the same way (up, down, repeat), 0–1. */
export function contourSimilarity(a: MotifCell, b: MotifCell): number {
  const dirs = (c: MotifCell) => c.notes.slice(1).map((n, i) => Math.sign(n.deg - c.notes[i]!.deg))
  const da = dirs(a)
  const db = dirs(b)
  const n = Math.min(da.length, db.length)
  if (n === 0) return da.length === db.length ? 1 : 0.5
  let same = 0
  for (let i = 0; i < n; i++) if (da[i] === db[i]) same++
  return (same / n) * (n / Math.max(da.length, db.length))
}
