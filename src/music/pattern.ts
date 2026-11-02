/**
 * A small, time-aware pattern toolkit, after TidalCycles: a pattern is a function from a time
 * span (in cycles; one cycle = one bar here) to the events that start inside it. Patterns compose
 * (stack, cat, fast, slow, every, off, ply, degradeBy…) without materialising anything until
 * they are queried, so independent cycles of different lengths can be layered and read back over
 * any window.
 *
 * Randomness is a pure function of a seed and an event's onset time (Tidal's `rand` is seeded by
 * time the same way), so the same pattern and seed always give the same events, and changing one
 * part never reshuffles another (libcantus addresses its draws by position for the same reason).
 *
 * This module decides *what music exists*: composers use it to build grooves, figures and
 * variations, and write the result into the genome's step grid (`toSteps`). Playback stays with
 * Strudel; the compiler maps the genome's pattern genes onto Strudel's own operators.
 */

export interface Ev<T> {
  /** Onset, in cycles. */
  begin: number
  /** End, in cycles (begin < end). */
  end: number
  value: T
}

export interface Pattern<T> {
  /** Events whose onset lies in [begin, end), in onset order. */
  query(begin: number, end: number): Ev<T>[]
}

const EPS = 1e-9

function pattern<T>(query: (b: number, e: number) => Ev<T>[]): Pattern<T> {
  return { query: (b, e) => query(b, e).sort((x, y) => x.begin - y.begin) }
}

/** Cycle spans [c, c+1) that overlap [b, e). */
function cyclesIn(b: number, e: number): number[] {
  const out: number[] = []
  for (let c = Math.floor(b + EPS); c < e - EPS; c++) out.push(c)
  return out
}

// ─── Randomness ─────────────────────────────────────────────────────

/** 32-bit integer hash (a xorshift-multiply mix, like Tidal's xorwise over a time seed). */
function mix(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}

/** A number in [0, 1) that depends only on the seed and the time (to a millionth of a cycle). */
export function randAt(seed: number, time: number, salt = 0): number {
  const t = Math.round(time * 1e6)
  return mix(mix(seed ^ 0x9e3779b9) ^ mix(t + 0x632be5ab) ^ Math.imul(salt + 1, 0x85ebca6b)) / 4294967296
}

// ─── Constructors ───────────────────────────────────────────────────

export const silence: Pattern<never> = { query: () => [] }

/** One event per cycle. */
export function pure<T>(value: T): Pattern<T> {
  return pattern((b, e) => cyclesIn(b, e).filter((c) => c >= b - EPS).map((c) => ({ begin: c, end: c + 1, value })))
}

/** A step: a value, a rest (null), or a group that subdivides the step (tuplets). */
export type Step<T> = T | null | readonly Step<T>[]

/**
 * Tidal's fastcat: the steps share one cycle equally; a nested array subdivides its step, so
 * `seq('a', ['b', 'c', 'd'])` is a quaver then a quaver triplet.
 */
export function seq<T>(...steps: readonly Step<T>[]): Pattern<T> {
  const flat: Ev<T>[] = []
  const place = (items: readonly Step<T>[], start: number, width: number) => {
    const w = width / Math.max(1, items.length)
    items.forEach((it, i) => {
      if (it === null) return
      if (Array.isArray(it)) place(it as readonly Step<T>[], start + i * w, w)
      else flat.push({ begin: start + i * w, end: start + (i + 1) * w, value: it as T })
    })
  }
  place(steps, 0, 1)
  return pattern((b, e) =>
    cyclesIn(b, e).flatMap((c) =>
      flat.map((ev) => ({ ...ev, begin: ev.begin + c, end: ev.end + c })).filter((ev) => ev.begin >= b - EPS && ev.begin < e - EPS),
    ),
  )
}

/**
 * A grid of steps (values or null), `stepsPerCycle` to a cycle, looping. Each event lasts one
 * step unless `holds` gives its length in steps.
 */
