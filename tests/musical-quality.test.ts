import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findParallels, detectKey } from 'musictheoryjs'
import { contrastFrom } from '../src/evolution/contrast'
import { evaluateFitness } from '../src/evolution/fitness'
import { MUTATION_OPS, mutate } from '../src/evolution/mutation'
import { createRng } from '../src/lib/rng'
import { CHANNELS, channelPersonality, channelSeed, channelSeedNames } from '../src/music/channels'
import {
  bassKickOverlap,
  composeBass,
  composeMelody,
  dodgeKick,
  extractMotif,
  onBeat,
  rebaseLine,
} from '../src/music/compose'
import { applyChannelFingerprint } from '../src/music/fingerprint'
import { cloneGenome, type MusicGenome } from '../src/music/genome'
import { barChords, barChordTones, chordOn, chordVoicings } from '../src/music/harmony'
import { KITS } from '../src/music/kits'
import { allSeeds, getSeed, SEED_NAMES } from '../src/music/seeds'
import { getStyle, STYLES } from '../src/music/styles'
import {
  arpIndices,
  chordPcs,
  chordSymbol,
  degreePc,
  degreeToMidi,
  detectChord,
  euclid,
  invertDegrees,
  scaleLength,
  sequenceDegrees,
  voiceLead,
} from '../src/music/theory'
import { validateGenome } from '../src/music/validation'
import { compileGenome, compileTimeline, renderForSection, sectionTransition } from '../src/strudel/compiler'

const mod = (n: number, m: number) => ((n % m) + m) % m
const midiName = (m: number) => `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12]}${Math.floor(m / 12) - 1}`

describe('Tonal integration', () => {
  it('reads triad and seventh voicings back as their chords (Tonal detection)', () => {
    expect(detectChord([65, 68, 72, 75])).toContain('Fm7')
    const g = getSeed('trance')
    expect(detectChord(chordVoicings(g)[0]!)[0]).toMatch(/^Am/)
  })

  it('maps scale degrees to the same pitches as before (scales ascend through octaves)', () => {
    const a = { root: 9, mode: 'major' as const }
    expect([0, 1, 2, 3, 7].map((d) => degreeToMidi(a, d, 4))).toEqual([69, 71, 73, 74, 81])
    expect(degreeToMidi({ root: 0, mode: 'pentatonic' }, 5, 4)).toBe(72)
    expect(degreeToMidi({ root: 0, mode: 'minor' }, -1, 4)).toBe(58)
  })

  it('harmonises each mode from Tonal, in the genre language', () => {
    const house = { scale: { root: 5, mode: 'dorian' as const }, genre: 'house' }
    expect([0, 3, 6, 4].map((d) => chordSymbol(chordOn(house, d, 'seventh')))).toEqual(['Fm9', 'A#9', 'D#maj9', 'Cm9'])
    const trance = { scale: { root: 9, mode: 'minor' as const }, genre: 'trance' }
    expect([0, 5, 2, 6].map((d) => chordSymbol(chordOn(trance, d, 'triad')))).toEqual(['Am', 'F', 'C', 'G'])
    // No genre: the original diatonic sevenths
    expect(chordSymbol(chordOn({ scale: { root: 0, mode: 'major' } }, 4, 'seventh'))).toBe('G7')
  })

  it('falls back to a plainer chord when a colour would leave the key', () => {
    // E minor 9 needs F#: not in C major, so iii stays a minor seventh in lo-fi
    const c = chordOn({ scale: { root: 0, mode: 'major' }, genre: 'lofi' }, 2, 'seventh')
    expect(chordSymbol(c)).toBe('Em7')
  })

  it('keeps every genre chord inside its key unless a colour was asked for', () => {
    for (const [name, g] of Object.entries(allSeeds())) {
      const pcs = new Set(Array.from({ length: 7 }, (_, d) => degreePc(g.scale.mode === 'pentatonic' ? { ...g.scale, mode: 'major' } : g.scale, d)))
      barChords(g).forEach((c, bar) => {
        if (g.chords.colors?.[bar]) return
        const notes = chordVoicings(g)[bar]!
        for (const m of notes) expect(pcs.has(m % 12), `${name} bar ${bar}`).toBe(true)
        // The voicing plays only the chord's tones, and at least three of them
        const chordSet = new Set(chordPcs(c))
        for (const m of notes) expect(chordSet.has(m % 12), `${name} bar ${bar}`).toBe(true)
        expect(new Set(notes.map((m) => m % 12)).size).toBeGreaterThanOrEqual(c.type === '5' ? 2 : 3)
        expect(c.root).toBe(degreePc(g.scale, c.degree))
      })
    }
  })
})

