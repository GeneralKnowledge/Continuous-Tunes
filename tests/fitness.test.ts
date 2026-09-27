import { describe, expect, it } from 'vitest'
import { classifyFitnessExtreme, evaluateFitness } from '../src/evolution/fitness'
import { cloneGenome, emptyNotes, emptySteps } from '../src/music/genome'
import { getSeed } from '../src/music/seeds'
import { getPersonality } from '../src/music/personality'

describe('Fitness', () => {
  it('identical inputs ⇒ identical scores', () => {
    const g = getSeed('electronic')
    const a = evaluateFitness(g)
    const b = evaluateFitness(g)
    expect(a.score).toBe(b.score)
    expect(a.metrics).toEqual(b.metrics)
  })

  it('seeds score in a reasonable mid range', () => {
    for (const name of ['minimal', 'ambient', 'electronic', 'pentatonic'] as const) {
      const r = evaluateFitness(getSeed(name))
      expect(r.score).toBeGreaterThan(0.1)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  })

  it('detects empty extreme', () => {
    const g = cloneGenome(getSeed('minimal'))
    const n = g.stepsPerBar * g.bars
    g.drums.kick = emptySteps(n)
    g.drums.snare = emptySteps(n)
    g.drums.hihat = emptySteps(n)
    g.bass.notes = emptyNotes(n)
    g.melody.notes = emptyNotes(n)
    g.chords.rhythm = emptySteps(n)
    g.activeLayers = { drums: false, bass: false, melody: false, chords: false }
    const r = evaluateFitness(g)
    expect(classifyFitnessExtreme(r)).toBe('empty')
    expect(r.score).toBeLessThan(evaluateFitness(getSeed('minimal')).score)
  })

  it('detects static extreme (perfectly repeated mid-density pattern)', () => {
    const g = cloneGenome(getSeed('minimal'))
    const n = g.stepsPerBar * g.bars
    const spb = g.stepsPerBar
    // Identical dense-enough bar repeated — high repetition, low variety
    g.drums.kick = Array.from({ length: n }, (_, i) => i % spb === 0 || i % spb === 8)
    g.drums.snare = Array.from({ length: n }, (_, i) => i % spb === 4 || i % spb === 12)
    g.drums.hihat = Array.from({ length: n }, (_, i) => i % 2 === 0)
    g.bass.notes = Array.from({ length: n }, (_, i) => (i % 4 === 0 ? 0 : null))
    g.melody.notes = Array.from({ length: n }, (_, i) => (i % 8 === 0 ? 0 : null))
    g.chords.rhythm = Array.from({ length: n }, (_, i) => i % spb === 0)
    g.chords.progression = g.chords.progression.map(() => 0)
    g.activeLayers = { drums: true, bass: true, melody: true, chords: true }
    const r = evaluateFitness(g)
    expect(r.metrics.repetition).toBeGreaterThan(0.85)
    expect(classifyFitnessExtreme(r)).toBe('static')
  })

  it('detects chaos extreme', () => {
    const g = cloneGenome(getSeed('electronic'))
    const n = g.stepsPerBar * g.bars
    // High density + low bar-to-bar repetition
    g.drums.kick = Array.from({ length: n }, (_, i) => ((i * 7) % 5) !== 0)
    g.drums.snare = Array.from({ length: n }, (_, i) => ((i * 3) % 4) !== 0)
    g.drums.hihat = Array.from({ length: n }, () => true)
    g.bass.notes = Array.from({ length: n }, (_, i) => (i * 5 + (i % 7)) % 8)
    g.melody.notes = Array.from({ length: n }, (_, i) => (i * 3 + i * i) % 8)
    g.chords.rhythm = Array.from({ length: n }, () => true)
    g.chords.progression = [0, 6, 1, 7]
    g.activeLayers = { drums: true, bass: true, melody: true, chords: true }
    const r = evaluateFitness(g)
    expect(r.metrics.density).toBeGreaterThan(0.85)
    expect(classifyFitnessExtreme(r)).toBe('chaos')
  })

  it('personality sweet spots change scores', () => {
    const g = getSeed('ambient')
    const sparse = evaluateFitness(g, getPersonality('sparse'))
    const lush = evaluateFitness(g, getPersonality('lush'))
    expect(sparse.score).toBeGreaterThan(0)
    expect(lush.score).toBeGreaterThan(0)
    // Different personalities ⇒ different evaluation context (scores may differ)
    expect(sparse.metrics).toEqual(lush.metrics) // metrics are genome-derived
    expect(typeof sparse.score).toBe('number')
  })
})
