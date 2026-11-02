import { describe, expect, it } from 'vitest'
import { analyseAudio, estimateKey, estimateTempo, frameFeatures, loudness } from '../src/analysis/audio'
import { detectFlags } from '../src/analysis/flags'
import { analyseSong, noteToMidi, type PlayedEvent } from '../src/analysis/symbolic'
import { GROOVE_REFERENCE } from '../src/music/groove-reference'
import {
  bassKickDynamics,
  drumNudges,
  drumVelocities,
  lineDynamics,
  performanceSeed,
  phraseGhosts,
  phrasePickups,
  type PerformanceProfile,
} from '../src/music/performance'
import { getSeed } from '../src/music/seeds'
import { getStyle } from '../src/music/styles'
import { compileTimeline, type ScheduledSong } from '../src/strudel/compiler'

const LOFI: PerformanceProfile = { reference: 'hiphop', timing: 1, jitterMs: 4, velocity: 0.8, phrase: 1, ghosts: true, expression: 1 }

describe('groove reference (Groove MIDI Dataset statistics)', () => {
  it('has 16 positions per instrument and the measured phrase shape', () => {
    const all = GROOVE_REFERENCE.all!
    for (const inst of [all.kick, all.snare, all.hat]) {
      expect(inst.offset).toHaveLength(16)
      expect(inst.velocity).toHaveLength(16)
    }
    // The fourth bar of a phrase is the loudest and the most varied
    expect(Math.max(...all.phraseVelocity)).toBe(all.phraseVelocity[3])
    expect(Math.max(...all.phraseDistance)).toBe(all.phraseDistance[3])
    // Off-beat 16th hats sit later than on-beat ones
    expect(all.hat.offset[1]!).toBeGreaterThan(all.hat.offset[0]!)
  })
})

describe('performance layer', () => {
  const steps = Array.from({ length: 64 }, (_, i) => i % 2 === 0)

  it('is deterministic for a genome and neutral without a profile', () => {
    const seed = performanceSeed(getSeed('lofi'))
    expect(drumVelocities(LOFI, 'hihat', steps, 16, seed)).toEqual(drumVelocities(LOFI, 'hihat', steps, 16, seed))
    expect(drumVelocities(undefined, 'hihat', steps, 16, seed).every((v) => v === 1)).toBe(true)
    expect(drumNudges(undefined, 'hihat', steps, 16, 90, seed).every((v) => v === 0)).toBe(true)
  })

  it('varies velocity hit to hit and lifts the last bar of a phrase', () => {
    const v = drumVelocities(LOFI, 'hihat', steps, 16, 7)
    const played = v.filter((_, i) => steps[i])
    expect(new Set(played.map((x) => x.toFixed(3))).size).toBeGreaterThan(10)
    const barMean = (b: number) => played.slice(b * 8, b * 8 + 8).reduce((a, x) => a + x, 0) / 8
    expect(barMean(3)).toBeGreaterThan(barMean(1))
  })

  it('keeps micro-timing small and systematic (off-beat hats later than on-beat)', () => {
    const n = drumNudges({ ...LOFI, jitterMs: 0 }, 'hihat', Array(16).fill(true), 16, 90, 1)
    expect(Math.max(...n.map(Math.abs))).toBeLessThan(0.026)
    expect(n[1]!).toBeGreaterThan(n[0]!)
  })

  it('adds one phrase-end pickup per four bars where nothing plays', () => {
    const snare = Array(64).fill(false)
    const kick = Array(64).fill(false)
    const out = phraseGhosts(LOFI, snare, kick, 16, 4)
    expect(out.filter(Boolean)).toHaveLength(1)
    expect(out[63]).toBe(true)
    // Taken: falls back to the 16th before beat 3
    const busy = phrasePickups(out, kick, 16, 4)
    expect(busy[55]).toBe(true)
    // Two-bar loops have no phrase end to mark
    expect(phraseGhosts(LOFI, Array(32).fill(false), Array(32).fill(false), 16, 2).some(Boolean)).toBe(false)
  })

  it('shapes lines: downbeats and high notes lean in, phrase ends relax', () => {
    const notes: (number | null)[] = [0, null, null, null, 2, null, 4, null, 7, null, null, null, null, null, null, null]
    const d = lineDynamics(notes, 0.5, 16, 1)
    expect(d[0]!).toBeGreaterThan(d[6]!)
    expect(d[8]!).toBeLessThan(1.1)
    expect(Math.max(...d)).toBeLessThan(1.25)
    expect(Math.min(...d)).toBeGreaterThan(0.8)
  })

  it('ducks the bass in the kick shadow for avoid genres and punches with it for lock genres', () => {
    const kick = Array(16).fill(false)
    kick[0] = kick[8] = true
    const bass: (number | null)[] = Array(16).fill(null)
    bass[0] = bass[1] = bass[6] = 0
    const avoid = bassKickDynamics(bass, kick, 'avoid', 16, 1)
    expect(avoid[1]!).toBeLessThan(avoid[6]!)
    const lock = bassKickDynamics(bass, kick, 'lock', 16, 1)
    expect(lock[0]!).toBeGreaterThan(lock[6]!)
  })

  it('compiles with velocity and nudge patterns, and depth 0 reproduces the old code', () => {
    const g = getSeed('lofi')
    const song: ScheduledSong = { startCycle: 0, sections: [{ role: 'verse', bars: 8, energy: 0.8, genome: g }] }
    const on = compileTimeline([song], g.tempo)
    const off = compileTimeline([song], g.tempo, undefined, undefined, { performance: 0 })
    expect(on).toContain('.nudge("')
    expect(off).not.toContain('.nudge(')
    expect(compileTimeline([song], g.tempo)).toBe(on)
    expect(getStyle('lofi').performance).toBeDefined()
  })
})

