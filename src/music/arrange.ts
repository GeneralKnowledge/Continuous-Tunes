/**
 * Arrangement: how each section of a song treats the material it plays, so sections are composed
 * rather than the same loop at different volumes. Per genre (styles.ts `arrange`):
 * - the breakdown restates the motif in augmentation (twice as slow, held) or an octave up;
 * - the outro fragments it (each phrase cut to its head) and thins the drums;
 * - a counter-melody joins on the genre's highlight sections from a given appearance, so the
 *   second drop or chorus develops the first instead of repeating it;
 * - each role adds its pattern genes (a sparse intro, hats doubling up through a build) and a
 *   role's second and later appearances add microvariation, so a repeat isn't a copy.
 * Everything is derived deterministically from the section's genome and its place in the form.
 */
import { createRng } from '../lib/rng'
import { cloneGenome, OCTAVE_MAX, type MusicGenome, type PatternGene } from './genome'
import { composeCounter } from './counter'
import { barChordTones } from './harmony'
import { augment, cellFrom, fragment, placeCell } from './motif'
import { getStyle } from './styles'
import { scaleLength } from './theory'
import { validateGenome } from './validation'

export interface ArrangedSection {
  role: string
  genome: MusicGenome
  material?: 'A' | 'B'
}

/** The melody in augmentation: each odd bar's phrase stretched over it and the next bar, held. */
export function augmentMelody(g: MusicGenome): MusicGenome {
  const spb = g.stepsPerBar
  const len = scaleLength(g.scale.mode)
  const tones = barChordTones(g)
  const out: (number | null)[] = g.melody.notes.map(() => null)
  for (let bar = 0; bar < g.bars; bar += 2) {
    const src = cellFrom(g.melody.notes, bar * spb, spb) ?? (bar + 1 < g.bars ? cellFrom(g.melody.notes, (bar + 1) * spb, spb) : null)
    if (!src) continue
    const anchor = g.melody.notes.slice(bar * spb, (bar + 2) * spb).find((d) => d !== null)!
    const slow = augment(src)
    placeCell(out, { ...slow, span: Math.min(slow.span, (g.bars - bar) * spb) }, bar * spb, anchor, spb, {
      chordTonesAt: (s) => tones[Math.floor(s / spb) % g.bars]!,
      scaleLength: len,
    })
  }
  g.melody = { ...g.melody, notes: out, gate: Math.max(g.melody.gate ?? 0, 0.95) }
  return g
}

/** The melody cut to the head of each phrase (the first half of each bar's notes). */
export function fragmentMelody(g: MusicGenome): MusicGenome {
  const spb = g.stepsPerBar
  const out: (number | null)[] = g.melody.notes.map(() => null)
  for (let bar = 0; bar < g.bars; bar++) {
    const src = cellFrom(g.melody.notes, bar * spb, spb)
    if (!src) continue
    const head = fragment(src, Math.max(1, Math.ceil(src.notes.length / 2)))
    const anchor = g.melody.notes.slice(bar * spb, (bar + 1) * spb).find((d) => d !== null)!
    for (const n of head.notes) out[bar * spb + n.at] = anchor + n.deg
  }
  g.melody = { ...g.melody, notes: out }
  return g
}

function addGenes(g: MusicGenome, genes: readonly PatternGene[]): void {
  if (genes.length === 0) return
  const own = g.patterns ?? []
  // A role gene replaces a genome gene of the same kind on the same layer instead of stacking on it
  const kept = own.filter((x) => !genes.some((y) => y.target === x.target && y.op === x.op && y.every === x.every))
  g.patterns = [...kept, ...genes.map((x) => ({ ...x }))]
}

/**
 * Arrange a song's sections. `sections` carry each section's role, material and genome (the
 * theme as evolution left it at that point, or the contrast material); returns new genomes.
 */
export function arrangeSections<T extends ArrangedSection>(sections: readonly T[], seed = 0): T[] {
  const seen = new Map<string, number>()
  return sections.map((sec, i) => {
    const appearance = (seen.get(sec.role) ?? 0) + 1
    seen.set(sec.role, appearance)
    const style = getStyle(sec.genome.genre)
    const plan = style.arrange
    const g = cloneGenome(sec.genome)
    addGenes(g, plan.roleGenes[sec.role] ?? [])
    if (appearance > 1) addGenes(g, plan.repeatGenes)
    if (sec.role === 'breakdown' && g.activeLayers.melody) {
      if (plan.breakdownMelody === 'augment') augmentMelody(g)
      else if (plan.breakdownMelody === 'octave' && g.melody.octave < OCTAVE_MAX - 1) g.melody = { ...g.melody, octave: g.melody.octave + 1 }
    }
    if (sec.role === 'outro' && g.activeLayers.melody) fragmentMelody(g)
    if (style.counter && plan.counterRoles.includes(sec.role) && appearance >= plan.counterFrom && g.activeLayers.melody) {
      const rng = createRng((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0)
      g.counter = composeCounter(g, style.counter, rng)
      g.activeLayers = { ...g.activeLayers, counter: g.counter.notes.some((d) => d !== null) }
    }
    return { ...sec, genome: validateGenome(g) }
  })
}