describe('MusicTheoryJS integration', () => {
  it('voice-leads chords smoothly without parallel fifths or octaves', () => {
    const chords = [0, 3, 6, 4].map((d) => chordOn({ scale: { root: 5, mode: 'dorian' }, genre: 'house' }, d, 'seventh'))
    const v = voiceLead(chords, { kind: 'rootless', range: [55, 76], maxTones: 4 })
    for (let i = 1; i < v.length; i++) {
      const a = v[i - 1]!
      const b = v[i]!
      // Each voice moves a few semitones at most
      if (a.length === b.length) {
        const motion = a.reduce((s, m, k) => s + Math.abs(m - b[k]!), 0)
        expect(motion).toBeLessThanOrEqual(10)
        expect(findParallels(a.map(midiName), b.map(midiName))).toEqual([])
      }
      for (const m of b) expect(m >= 55 && m <= 76).toBe(true)
    }
  })

  it('builds Euclidean rhythms and arpeggio contours', () => {
    expect(euclid(3, 8).map(Number)).toEqual([1, 0, 0, 1, 0, 0, 1, 0])
    expect(euclid(5, 16).filter(Boolean).length).toBe(5)
    expect(arpIndices('updown', 3, 1, 6)).toEqual([0, 1, 2, 1, 0, 1])
    expect(arpIndices('up', 4, 2, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('transforms motifs diatonically: inversion mirrors, sequence moves through the scale', () => {
    const c = { root: 0, mode: 'major' as const }
    expect(invertDegrees(c, [0, 2, null, 4], 2)).toEqual([4, 2, null, 0])
    expect(sequenceDegrees(c, [0, 2, null, 4], 1)).toEqual([1, 3, null, 5])
    expect(sequenceDegrees(c, [0, 1], -1)).toEqual([-1, 0])
  })

  it('agrees on the key of every seed (Krumhansl–Schmuckler over the bass, chords and melody)', () => {
    for (const ch of CHANNELS) {
      const g = channelSeed(ch)
      const notes: string[] = []
      chordVoicings(g).forEach((v) => notes.push(...v.map(midiName)))
      for (const d of [...g.bass.notes, ...g.melody.notes]) if (d !== null) notes.push(midiName(degreeToMidi(g.scale, d, 4)))
      const ranked = detectKey(notes).slice(0, 4).map((k) => k.key.tonic.pitchClass)
      // The tonic (or, for modes, the relative major / minor the profile prefers) is near the top
      const tonics = new Set([degreePc(g.scale, 0), ...[2, 3, 5].map((d) => degreePc(g.scale, d))])
      expect(ranked.some((pc) => tonics.has(pc)), ch.id).toBe(true)
    }
  })
})

describe('Bass generation', () => {
  const house = getSeed('house')

  it('follows the chord roots on the first note of each bar', () => {
    for (const g of [getSeed('lofi'), getSeed('dnb'), getSeed('downtempo')]) {
      for (let bar = 0; bar < g.bars; bar++) {
        const first = g.bass.notes.slice(bar * 16, bar * 16 + 16).find((d) => d !== null)!
        expect(mod(first, scaleLength(g.scale.mode))).toBe(g.chords.progression[bar])
      }
    }
  })

  it('steps into the next chord with an approach note', () => {
    const g = cloneGenome(house)
    const notes = composeBass(g, ['R--------------A'])
    for (let bar = 0; bar < g.bars; bar++) {
      const approach = notes[bar * 16 + 15]!
      const next = g.chords.progression[(bar + 1) % g.bars]!
      const len = scaleLength(g.scale.mode)
      expect([1, len - 1]).toContain(mod(approach - next, len))
    }
  })

  it('stays out of the kick in house and trance, and lands on it in drum & bass and lo-fi', () => {
    for (const name of ['house', 'house-2', 'trance', 'trance-2'] as const) {
      const g = getSeed(name)
      expect(bassKickOverlap(g.bass.notes, g.drums.kick), name).toBe(0)
    }
    for (const name of ['dnb', 'lofi'] as const) {
      const g = getSeed(name)
      expect(bassKickOverlap(g.bass.notes, g.drums.kick)!, name).toBeGreaterThan(0.3)
    }
    expect(dodgeKick([0, null, null, 4], [true, false, false, true], 4)).toEqual([null, 0, null, null])
  })

  it('moves with a new progression, keeping each note’s role in its chord', () => {
    const g = cloneGenome(house)
    const to = [3, 0, 4, 6]
    const moved = rebaseLine(g, g.bass.notes, g.chords.progression, to)
    for (let bar = 0; bar < 4; bar++) {
      const first = moved.slice(bar * 16, bar * 16 + 16).find((d) => d !== null)!
      const orig = g.bass.notes.slice(bar * 16, bar * 16 + 16).find((d) => d !== null)!
      expect(first - orig).toBe(to[bar]! - g.chords.progression[bar]!)
    }
  })
})

describe('Melody generation', () => {
  it('builds phrases from a motif and lands strong beats on chord tones', () => {
    const g = getSeed('trance')
    const melody = composeMelody(g, { rhythm: 'x--x--x-x--x--x-', shape: [0, 2, 1, 0, -1, 0] }, ['statement', 'answer', 'sequence', 'cadence'])
    const tones = barChordTones(g)
    const len = scaleLength(g.scale.mode)
    melody.forEach((d, i) => {
      if (d === null || !onBeat(i % 16, 16)) return
      expect(tones[Math.floor(i / 16)]!.has(mod(d, len))).toBe(true)
    })
    // The answer is a different line from the statement
    expect(melody.slice(16, 32)).not.toEqual(melody.slice(0, 16))
  })

  it('every seed melody sits on its chords on the downbeats and has a motif', () => {
    for (const [name, g] of Object.entries(allSeeds())) {
      if (!g.activeLayers.melody || !g.genre) continue
      const tones = barChordTones(g)
      const len = scaleLength(g.scale.mode)
      let on = 0
      let fit = 0
      g.melody.notes.forEach((d, i) => {
        if (d === null || i % 4 !== 0) return
        on++
        if (tones[Math.floor(i / 16)]!.has(mod(d, len))) fit++
      })
      expect(fit / on, name).toBeGreaterThanOrEqual(0.85)
      expect(extractMotif(g, g.melody.notes), name).not.toBeNull()
    }
  })

  it('gives contrast material a new tune built on the theme’s motif', () => {
    const theme = getSeed('house')
    const b = contrastFrom(theme, createRng(4))
    expect(b.chords.progression).not.toEqual(theme.chords.progression)
    const themeRhythm = extractMotif(theme, theme.melody.notes)!.rhythm
    const bRhythms = [0, 1, 2, 3].map((bar) => b.melody.notes.slice(bar * 16, bar * 16 + 16).map((d) => (d === null ? '-' : 'x')).join(''))
    // At least one bar of B keeps (or adds a note to) the theme's rhythm
    expect(bRhythms.some((r) => [...themeRhythm].every((c, i) => c === '-' || r[i] === 'x'))).toBe(true)
  })
})

describe('Rhythm and groove', () => {
  it('plays ghost notes and accents from the genre groove', () => {
    const code = compileGenome(getSeed('house'), undefined, KITS.house)
    // The house snare line has a backbeat and quieter ghosts
    const snareLine = code.split('\n').find((l) => l.includes('realclaps'))!
    const gains = snareLine.match(/\.gain\("([^"]+)"\)/)![1]!.split(' ').map(Number).filter((x) => x > 0)
    expect(Math.max(...gains)).toBeGreaterThan(Math.min(...gains) * 2)
  })

  it('drags the lo-fi snare behind the beat', () => {
    const code = compileGenome(getSeed('lofi'), undefined, KITS.lofi)
    const snareLine = code.split('\n').find((l) => l.includes(KITS.lofi!.drums.snare))!
    expect(snareLine).toMatch(/\.late\(/)
  })

  it('gives each genre its own groove, not the same grid', () => {
    const grooves = Object.values(STYLES).map((s) => JSON.stringify(s.groove))
    expect(new Set(grooves).size).toBe(grooves.length)
  })

  it('uses genre fills: lo-fi drops out, drum & bass edits, trance builds', () => {
    const sections = (genre: string) => {
      const g = { ...getSeed('lofi'), genre }
      return [
        { role: 'verse', bars: 8, energy: 0.55, genome: g },
        { role: 'verse', bars: 8, energy: 0.55, genome: g },
        { role: 'chorus', bars: 8, energy: 0.8, genome: g },
      ]
    }
    expect(sectionTransition(sections('lofi'), 0).fill).toBe('stop')
    expect(sectionTransition(sections('dnb'), 0).fill).toBe('edit')
    expect(sectionTransition(sections('trance'), 1).fill).toBe('build')
  })
})

describe('Genre constraints under evolution', () => {
  it('keeps modes and chord vocabulary inside the genre', () => {
    for (const ch of CHANNELS) {
      const style = getStyle(channelSeed(ch).genre)
      let g = applyChannelFingerprint(ch.id, channelSeed(ch))
      const rng = createRng(11)
      for (let i = 0; i < 60; i++) {
        g = applyChannelFingerprint(ch.id, mutate(g, rng, { personality: channelPersonality(ch), intensity: 'moderate' }).genome)
        expect(style.harmony.modes, ch.id).toContain(g.scale.mode)
      }
    }
  })

  it('musical mutations keep the harmony: chord changes move the bass with them', () => {
    const op = MUTATION_OPS.find((o) => o.name === 'ChangeChordRoot')!
    const g = getSeed('lofi')
    for (let seed = 0; seed < 20; seed++) {
      const r = op.apply(cloneGenome(g), createRng(seed), 'small')
      if (!r) continue
      const fit = evaluateFitness(r.genome).metrics.harmonicConsistency
      expect(fit).toBeGreaterThan(0.85)
    }
  })

  it('every seed compiles in every section role', () => {
    for (const ch of CHANNELS) {
      for (const name of channelSeedNames(ch)) {
        const g = getSeed(name)
        const sections = ['intro', 'groove', 'build', 'drop', 'breakdown', 'outro'].map((role, i) => ({
          role,
          bars: 4,
          energy: [0.3, 0.6, 0.6, 1, 0.35, 0.3][i]!,
          genome: g,
        }))
        const code = compileTimeline([{ startCycle: 0, sections }], g.tempo, undefined, KITS[ch.id])
        expect(code).toContain('arrange(')
        expect(code).not.toMatch(/undefined|NaN/)
      }
    }
  })
})

describe('Strudel compilation of the new material', () => {
  it('plays the arp from the chord tones of each bar', () => {
    const g = getSeed('trance')
    const code = compileGenome(g, undefined, KITS.trance)
    const arpVoice = `.sound("${KITS.trance!.arp!.sound}").lpf(${KITS.trance!.arp!.lpf}).lpenv(${KITS.trance!.arp!.filterEnv})`
    const arpLine = code.split('\n').find((l) => l.includes(arpVoice))!
    // First bar is A minor: the arp's notes are A, C and E
    const firstBar = arpLine.match(/note\("([^"]+)"\)/)![1]!.split(' ').slice(0, 16)
    for (const n of firstBar) if (n !== '~') expect(['a', 'c', 'e']).toContain(n.replace(/\d+$/, ''))
  })

  it('holds chords as pads in breakdowns and plays stabs elsewhere', () => {
    expect(renderForSection('breakdown', 0.35, undefined, 8, getStyle('house')).pads).toBe(true)
    expect(renderForSection('drop', 1, undefined, 8, getStyle('house')).pads).toBe(false)
  })

  it('plays the percussion line with the kit’s sample', () => {
    const code = compileGenome(getSeed('house'), undefined, KITS.house)
    expect(code).toContain(KITS.house!.drums.perc!.sample)
  })
})

describe('Backward compatibility', () => {
  const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-house-genome.json', import.meta.url), 'utf8')) as MusicGenome

  it('loads, scores, mutates and compiles a genome saved before genres, arps and percussion', () => {
    expect(legacy.genre).toBeUndefined()
    expect(legacy.arp).toBeUndefined()
    const g = validateGenome(cloneGenome(legacy))
    expect(evaluateFitness(g).score).toBeGreaterThan(0)
    const rng = createRng(5)
    let cur = g
    for (let i = 0; i < 40; i++) cur = mutate(cur, rng).genome
    expect(() => validateGenome(cur)).not.toThrow()
    expect(compileGenome(g, undefined, KITS.house)).toContain('setcps')
  })

  it('renders a genre-less genome with the original root-position chords', () => {
    const g = validateGenome(cloneGenome(legacy))
    // Fm7 in root position at octave 3: F3 Ab3 C4 Eb4
    expect(chordVoicings(g)[0]).toEqual([53, 56, 60, 63])
  })

  it('keeps every seed name loadable and validates new optional fields', () => {
    for (const name of SEED_NAMES) expect(() => validateGenome(getSeed(name))).not.toThrow()
    const g = cloneGenome(getSeed('house'))
    g.chords.colors = ['nonsense', null, null, null]
    expect(() => validateGenome(g)).toThrow(/chords.colors/)
    const h = cloneGenome(getSeed('house'))
    h.arp!.pattern[0] = 99
    expect(() => validateGenome(h)).toThrow(/arp.pattern/)
  })
})
