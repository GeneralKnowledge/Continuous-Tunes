/**
 * Mulberry32 — small deterministic PRNG.
 * Same seed ⇒ same sequence of numbers.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Current internal state (for persistence / resume). */
  getState(): number {
    return this.state >>> 0
  }

  /** Next float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: max (${max}) < min (${min})`)
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** Pick one element. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array')
    return items[this.int(0, items.length - 1)]!
  }

  /** True with given probability in [0, 1]. */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** Shuffle a copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      ;[out[i], out[j]] = [out[j]!, out[i]!]
    }
    return out
  }

  /** Derive a child seed for branching lineages. */
  fork(): number {
    return (this.next() * 0xffffffff) >>> 0
  }
}

export function createRng(seed: number): Rng {
  return new Rng(seed)
}