export function fromSteps<T>(values: readonly (T | null)[], stepsPerCycle: number, holds?: readonly number[]): Pattern<T> {
  const n = values.length
  const len = n / stepsPerCycle
  return pattern((b, e) => {
    const out: Ev<T>[] = []
    if (n === 0) return out
    const first = Math.floor((b - EPS) / len)
    for (let k = first; k * len < e - EPS; k++) {
      for (let i = 0; i < n; i++) {
        const v = values[i]
        if (v === null || v === undefined) continue
        const begin = k * len + i / stepsPerCycle
        if (begin < b - EPS || begin >= e - EPS) continue
        out.push({ begin, end: begin + (holds?.[i] ?? 1) / stepsPerCycle, value: v })
      }
    }
    return out
  })
}

/** Bjorklund's algorithm: `pulses` onsets spread as evenly as possible over `steps`. */
export function bjorklund(pulses: number, steps: number): boolean[] {
  const k = Math.max(0, Math.min(steps, Math.round(pulses)))
  if (steps <= 0) return []
  if (k === 0) return Array.from({ length: steps }, () => false)
  let a: boolean[][] = Array.from({ length: k }, () => [true])
  let r: boolean[][] = Array.from({ length: steps - k }, () => [false])
  while (r.length > 1) {
    const m = Math.min(a.length, r.length)
    const next = Array.from({ length: m }, (_, i) => [...a[i]!, ...r[i]!])
    const rest = a.length > m ? a.slice(m) : r.slice(m)
    a = next
    r = rest
  }
  return [...a, ...r].flat()
}

/** A Euclidean rhythm as a pattern of `value`s: (pulses, steps) per cycle, rotated left by `rotation` steps. */
export function euclid<T>(value: T, pulses: number, steps: number, rotation = 0): Pattern<T> {
  const bits = bjorklund(pulses, steps)
  const r = ((rotation % steps) + steps) % steps
  const rotated = [...bits.slice(r), ...bits.slice(0, r)]
  return fromSteps(rotated.map((on) => (on ? value : null)), steps)
}

// ─── Combinators ────────────────────────────────────────────────────

/** Several patterns at once. */
export function stack<T>(...pats: readonly Pattern<T>[]): Pattern<T> {
  return pattern((b, e) => pats.flatMap((p) => p.query(b, e)))
}

/** Tidal's slowcat: one cycle of each pattern in turn; each pattern advances only when it plays. */
export function cat<T>(...pats: readonly Pattern<T>[]): Pattern<T> {
  const n = pats.length
  return pattern((b, e) =>
    cyclesIn(b, e).flatMap((c) => {
      const i = ((c % n) + n) % n
      const own = Math.floor(c / n)
      const lo = Math.max(b, c)
      const hi = Math.min(e, c + 1)
      return pats[i]!.query(lo - c + own, hi - c + own).map((ev) => ({ ...ev, begin: ev.begin - own + c, end: ev.end - own + c }))
    }),
  )
}

/** Speed up by `factor`. */
export function fast<T>(factor: number, p: Pattern<T>): Pattern<T> {
  if (factor <= 0) return silence
  return pattern((b, e) => p.query(b * factor, e * factor).map((ev) => ({ ...ev, begin: ev.begin / factor, end: ev.end / factor })))
}

export function slow<T>(factor: number, p: Pattern<T>): Pattern<T> {
  return fast(1 / factor, p)
}

/** Shift later by `t` cycles. */
export function late<T>(t: number, p: Pattern<T>): Pattern<T> {
  return pattern((b, e) => p.query(b - t, e - t).map((ev) => ({ ...ev, begin: ev.begin + t, end: ev.end + t })))
}

export function early<T>(t: number, p: Pattern<T>): Pattern<T> {
  return late(-t, p)
}

/** Each cycle backwards. */
export function rev<T>(p: Pattern<T>): Pattern<T> {
  return pattern((b, e) =>
    cyclesIn(b, e).flatMap((c) =>
      p
        .query(c, c + 1)
        .map((ev) => ({ ...ev, begin: c + (c + 1 - ev.end), end: c + (c + 1 - ev.begin) }))
        .filter((ev) => ev.begin >= b - EPS && ev.begin < e - EPS),
    ),
  )
}

/** Change values. */
export function fmap<T, U>(f: (v: T, ev: Ev<T>) => U, p: Pattern<T>): Pattern<U> {
  return pattern((b, e) => p.query(b, e).map((ev) => ({ begin: ev.begin, end: ev.end, value: f(ev.value, ev) })))
}

/** Keep the events that pass. */
export function filter<T>(pred: (ev: Ev<T>) => boolean, p: Pattern<T>): Pattern<T> {
  return pattern((b, e) => p.query(b, e).filter(pred))
}

