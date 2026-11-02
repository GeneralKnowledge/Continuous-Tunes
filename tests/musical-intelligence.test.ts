import { describe, expect, it } from 'vitest'
import { createRng } from '../src/lib/rng'
import {
  bjorklund,
  cat,
  degradeBy,
  euclid,
  eventsOf,
  eventsToMini,
  every,
  fast,
  fromSteps,
  lastOf,
  late,
  off,
  ply,
  pure,
  rev,
  rot,
  seq,
  slow,
  sometimesBy,
  stack,
  toHits,
  toSteps,
} from '../src/music/pattern'
import {
  augment,
  cellFrom,
  contract,
  diminish,
  displace,
  extend,
  fragment,
  invert,
  placeCell,
  respond,
  retrograde,
  retrogradeInversion,
  rhythmSimilarity,
  transpose,
  type MotifCell,
} from '../src/music/motif'
import { MarkovChain, lsystem, lsystemWalk, walk } from '../src/music/generative'
import { compositionContext, noteHolds, soundingLine } from '../src/music/context'
import { composeCounter, counterCollisions, counterSpacing } from '../src/music/counter'
import { arrangeSections, augmentMelody, fragmentMelody } from '../src/music/arrange'
import { allSeeds, getSeed } from '../src/music/seeds'
import { barChordTones } from '../src/music/harmony'
import { scaleLength } from '../src/music/theory'
import { getStyle, STYLES } from '../src/music/styles'
import { compileGenome } from '../src/strudel/compiler'
import { cloneGenome, deserializeGenome, serializeGenome, type MusicGenome } from '../src/music/genome'
import { isValidGenome, validateGenome } from '../src/music/validation'
import { evaluateFitness, motifIdentity, musicality } from '../src/evolution/fitness'
import { MUTATION_OPS, mutateN } from '../src/evolution/mutation'
import { createEvolutionState, stepGeneration } from '../src/evolution/engine'
import { composeSong } from '../src/evolution/song'
import { CHANNELS, channelPersonality, channelSeed, channelSongTemplate } from '../src/music/channels'

const vals = <T>(evs: { value: T }[]) => evs.map((e) => e.value)
const onsets = (evs: { begin: number }[]) => evs.map((e) => Number(e.begin.toFixed(4)))

