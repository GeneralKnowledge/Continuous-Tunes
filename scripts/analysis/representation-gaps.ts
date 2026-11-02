#!/usr/bin/env tsx
/**
 * Concrete checks of what the genome's fixed grid keeps and loses between the pattern engine and
 * the audio (see docs/research/musical-quality-audit.md, "Representation gap analysis").
 * Usage: npx tsx scripts/analysis/representation-gaps.ts
 */
import { euclid, eventsOf, eventsToMini, fromSteps, onGrid, seq, slow, toHolds, toSteps } from '../../src/music/pattern'
import { noteHolds } from '../../src/music/context'
import { getSeed } from '../../src/music/seeds'
import { augmentMelody } from '../../src/music/arrange'
import { cloneGenome } from '../../src/music/genome'

const out: string[] = []
const say = (s: string) => out.push(s)

// 1. A triplet figure: three notes across two beats (a common lo-fi / folk hi-hat or melody idea)
{
  const p = seq<number | null>(0, [1, 2, 3], null, 4)
  const evs = eventsOf(p, 1)
  const steps = toSteps(p, 1, 16)
  const back = eventsOf(fromSteps(steps, 16), 1)
  say(`1. Triplet: pattern onsets ${evs.map((e) => e.begin.toFixed(3)).join(', ')}`)
  say(`   on the 16-step grid → ${back.map((e) => e.begin.toFixed(3)).join(', ')} (on grid before: ${onGrid(evs, 16)}; exact mini-notation exists: "${eventsToMini(evs, 1, (v) => String(v))[0]}", but the compiler never uses it)`)
}

// 2. A 5-against-4 polyrhythm (5 evenly spaced hits per bar)
{
  const p = euclid(true, 5, 5)
  const evs = eventsOf(p, 1)
  const grid = toSteps(p, 1, 16).map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
  const err = evs.map((e, k) => Math.abs(e.begin * 16 - grid[k]!) * (60 / 120 / 4) * 1000)
  say(`2. Quintuplets: exact 16th positions ${evs.map((e) => (e.begin * 16).toFixed(2)).join(', ')}; grid ${grid.join(', ')}; up to ${Math.max(...err).toFixed(0)} ms off at 120 BPM`)
}

// 3. A phasing figure in its own 10-step cycle inside a 4-bar (64-step) loop
{
  const p = slow(10 / 16, euclid(true, 3, 10))
  const inLoop = toSteps(p, 4, 16).map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
  const next = eventsOf(p, 4, 4).map((e) => Math.round((e.begin - 4) * 16))
  say(`3. 10-step cycle in a 64-step loop: loop 1 onsets ${inLoop.join(' ')}; the real cycle would continue ${next.slice(0, 6).join(' ')}…; the loop restarts at ${inLoop.slice(0, 6).join(' ')}… so the figure's phase resets every 64 steps instead of drifting until the two cycles meet after 320 steps (20 bars)`)
}

// 4. Durations: one gate per layer
{
  const notes = [0, null, null, null, 2, null, 4, null, 7, null, null, null, null, null, null, null]
  say(`4. Gate 0.5 gives holds ${noteHolds(notes, 0.5).filter((_, i) => notes[i] !== null).join(', ')} steps; a legato phrase with one staccato note is not representable (one gate per layer), and toHolds()'s per-event lengths ${JSON.stringify(toHolds(seq(0, null, 1, 2), 1, 16).filter((h, i) => [0, 8, 12].includes(i)))} are dropped by toSteps`)
}

// 5. Velocity and timing on drums
{
  const g = getSeed('house')
  say(`5. Drums are booleans (${g.drums.kick.length} steps each); velocity comes from the genre's per-position accent map, identical every bar; timing from one per-layer feel value and the global swing. A single accented hit, a crescendo, or a flam cannot be written in the genome.`)
}

// 6. Augmentation drops every second bar's phrase
{
  const g = cloneGenome(getSeed('house'))
  const before = g.melody.notes.filter((n) => n !== null).length
  const a = augmentMelody(cloneGenome(g))
  const after = a.melody.notes.filter((n) => n !== null).length
  say(`6. augmentMelody on the house theme: ${before} notes → ${after}; each pair of bars keeps only the first bar's phrase, stretched (bars 2 and 4 of the motif are not heard in breakdowns)`)
}

// 7. Chords: one root per bar
{
  const g = getSeed('pentatonic')
  say(`7. Chord progression has ${g.chords.progression.length} slots for ${g.bars} bars: two chords in a bar (a turnaround, a passing chord) cannot be written.`)
}
console.log(out.join('\n'))
