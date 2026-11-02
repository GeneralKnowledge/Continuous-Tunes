/**
 * Controlled stochastic generators, after isobar: a Markov chain that learns transitions from
 * musical material (PMarkov / MarkovLearner), a bounded random walk with weighted steps and a
 * pull towards targets (PBrown / PRandomWalk, made musical), and an L-system that grows a short
 * rhythm cell into a longer related one (PLSystem). All draw from the genome's seeded Rng, and
 * every choice can be filtered by a musical constraint, so nothing is unrestricted chance.
 */
import type { Rng } from '../lib/rng'

// ─── Markov chains ──────────────────────────────────────────────────

/**
 * A Markov chain of order 1 or 2 over values with a string key. Transitions are counted from
 * the sequences it learns; `next` draws a successor in proportion to the counts, keeping only
 * successors the constraint allows, and backs off to order 1 and then to the overall frequency
 * of values when the context has no allowed successor.
 */
export class MarkovChain<T> {
  private readonly table = new Map<string, Map<string, { value: T; count: number }>>()
  private readonly totals = new Map<string, { value: T; count: number }>()

  private readonly order: 1 | 2
  private readonly key: (v: T) => string

  constructor(order: 1 | 2 = 1, key: (v: T) => string = (v) => JSON.stringify(v)) {
    this.order = order
    this.key = key
  }

  /** Count the transitions of a sequence; `loop` also counts the wrap from the end to the start. */
  learn(seq: readonly T[], loop = false, weight = 1): this {
    const s = loop && seq.length > this.order ? [...seq, ...seq.slice(0, this.order)] : seq
    for (let i = 0; i < s.length; i++) {
      this.bump(this.totals, s[i]!, weight)
      for (let o = 1; o <= this.order; o++) {
        if (i - o < 0) continue
        const ctx = s.slice(i - o, i).map(this.key).join('|')
        let row = this.table.get(ctx)
        if (!row) this.table.set(ctx, (row = new Map()))
        this.bump(row, s[i]!, weight)
      }
    }
    return this
  }

  private bump(m: Map<string, { value: T; count: number }>, v: T, w: number): void {
    const k = this.key(v)
    const e = m.get(k)
    if (e) e.count += w
    else m.set(k, { value: v, count: w })
  }

  get size(): number {
    return this.totals.size
  }

  /** Successors of a context (most recent last) with their counts. */
  successors(context: readonly T[]): { value: T; count: number }[] {
    for (let o = Math.min(this.order, context.length); o >= 1; o--) {
      const row = this.table.get(context.slice(-o).map(this.key).join('|'))
      if (row && row.size > 0) return [...row.values()]
    }
    return [...this.totals.values()]
  }

  /** Draw a successor; null when nothing (allowed) was ever seen. */
  next(context: readonly T[], rng: Rng, allow: (v: T) => boolean = () => true, weight: (v: T) => number = () => 1): T | null {
    const tiers: { value: T; count: number }[][] = []
    for (let o = Math.min(this.order, context.length); o >= 1; o--) {
      const row = this.table.get(context.slice(-o).map(this.key).join('|'))
      if (row) tiers.push([...row.values()])
    }
    tiers.push([...this.totals.values()])
    for (const tier of tiers) {
      const ok = tier.filter((e) => allow(e.value)).map((e) => ({ value: e.value, w: e.count * Math.max(0, weight(e.value)) }))
      const total = ok.reduce((a, e) => a + e.w, 0)
      if (total <= 0) continue
      let r = rng.next() * total
      for (const e of ok) {
        r -= e.w
        if (r < 0) return e.value
      }
      return ok[ok.length - 1]!.value
    }
    return null
  }
}

// ─── Random walks ───────────────────────────────────────────────────

export interface WalkOptions {
  start: number
  lo: number
  hi: number
  /** Relative weight of each step size; e.g. { '-1': 3, '1': 3, '-2': 1, '2': 1, '0': 1 }. */
  steps: Readonly<Record<number, number>>
  /** Multiplies a step's weight by how welcome the landing value is (chord tones, targets). */
  gravity?: (value: number, index: number) => number
  /** After a leap (|step| ≥ 3) the next move turns back by step, the way a singer recovers. */
  recoverLeaps?: boolean
}

/**
 * A bounded random walk: each value moves from the last by a weighted step, never past the
 * bounds, with `gravity` pulling towards wanted values. Returns `count` values from the start.
 */
export function walk(count: number, rng: Rng, opts: WalkOptions): number[] {
  const out: number[] = []
  let cur = Math.max(opts.lo, Math.min(opts.hi, opts.start))
  let last = 0
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      out.push(cur)
      continue
    }
    const options = Object.entries(opts.steps)
      .map(([k, w]) => ({ step: Number(k), w }))
      .filter(({ step }) => cur + step >= opts.lo && cur + step <= opts.hi)
      .map(({ step, w }) => {
        let weight = w * (opts.gravity ? opts.gravity(cur + step, i) : 1)
        if (opts.recoverLeaps && Math.abs(last) >= 3) weight *= Math.sign(step) === -Math.sign(last) && Math.abs(step) <= 2 ? 4 : 0.25
        return { step, w: weight }
      })
    const total = options.reduce((a, o) => a + o.w, 0)
    let step = 0
    if (total > 0) {
      let r = rng.next() * total
      for (const o of options) {
        r -= o.w
        if (r < 0) {
          step = o.step
          break
        }
      }
    }
    cur += step
    last = step
    out.push(cur)
  }
  return out
}

// ─── L-systems ──────────────────────────────────────────────────────

/** Rewrite every symbol of `axiom` by its rule `depth` times (symbols without a rule stay). */
export function lsystem(axiom: string, rules: Readonly<Record<string, string>>, depth: number): string {
  let s = axiom
  for (let i = 0; i < depth; i++) s = [...s].map((c) => rules[c] ?? c).join('')
  return s
}

/**
 * isobar's L-system walk: rewrite every `N` of the axiom with `rule` `depth` times, then read the
 * string as moves: `N` emits the current value, `+` / `-` step it, `[` / `]` push and pop it.
 * Self-similar figures come out of it: "N+N-N" twice gives 0 1 0, 1 2 1, 0 1 0, the cell inside
 * itself, which as an arpeggio grows in a recognisable way rather than wandering.
 */
export function lsystemWalk(rule: string, depth: number, start = 0): number[] {
  const s = lsystem('N', { N: rule }, depth)
  const out: number[] = []
  const stack: number[] = []
  let v = start
  for (const c of s) {
    if (c === 'N') out.push(v)
    else if (c === '+') v++
    else if (c === '-') v--
    else if (c === '[') stack.push(v)
    else if (c === ']') v = stack.pop() ?? v
  }
  return out
}