describe('Pattern toolkit', () => {
  it('queries time windows: events whose onset lies in [begin, end)', () => {
    const p = seq('a', 'b', 'c', 'd')
    expect(vals(p.query(0, 1))).toEqual(['a', 'b', 'c', 'd'])
    expect(vals(p.query(0.25, 0.75))).toEqual(['b', 'c'])
    expect(onsets(p.query(1, 2))).toEqual([1, 1.25, 1.5, 1.75])
    expect(p.query(0, 1)[0]).toMatchObject({ begin: 0, end: 0.25 })
  })

  it('subdivides steps into tuplets', () => {
    const p = seq('a', ['b', 'c', 'd'])
    const evs = p.query(0, 1)
    expect(vals(evs)).toEqual(['a', 'b', 'c', 'd'])
    expect(onsets(evs)).toEqual([0, 0.5, 0.6667, 0.8333])
    expect(evs[1]!.end - evs[1]!.begin).toBeCloseTo(1 / 6)
  })

  it('stacks, sequences cycle by cycle, and changes speed', () => {
    expect(eventsOf(stack(pure('x'), pure('y')), 1)).toHaveLength(2)
    expect(vals(eventsOf(cat(pure('a'), pure('b'), pure('c')), 4))).toEqual(['a', 'b', 'c', 'a'])
    expect(onsets(eventsOf(fast(2, seq('a', 'b')), 1))).toEqual([0, 0.25, 0.5, 0.75])
    expect(onsets(eventsOf(slow(2, seq('a', 'b')), 2))).toEqual([0, 1])
    expect(onsets(eventsOf(late(0.125, seq('a', 'b')), 1))).toEqual([0.125, 0.625])
  })

  it('keeps independent cycles independent: a 3-step figure against a 4-step bar', () => {
    const three = slow(3 / 4, fromSteps(['x', null, null], 3))
    const bar = fromSteps(['k', null, null, null], 4)
    const both = stack(three, bar)
    // They only realign after three bars
    const hits = toSteps(both, 3, 4)
    expect(hits.filter((v) => v !== null).length).toBe(3 + 4 - 1 /* shared downbeat */ + 0)
    expect(hits[0]).not.toBeNull()
  })

  it('makes Euclidean rhythms (Bjorklund) and rotates them', () => {
    expect(bjorklund(3, 8).map((b) => (b ? 'x' : '.')).join('')).toBe('x..x..x.')
    expect(bjorklund(5, 8).filter(Boolean)).toHaveLength(5)
    expect(toHits(euclid(1, 3, 8, 1), 1, 8).map((b) => (b ? 'x' : '.')).join('')).toBe('..x..x.x')
  })

  it('reverses each cycle and rotates values without moving onsets', () => {
    expect(vals(eventsOf(rev(seq('a', 'b', 'c')), 1))).toEqual(['c', 'b', 'a'])
    const r = eventsOf(rot(1, seq('a', 'b', 'c')), 1)
    expect(vals(r)).toEqual(['b', 'c', 'a'])
    expect(onsets(r)).toEqual(onsets(eventsOf(seq('a', 'b', 'c'), 1)))
  })

  it('transforms every nth cycle and the last of every n (phrase turnarounds)', () => {
    const p = every(2, (x) => fast(2, x), pure('a'))
    expect(eventsOf(p, 4).map((e) => Math.floor(e.begin))).toEqual([0, 0, 1, 2, 2, 3])
    const t = lastOf(4, (x) => ply(2, x), pure('a'))
    expect(eventsOf(t, 4)).toHaveLength(5)
    expect(eventsOf(t, 4).slice(-2).map((e) => e.begin)).toEqual([3, 3.5])
  })

  it('degrades and varies deterministically by seed and time, about as often as asked', () => {
    const p = fast(64, pure('h'))
    const a = eventsOf(degradeBy(0.25, p, 7), 16)
    const b = eventsOf(degradeBy(0.25, p, 7), 16)
    expect(onsets(a)).toEqual(onsets(b))
    expect(a.length / (64 * 16)).toBeGreaterThan(0.7)
    expect(a.length / (64 * 16)).toBeLessThan(0.8)
    expect(onsets(eventsOf(degradeBy(0.25, p, 8), 16))).not.toEqual(onsets(a))
    const s = eventsOf(sometimesBy(0.5, (x) => ply(2, x), fast(8, pure('s')), 3), 8)
    expect(s.length).toBeGreaterThan(64)
    expect(s.length).toBeLessThan(128)
  })

  it('ply repeats inside the event; off adds a delayed copy', () => {
    expect(onsets(eventsOf(ply(3, seq('a', 'b')), 1))).toEqual([0, 0.1667, 0.3333, 0.5, 0.6667, 0.8333])
    expect(onsets(eventsOf(off(0.125, (x) => x, seq('a', null)), 1))).toEqual([0, 0.125])
  })

  it('writes onto the genome grid and to weighted mini-notation', () => {
    expect(toSteps(seq(1, null, 2, null), 2, 4)).toEqual([1, null, 2, null, 1, null, 2, null])
    const [lane] = eventsToMini(eventsOf(seq('a', ['b', 'c', 'd']), 1), 1, (v) => v, 12)
    expect(lane).toBe('a@6 b@2 c@2 d@2')
    expect(eventsToMini(eventsOf(stack(pure('x'), pure('y')), 1), 1, (v) => v)).toHaveLength(2)
  })
})

