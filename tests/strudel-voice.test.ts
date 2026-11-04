import { describe, expect, it } from 'vitest'
import { loadNodeLexicon } from '../scripts/speech/lexicon-node'
import { getVoicePreset } from '../src/speech'
import { analyzeText } from '../src/speech/linguistic'
import { planProsody } from '../src/speech/prosody'
import { VOICE_CORPUS, DEMO_IDS } from '../src/speech/strudel/corpus'
import { breakpoints, compileStrudelVoice, processorSource } from '../src/speech/strudel/instrument/compile'
import { renderOffline } from '../src/speech/strudel/instrument/offline'

const lexicon = loadNodeLexicon()
const voice = getVoicePreset('alder')
const plan = planProsody(analyzeText('Hello there, how are you?', { lexicon }), voice)
const program = compileStrudelVoice(plan, voice, { text: 'Hello there, how are you?' })

describe('Strudel voice instrument', () => {
  it('compiles to one self-contained Strudel program with one continuous voice event', () => {
    const { code } = program
    expect(code).toContain("registerSound('ctvoice'")
    expect(code).toContain('audioWorklet.addModule')
    expect(code.trim().endsWith('s("ctvoice")')).toBe(true)
    // Strudel reads double-quoted strings as mini-notation: the only one is the final pattern
    const outsideComments = code
      .split('\n')
      .filter((l) => !l.startsWith('//'))
      .join('\n')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted JS strings are plain strings
    expect(outsideComments.match(/"[^"]*"/g)).toEqual(['"ctvoice"'])
    expect(outsideComments).not.toContain('`')
  })

  it('carries a worklet source that runs with nothing but worklet globals in scope', () => {
    const src = processorSource('test-voice')
    let registered: unknown = null
    const scope = {
      sampleRate: 48000,
      currentFrame: 0,
      AudioWorkletProcessor: class {},
      registerProcessor: (_n: string, c: unknown) => (registered = c),
    }
    // evaluate as the worklet would: a fresh function whose only free names are the worklet's
    new Function('globalThis', ...Object.keys(scope), src)(scope, ...Object.values(scope))
    expect(typeof registered).toBe('function')
    expect(/^[\x20-\x7e\n\t]*$/.test(src)).toBe(true) // btoa() needs Latin-1
  })

  it('speaks: the processor renders the utterance as one continuous sound', () => {
    const track = program.code.match(/const speech = \['([^']*)'\]/)![1]!
    const settings = new Function(`return ${program.code.match(/const settings = (\{[^\n]*\})/)![1]}`)()
    const x = renderOffline({ ...settings, track }, 48000)
    expect(x.length / 48000).toBeGreaterThan(plan.duration - 0.05)
    expect(x.length / 48000).toBeLessThan(plan.duration + 0.05)
    let peak = 0
    let bad = 0
    for (const v of x) {
      if (!Number.isFinite(v)) bad++
      peak = Math.max(peak, Math.abs(v))
    }
    expect(bad).toBe(0)
    expect(peak).toBeGreaterThan(0.03)
    expect(peak).toBeLessThan(1)
  })

  it('has an experimental waveguide engine that runs from articulation alone', () => {
    const tract = compileStrudelVoice(plan, voice, { text: 'x', engine: 'tract' })
    const src = processorSource('t', 'tract')
    let Proc: (new (o: unknown) => { process(i: unknown, o: Float32Array[][]): boolean }) | null = null
    const scope = { sampleRate: 48000, currentFrame: 0, AudioWorkletProcessor: class { port = { postMessage: () => {} } }, registerProcessor: (_n: string, c: never) => (Proc = c) }
    new Function('globalThis', ...Object.keys(scope), src)(scope, ...Object.values(scope))
    const track = tract.code.match(/const speech = \['([^']*)'\]/)![1]!
    const settings = new Function(`return ${tract.code.match(/const settings = (\{[^\n]*\})/)![1]}`)()
    const p = new Proc!({ processorOptions: { ...settings, start: 0, track } })
    let peak = 0
    let n = 0
    for (; n < 48000 * 5; n += 128) {
      scope.currentFrame = n
      const buf = new Float32Array(128)
      const alive = p.process([], [[buf]])
      for (const v of buf) peak = Math.max(peak, Math.abs(v))
      if (!alive) break
    }
    expect(n / 48000).toBeGreaterThan(plan.duration - 0.05)
    expect(n / 48000).toBeLessThan(plan.duration + 0.1)
    expect(peak).toBeGreaterThan(0.02)
    expect(Number.isFinite(peak)).toBe(true)
  })

  it('fits tracks with straight lines inside the tolerance', () => {
    const v = [0, 1, 2, 3, 10, 10, 10, 5]
    const bp = breakpoints(v, () => 0.01)
    expect(bp).toEqual([0, 3, 4, 6, 7])
  })

  it('has a fixed corpus with unique ids and a demo subset', () => {
    const ids = VOICE_CORPUS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of DEMO_IDS) expect(ids).toContain(d)
  })
})