/** Apply `f` on cycles where `test(cycle)` holds (Tidal's `when`). */
export function whenCycle<T>(test: (cycle: number) => boolean, f: (p: Pattern<T>) => Pattern<T>, p: Pattern<T>): Pattern<T> {
  const fp = f(p)
  return pattern((b, e) =>
    cyclesIn(b, e).flatMap((c) => (test(c) ? fp : p).query(Math.max(b, c), Math.min(e, c + 1))),
  )
}

/** Apply `f` every `n`th cycle, starting at cycle `offset` (Tidal's every / firstOf). */
export function every<T>(n: number, f: (p: Pattern<T>) => Pattern<T>, p: Pattern<T>, offset = 0): Pattern<T> {
  if (n <= 0) return p
  return whenCycle((c) => (((c - offset) % n) + n) % n === 0, f, p)
}

/** Apply `f` on the last cycle of every `n` (Tidal's lastOf): turnarounds at the end of a phrase. */
export function lastOf<T>(n: number, f: (p: Pattern<T>) => Pattern<T>, p: Pattern<T>): Pattern<T> {
  return every(n, f, p, n - 1)
}

/** Drop each event with probability `prob` (Tidal's degradeBy). */
export function degradeBy<T>(prob: number, p: Pattern<T>, seed = 0): Pattern<T> {
  return filter((ev) => randAt(seed, ev.begin, 1) >= prob, p)
}

/** Each event is transformed by `f` with probability `prob` (Tidal's sometimesBy). */
export function sometimesBy<T>(prob: number, f: (p: Pattern<T>) => Pattern<T>, p: Pattern<T>, seed = 0): Pattern<T> {
  const fp = f(p)
  return pattern((b, e) => [
    ...p.query(b, e).filter((ev) => randAt(seed, ev.begin, 2) >= prob),
    ...fp.query(b, e).filter((ev) => randAt(seed, ev.begin, 2) < prob),
  ])
}

/** A whole cycle is transformed by `f` with probability `prob` (Tidal's someCyclesBy). */
export function someCyclesBy<T>(prob: number, f: (p: Pattern<T>) => Pattern<T>, p: Pattern<T>, seed = 0): Pattern<T> {
  return whenCycle((c) => randAt(seed, c, 3) < prob, f, p)
}

/** Repeat each event `n` times inside its own span (Tidal's ply): rolls and ratchets. */
export function ply<T>(n: number, p: Pattern<T>): Pattern<T> {
  return pattern((b, e) =>
    p.query(b - 1, e).flatMap((ev) => {
      const w = (ev.end - ev.begin) / n
      return Array.from({ length: n }, (_, i) => ({ ...ev, begin: ev.begin + i * w, end: ev.begin + (i + 1) * w })).filter(
        (x) => x.begin >= b - EPS && x.begin < e - EPS,
      )
    }),
  )
}

/** The pattern plus a copy `t` cycles later, transformed by `f` (Tidal's off): echoes, answers. */
export function off<T>(t: number, f: (p: Pattern<T>) => Pattern<T>, p: Pattern<T>): Pattern<T> {
  return stack(p, f(late(t, p)))
}

/**
 * Shift values (not onsets) by `k` places within each cycle (Tidal's rot): the rhythm stays,
 * the emphasis moves.
 */
export function rot<T>(k: number, p: Pattern<T>): Pattern<T> {
  return pattern((b, e) =>
    cyclesIn(b, e).flatMap((c) => {
      const evs = p.query(c, c + 1)
      const n = evs.length
      return evs
        .map((ev, i) => ({ ...ev, value: evs[(((i + k) % n) + n) % n]!.value }))
        .filter((ev) => ev.begin >= b - EPS && ev.begin < e - EPS)
    }),
  )
}

/** Start each cycle `1/n` further in (Tidal's iter): the figure turns over bar by bar. */
export function iter<T>(n: number, p: Pattern<T>): Pattern<T> {
  return pattern((b, e) =>
    cyclesIn(b, e).flatMap((c) => {
      const shift = (((c % n) + n) % n) / n
      return early(shift, p)
        .query(Math.max(b, c), Math.min(e, c + 1))
    }),
  )
}