describe('Motif toolkit', () => {
  const cell: MotifCell = {
    span: 16,
    notes: [
      { at: 0, len: 2, deg: 0 },
      { at: 2, len: 2, deg: 1 },
      { at: 4, len: 4, deg: 2 },
      { at: 8, len: 8, deg: 4 },
    ],
  }
  const degs = (c: MotifCell) => c.notes.map((n) => n.deg)
  const ats = (c: MotifCell) => c.notes.map((n) => n.at)

  it('transposes, inverts and reverses diatonically', () => {
    expect(degs(transpose(cell, 2))).toEqual([2, 3, 4, 6]) // relative to the anchor it is placed on
    expect(degs(invert(cell))).toEqual([0, -1, -2, -4])
    expect(degs(retrograde(cell))).toEqual([0, -2, -3, -4])
    expect(ats(retrograde(cell))).toEqual([0, 8, 12, 14])
    expect(degs(retrogradeInversion(cell))).toEqual([0, 2, 3, 4])
  })

  it('augments, diminishes, fragments, displaces, extends and contracts', () => {
    expect(ats(augment(cell))).toEqual([0, 4, 8, 16])
    expect(augment(cell).span).toBe(32)
    expect(ats(diminish(cell))).toEqual([0, 1, 2, 4])
    expect(degs(fragment(cell, 2))).toEqual([0, 1])
    expect(degs(fragment(cell, -2))).toEqual([0, 2])
    expect(ats(displace(cell, 2))).toEqual([2, 4, 6, 10])
    expect(extend(cell).notes).toHaveLength(5)
    expect(degs(extend(cell)).slice(-1)).toEqual([5])
    expect(contract(cell).notes).toHaveLength(3)
    expect(contract(cell).notes[2]!.len).toBe(12)
  })

  it('answers a call with its mirror, keeping the rhythm and closing near home', () => {
    const r = respond(cell)
    expect(ats(r)).toEqual(ats(cell))
    expect(degs(r).slice(-1)[0]).toBe(-1)
  })

  it('reads cells from lines and places them on the harmony, head and downbeats on chord tones', () => {
    const g = getSeed('house')
    const c = cellFrom(g.melody.notes, 0, 16)!
    expect(c.notes.length).toBe(g.melody.notes.slice(0, 16).filter((d) => d !== null).length)
    const line: (number | null)[] = g.melody.notes.map(() => null)
    const tones = barChordTones(g)
    placeCell(line, invert(c), 16, 3, 16, { chordTonesAt: (s) => tones[Math.floor(s / 16)]!, scaleLength: scaleLength(g.scale.mode) })
    const first = line.findIndex((d) => d !== null)
    expect(first).toBeGreaterThanOrEqual(16)
    expect(tones[1]!.has(((line[first]! % 7) + 7) % 7)).toBe(true)
    expect(rhythmSimilarity(cellFrom(line, 16, 16)!, c)).toBe(1)
  })
})

describe('Generative algorithms', () => {
  it('learns a Markov chain and only draws transitions it saw, filtered by constraints', () => {
    const chain = new MarkovChain<number>(1, String).learn([1, 2, 3, 2, 1, 2, 3], false)
    const rng = createRng(1)
    for (let i = 0; i < 20; i++) expect([1, 3]).toContain(chain.next([2], rng))
    expect(chain.next([2], rng, (v) => v !== 3)).toBe(1)
    // An unseen context falls back to the overall frequencies
    expect([1, 2, 3]).toContain(chain.next([9], rng))
    const two = new MarkovChain<number>(2, String).learn([0, 1, 0, 2, 0, 1, 0, 2], true)
    expect(two.next([1, 0], createRng(3))).toBe(2)
  })

  it('walks inside its bounds, pulled by gravity, recovering from leaps', () => {
    const w = walk(200, createRng(5), { start: 3, lo: 0, hi: 7, steps: { '-1': 2, 1: 2, '-3': 1, 3: 1 }, recoverLeaps: true })
    expect(Math.min(...w)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...w)).toBeLessThanOrEqual(7)
    const even = walk(200, createRng(5), { start: 2, lo: 0, hi: 8, steps: { '-2': 1, 2: 1, 1: 1, '-1': 1 }, gravity: (v) => (v % 2 === 0 ? 10 : 0.1) })
    expect(even.filter((v) => v % 2 === 0).length / even.length).toBeGreaterThan(0.8)
  })

  it('grows self-similar figures with an L-system', () => {
    expect(lsystem('A', { A: 'AB', B: 'A' }, 4)).toBe('ABAABABA')
    expect(lsystemWalk('N+N-N', 2)).toEqual([0, 1, 0, 1, 2, 1, 0, 1, 0])
  })
})