describe('symbolic analysis', () => {
  it('reads Strudel note names', () => {
    expect(noteToMidi('c4')).toBe(60)
    expect(noteToMidi('cs4')).toBe(61)
    expect(noteToMidi('eb3')).toBe(51)
    expect(noteToMidi(null)).toBeNull()
  })

  const ev = (t: number, layer: string, note: string | null = null, gain = 1): PlayedEvent => ({ t, d: 1 / 16, layer, s: null, sound: null, note, gain, velocity: 1, nudge: 0 })

  it('sees a fixed drum loop as static and machine-flat', () => {
    const events: PlayedEvent[] = []
    for (let b = 0; b < 8; b++) for (const p of [0, 4, 8, 12]) events.push(ev(b + p / 16, 'kick'), ev(b + (p + 2) / 16, 'hihat'))
    const a = analyseSong(events, [{ role: 'groove', bars: 8 }], 120)
    expect(a.sections[0]!.drums!.distinctPer8).toBe(1)
    expect(a.sections[0]!.drums!.velocitySpread).toBe(0)
    expect(a.sections[0]!.drums!.grooveConsistency).toBe(1)
    const flags = detectFlags('house', a, null).map((f) => f.id)
    expect(flags).toContain('static-drums')
    expect(flags).toContain('machine-velocity')
  })

  it('separates repeated, developed and unrelated melody bars', () => {
    const events: PlayedEvent[] = []
    const motif = ['c4', 'd4', 'e4', 'g4']
    for (let b = 0; b < 4; b++) motif.forEach((n, i) => events.push(ev(b + i / 4, 'melody', n)))
    // A variant: same rhythm, last interval changed
    ;['c4', 'd4', 'e4', 'a4'].forEach((n, i) => events.push(ev(4 + i / 4, 'melody', n)))
    const a = analyseSong(events, [{ role: 'verse', bars: 5 }], 100)
    expect(a.song.melodyBars.distinct).toBe(2)
    expect(a.song.melodyBars.varied).toBe(1)
  })
})

describe('audio analysis', () => {
  const sr = 22050
  /** Clicks on every beat at `bpm`, a decaying 440 Hz blip. */
  function clicks(bpm: number, seconds: number): Float32Array {
    const x = new Float32Array(sr * seconds)
    const period = (60 / bpm) * sr
    for (let s = 0; s < x.length; s += period) {
      for (let i = 0; i < 2000 && s + i < x.length; i++) x[Math.floor(s) + i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr) * Math.exp(-i / 300)
    }
    return x
  }

  it('finds the tempo of a click track', () => {
    const { hop, frames } = frameFeatures(clicks(120, 20), sr)
    const t = estimateTempo(frames.map((f) => f.flux), hop / sr)
    expect(Math.abs(t.bpm - 120)).toBeLessThan(3)
  })

  it('measures loudness of a full-scale sine near −3 LUFS and a quieter one 20 LU lower', () => {
    const sine = (a: number) => Float32Array.from({ length: sr * 5 }, (_, i) => a * Math.sin((2 * Math.PI * 1000 * i) / sr))
    const loud = loudness(sine(1), sr).integrated
    expect(Math.abs(loud - -3)).toBeLessThan(1)
    expect(Math.abs(loudness(sine(0.1), sr).integrated - (loud - 20))).toBeLessThan(0.5)
  })

  it('names the key of an A minor chroma', () => {
    const chroma = Array(12).fill(0.02)
    for (const pc of [9, 0, 4]) chroma[pc] = 0.3
    expect(estimateKey(chroma)).toMatchObject({ key: 'A', mode: 'minor' })
  })

  it('analyses sections of a recording', () => {
    const a = analyseAudio(clicks(120, 16), sr, { tempo: 120, sections: [{ role: 'a', bars: 4 }, { role: 'b', bars: 4 }] })
    expect(a.sections).toHaveLength(2)
    expect(a.sections[0]!.onsetsPerSecond).toBeGreaterThan(1.5)
    expect(a.tempo.error).not.toBeNull()
  })
})