/** A value chosen per event from `items` (weighted), by the seed and the onset (Tidal's wchoose). */
export function chooseBy<T>(items: readonly T[], seed: number, p: Pattern<unknown>, weights?: readonly number[]): Pattern<T> {
  const w = weights ?? items.map(() => 1)
  const total = w.reduce((a, x) => a + x, 0)
  return fmap((_, ev) => {
    let r = randAt(seed, ev.begin, 4) * total
    for (let i = 0; i < items.length; i++) {
      r -= w[i]!
      if (r < 0) return items[i]!
    }
    return items[items.length - 1]!
  }, p)
}

// ─── Reading patterns back ──────────────────────────────────────────

/** Every event in [0, cycles). */
export function eventsOf<T>(p: Pattern<T>, cycles: number, from = 0): Ev<T>[] {
  return p.query(from, from + cycles)
}

/** Events per cycle over [0, cycles). */
export function density(p: Pattern<unknown>, cycles: number): number {
  return cycles <= 0 ? 0 : p.query(0, cycles).length / cycles
}

/**
 * Write a pattern onto the genome's step grid: `cycles` bars of `stepsPerCycle` steps, each event
 * at the step nearest its onset (later events win a shared step). Off-grid detail (tuplets) is
 * rounded to the grid, so this is for patterns meant for the grid.
 */
export function toSteps<T>(p: Pattern<T>, cycles: number, stepsPerCycle: number): (T | null)[] {
  const out: (T | null)[] = Array.from({ length: cycles * stepsPerCycle }, () => null)
  for (const ev of p.query(0, cycles)) {
    const i = Math.round(ev.begin * stepsPerCycle)
    if (i >= 0 && i < out.length) out[i] = ev.value
  }
  return out
}

/** Onsets on the grid as booleans. */
export function toHits(p: Pattern<unknown>, cycles: number, stepsPerCycle: number): boolean[] {
  return toSteps(p, cycles, stepsPerCycle).map((v) => v !== null)
}

/** Lengths in steps of the events on the grid (rounded, at least 1), by onset step. */
export function toHolds(p: Pattern<unknown>, cycles: number, stepsPerCycle: number): number[] {
  const out = Array.from({ length: cycles * stepsPerCycle }, () => 1)
  for (const ev of p.query(0, cycles)) {
    const i = Math.round(ev.begin * stepsPerCycle)
    if (i >= 0 && i < out.length) out[i] = Math.max(1, Math.round((ev.end - ev.begin) * stepsPerCycle))
  }
  return out
}

/** True when every onset and end falls on the grid. */
export function onGrid(evs: readonly Ev<unknown>[], stepsPerCycle: number): boolean {
  const on = (t: number) => Math.abs(t * stepsPerCycle - Math.round(t * stepsPerCycle)) < 1e-6
  return evs.every((ev) => on(ev.begin) && on(ev.end))
}

/**
 * Events as Strudel mini-notation for one span of `cycles`: each event and each gap is a token
 * weighted (`@n`) by its length in ticks, so tuplets and off-grid onsets play exactly. Overlapping
 * events go into separate lanes. Returns one token string per lane. Ticks are 1/`ticksPerCycle`.
 */
export function eventsToMini<T>(
  evs: readonly Ev<T>[],
  cycles: number,
  token: (v: T) => string,
  ticksPerCycle = 48,
): string[] {
  const lanes: Ev<T>[][] = []
  for (const ev of [...evs].sort((a, b) => a.begin - b.begin)) {
    const lane = lanes.find((l) => l[l.length - 1]!.end <= ev.begin + EPS)
    if (lane) lane.push(ev)
    else lanes.push([ev])
  }
  const tick = (t: number) => Math.round(t * ticksPerCycle)
  const total = tick(cycles)
  const w = (n: number) => (n === 1 ? '' : `@${n}`)
  return lanes.map((lane) => {
    const out: string[] = []
    let at = 0
    for (const ev of lane) {
      const b = Math.max(at, tick(ev.begin))
      const e = Math.min(total, Math.max(b + 1, tick(ev.end)))
      if (b >= total) break
      if (b > at) out.push(`~${w(b - at)}`)
      out.push(`${token(ev.value)}${w(e - b)}`)
      at = e
    }
    if (at < total) out.push(`~${w(total - at)}`)
    return out.join(' ')
  })
}