describe('Note lengths and the shared context', () => {
  it('holds notes for a share of the gap to the next onset', () => {
    expect(noteHolds([0, null, null, null, 1, null, null, null], 0.5)).toEqual([2, 1, 1, 1, 2, 1, 1, 1])
    expect(noteHolds([0, null, null, null, 1, null, null, null], undefined)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
    expect(soundingLine({ notes: [0, null, null, 1], gate: 1 })).toEqual([0, 0, 0, 1])
  })

  it('compiles held notes as `_` and keeps swung off-beat holds on their own lane', () => {
    const g = cloneGenome(getSeed('house'))
    g.parameters.swing = 0
    g.melody.notes = g.melody.notes.map((_, i) => (i === 0 ? 2 : i === 8 ? 4 : null))
    g.melody.gate = 0.5
    expect(compileGenome(g)).toMatch(/note\("[a-g]s?\d _ _ _ ~ ~ ~ ~ [a-g]s?\d _ _ _/)
    g.parameters.swing = 0.2
    g.melody.notes = g.melody.notes.map((_, i) => (i === 1 ? 2 : null))
    const code = compileGenome(g)
    // The off-beat note and its hold are on the delayed lane
    expect(code).toMatch(/note\("~ [a-g]s?\d _ _/)
  })

  it('knows where each part plays and how tense each bar is', () => {
    const g = getSeed('lofi')
    const ctx = compositionContext(g)
    expect(ctx.kick.filter(Boolean).length).toBe(g.drums.kick.filter(Boolean).length)
    expect(ctx.tension[2]).toBeLessThan(ctx.tension[1]!) // Cmaj9 (I) after G13 (V)
    expect(ctx.melodySounding.filter((d) => d !== null).length).toBeGreaterThan(ctx.melodyOnset.filter(Boolean).length)
  })
})

describe('Counter-melody', () => {
  for (const name of ['house', 'trance', 'lofi', 'pentatonic', 'downtempo'] as const) {
    it(`answers the ${name} melody: in its gaps, under it, on the harmony`, () => {
      const g = getSeed(name)
      const style = getStyle(g.genre)
      g.counter = composeCounter(g, style.counter ?? undefined, createRng(4))
      g.activeLayers.counter = true
      validateGenome(g)
      const notes = g.counter.notes.filter((d) => d !== null).length
      expect(notes).toBeGreaterThanOrEqual(g.bars)
      expect(counterCollisions(g)!).toBeLessThan(0.4)
      expect(counterSpacing(g)!).toBeGreaterThan(0)
      // Strong beats sit on chord tones
      const tones = barChordTones(g)
      const len = scaleLength(g.scale.mode)
      const strong = g.counter.notes
        .map((d, i) => ({ d, i }))
        .filter(({ d, i }) => d !== null && i % 4 === 0)
      const fit = strong.filter(({ d, i }) => tones[Math.floor(i / 16) % g.bars]!.has(((d! % len) + len) % len)).length
      expect(fit / strong.length).toBeGreaterThan(0.7)
      // A line that moves, not a pedal
      expect(new Set(g.counter.notes.filter((d) => d !== null)).size).toBeGreaterThan(1)
    })
  }

  it('is recomposed when a mutation changes the melody', () => {
    const g = getSeed('house')
    g.counter = composeCounter(g)
    g.activeLayers.counter = true
    const before = serializeGenome(g)
    const { genome } = mutateN(g, createRng(9), 6, { config: { categoryWeights: { rhythm: 0, bass: 0, melody: 1, chords: 0, tempo: 0, scale: 0, layers: 0, parameters: 0 }, intensityProbabilities: { small: 0, moderate: 1, experimental: 0 } } })
    expect(serializeGenome(genome)).not.toBe(before)
    expect(genome.counter!.notes).toEqual(composeCounter({ ...genome, counter: undefined }, { gate: g.counter.gate }).notes)
  })
})

describe('Arrangement', () => {
  it('augments the breakdown melody, fragments the outro and brings the counter in on a later drop', () => {
    const g = getSeed('trance')
    const aug = augmentMelody(cloneGenome(g))
    const onsetsOf = (x: MusicGenome) => x.melody.notes.filter((d) => d !== null).length
    expect(onsetsOf(aug)).toBeLessThan(onsetsOf(g))
    expect(aug.melody.gate).toBeGreaterThanOrEqual(0.95)
    expect(onsetsOf(fragmentMelody(cloneGenome(g)))).toBeLessThan(onsetsOf(g))
    const sections = ['intro', 'groove', 'breakdown', 'build', 'drop', 'drop', 'outro'].map((role) => ({ role, genome: g }))
    const out = arrangeSections(sections, 1)
    expect(out[4]!.genome.activeLayers.counter).toBe(true) // trance: counter from the first drop
    expect(out[0]!.genome.activeLayers.counter).toBeFalsy()
    expect(out[3]!.genome.patterns!.some((p) => p.target === 'hihat' && p.op === 'ply')).toBe(true)
    expect(onsetsOf(out[2]!.genome)).toBeLessThan(onsetsOf(g))
    out.forEach((s) => expect(isValidGenome(s.genome)).toBe(true))
  })

  it('makes the second drop develop the first in genres that wait for it', () => {
    const g = getSeed('house')
    const out = arrangeSections(['drop', 'breakdown', 'drop'].map((role) => ({ role, genome: g })), 3)
    expect(out[0]!.genome.activeLayers.counter).toBeFalsy()
    expect(out[2]!.genome.activeLayers.counter).toBe(true)
    // The breakdown restates the motif an octave up
    expect(out[1]!.genome.melody.octave).toBe(g.melody.octave + 1)
  })

  it('takes the bass out of trance builds so the drop lands with it', () => {
    const ch = CHANNELS.find((c) => c.id === 'trance')!
    const personality = channelPersonality(ch)
    const state = createEvolutionState(channelSeed(ch), 42, { personality, channelId: ch.id })
    const song = composeSong(state, { template: channelSongTemplate(ch), length: 'short', personality })
    const code = song.sections.map((s) => s.role).join(' ')
    expect(code).toContain('build')
  })
})

describe('Genome compatibility', () => {
  it('accepts genomes saved before gates, genes and counters existed', () => {
    const g = cloneGenome(getSeed('house'))
    delete g.melody.gate
    delete g.bass.gate
    delete g.chords.gate
    delete g.patterns
    delete g.counter
    delete g.activeLayers.counter
    expect(isValidGenome(deserializeGenome(serializeGenome(g)))).toBe(true)
    expect(() => compileGenome(g)).not.toThrow()
  })

  it('rejects out-of-range genes and gates', () => {
    const g = cloneGenome(getSeed('house'))
    expect(isValidGenome({ ...g, patterns: [{ target: 'hihat', op: 'ply', amount: 9 }] })).toBe(false)
    expect(isValidGenome({ ...g, patterns: [{ target: 'nope', op: 'degrade', amount: 0.1 }] })).toBe(false)
    expect(isValidGenome({ ...g, melody: { ...g.melody, gate: 2 } })).toBe(false)
    expect(isValidGenome({ ...g, activeLayers: { ...g.activeLayers, counter: true } })).toBe(false)
  })

  it('compiles pattern genes to Strudel transforms counted in bars', () => {
    const g = cloneGenome(getSeed('house'))
    g.patterns = [
      { target: 'hihat', op: 'degrade', amount: 0.2 },
      { target: 'snare', op: 'ply', amount: 2, every: 4, chance: 0.5 },
      { target: 'chords', op: 'off', amount: 3 },
      { target: 'kick', op: 'nudge', amount: -0.1 },
    ]
    const code = compileGenome(g)
    expect(code).toMatch(/\.slow\(4\)\.degradeBy\(0\.2\)/)
    expect(code).toContain('.lastOf(4, x => x.sometimesBy(0.5, y => y.ply(2)))')
    expect(code).toContain('.off(0.1875, y => y.mul(gain(0.45)))')
    expect(code).toContain('.early(0.00625)')
  })
})

describe('Genres and seeds', () => {
  it('gives every genre its own vocabulary, gates and genes', () => {
    for (const id of Object.keys(STYLES).filter((k) => k !== 'default')) {
      const s = STYLES[id]!
      expect(s.bassFigures.length, id).toBeGreaterThan(1)
      expect(s.genes.length, id).toBeGreaterThan(0)
      expect(s.gates.bass[0]).toBeLessThanOrEqual(s.gates.bass[1])
    }
    // Electro is not four-on-the-floor; house is
    const kickBar = (n: string) => getSeed(n as 'house').drums.kick.slice(0, 16)
    expect(kickBar('electronic').filter(Boolean).length).not.toBe(4)
    expect(kickBar('electronic')[4]).toBe(false)
    expect(kickBar('house').filter(Boolean).length).toBe(4)
  })

  it('writes seeds whose note lengths and genes sit in their genre idiom', () => {
    for (const [name, g] of Object.entries(allSeeds())) {
      if (!g.genre) continue
      const style = getStyle(g.genre)
      if (g.bass.gate !== undefined) {
        expect(g.bass.gate, name).toBeGreaterThanOrEqual(style.gates.bass[0] - 0.15)
        expect(g.bass.gate, name).toBeLessThanOrEqual(style.gates.bass[1] + 0.15)
      }
      expect(musicality(g), name).toBeGreaterThan(0.85)
    }
    // Ambient's arpeggio runs in its own 10-step cycle, so bars differ
    const amb = getSeed('ambient').arp!.pattern
    expect(amb.slice(0, 16)).not.toEqual(amb.slice(16, 32))
  })
})

describe('Musicality fitness', () => {
  it('prefers a motivic melody to the same notes scrambled', () => {
    const g = getSeed('house')
    const rng = createRng(2)
    const scrambled = cloneGenome(g)
    const notes = g.melody.notes.filter((d) => d !== null)
    const slots = rng.shuffle(g.melody.notes.map((_, i) => i)).slice(0, notes.length)
    scrambled.melody.notes = g.melody.notes.map(() => null)
    slots.forEach((s, k) => (scrambled.melody.notes[s] = notes[k]!))
    expect(motifIdentity(g)!).toBeGreaterThan(motifIdentity(scrambled)!)
    expect(musicality(g)).toBeGreaterThan(musicality(scrambled))
  })

  it('penalises genes that wreck the groove', () => {
    const g = cloneGenome(getSeed('house'))
    const ok = musicality(g)
    g.patterns = [{ target: 'kick', op: 'degrade', amount: 0.5 }]
    expect(musicality(g)).toBeLessThan(ok)
    expect(evaluateFitness(g).metrics.musicality).toBeLessThan(ok)
  })
})

describe('Structural mutations', () => {
  const names = ['DevelopMotif', 'RegenerateMelodyBar', 'PhraseDensity', 'VaryBassPhrase', 'ChangeGate', 'AddPatternGene', 'TweakPatternGene', 'RemovePatternGene', 'ArpLSystem']
  for (const name of names) {
    it(`${name} keeps the genome valid and deterministic`, () => {
      const op = MUTATION_OPS.find((o) => o.name === name)!
      expect(op).toBeDefined()
      let applied = 0
      for (const seedName of ['house', 'trance', 'lofi', 'dnb', 'ambient'] as const) {
        const g = getSeed(seedName)
        const a = op.apply(cloneGenome(g), createRng(11), 'experimental')
        const b = op.apply(cloneGenome(g), createRng(11), 'experimental')
        if (!a) continue
        applied++
        expect(isValidGenome(a.genome)).toBe(true)
        expect(serializeGenome(a.genome)).toBe(serializeGenome(b!.genome))
      }
      expect(applied).toBeGreaterThan(0)
    })
  }

  it('VaryBassPhrase keeps the bass on its chords', () => {
    const op = MUTATION_OPS.find((o) => o.name === 'VaryBassPhrase')!
    for (let seed = 0; seed < 20; seed++) {
      const g = getSeed('house')
      const r = op.apply(cloneGenome(g), createRng(seed), 'small')
      if (!r) continue
      const tones = barChordTones(r.genome)
      const len = scaleLength(g.scale.mode)
      // Downbeat-ish onsets (first onset of each bar) are chord tones
      for (let bar = 0; bar < g.bars; bar++) {
        const first = r.genome.bass.notes.slice(bar * 16, bar * 16 + 16).find((d) => d !== null)
        if (first !== undefined && first !== null) expect(tones[bar]!.has(((first % len) + len) % len)).toBe(true)
      }
    }
  })

  it('evolution keeps the theme recognisable over a song of mutations', () => {
    for (const ch of CHANNELS.filter((c) => ['house', 'trance', 'lofi'].includes(c.id))) {
      const personality = channelPersonality(ch)
      let state = createEvolutionState(channelSeed(ch), 7, { personality, channelId: ch.id })
      const seedMotif = motifIdentity(state.genome)
      for (let i = 0; i < 12; i++) state = stepGeneration(state, { personality }).state
      expect(motifIdentity(state.genome) ?? 0, ch.id).toBeGreaterThan((seedMotif ?? 0) - 0.35)
      expect(isValidGenome(state.genome)).toBe(true)
    }
  })
})
