import { describe, expect, it } from 'vitest'
import { analyzeText } from '../src/speech'
import { kokoroPhonemes, kokoroTokens, misakiFromPhones, parseLexicon, parseTokens } from '../src/speech/neural/kokoro-text'
import { encodeMp3 } from '../src/speech/neural/mp3'
import { compileStrudelRecording } from '../src/speech/strudel/recorded'
import { loadNodeLexicon } from '../scripts/speech/lexicon-node'

const TOKENS = parseTokens('$ 0\n; 1\n, 3\n. 4\n? 6\n  16\nA 24\nI 25\nQ 33\na 43\nd 46\nh 50\nl 54\nn 56\ns 61\nt 62\nz 68\nð 81\nə 83\nɛ 86\nɡ 92\nɪ 102\nɹ 123\nˈ 156\nː 158\nu 63\nW 39\n')
const LEX = parseLexicon('hello h ə l ˈ Q\nthe ð ə\nzoo z ˈ u ː\nzoo z u\n')

describe('neural voice text', () => {
  it('parses tokens.txt including the space symbol', () => {
    expect(TOKENS.get(' ')).toBe(16)
    expect(TOKENS.get('ˈ')).toBe(156)
  })

  it('keeps the first lexicon entry and joins its symbols', () => {
    expect(LEX.get('zoo')).toBe('zˈuː')
    expect(LEX.get('hello')).toBe('həlˈQ')
  })

  it('maps our phones to misaki symbols for words the lexicon lacks', () => {
    expect(misakiFromPhones([{ id: 'g' }, { id: 'əʊ', stress: 1 }, { id: 't' }])).toBe('ɡˈQt')
    expect(misakiFromPhones([{ id: 'r' }, { id: 'aɪ', stress: 1 }, { id: 'd' }])).toBe('ɹˈId')
  })

  it('punctuates by phrase boundary and sentence type', () => {
    const utt = analyzeText('Hello, the zoo? Blorpington.', { lexicon: loadNodeLexicon() })
    const ph = kokoroPhonemes(utt, LEX)
    expect(ph.startsWith('həlˈQ, ðə zˈuː?')).toBe(true)
    expect(ph.endsWith('.')).toBe(true)
    expect(kokoroTokens('həlˈQ,', TOKENS)).toEqual([50, 83, 54, 156, 33, 3])
  })
})

describe('Strudel code carrying audio', () => {
  it('encodes MP3 frames', () => {
    const tone = Float32Array.from({ length: 24000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 24000))
    const mp3 = encodeMp3(tone, 24000, 48)
    expect(mp3[0]).toBe(0xff) // frame sync
    expect(mp3.length).toBeGreaterThan(4000)
    expect(mp3.length).toBeLessThan(9000)
  })

  it('registers a sound that plays the decoded audio, in single-quoted strings only', () => {
    const { code, seconds } = compileStrudelRecording({ audio: 'AAAA', seconds: 2, text: "It's here", tail: 0.5 })
    expect(seconds).toBeCloseTo(2.5)
    expect(code).toContain("decodeAudioData(Uint8Array.from(atob('AAAA')")
    expect(code).toContain("registerSound('ctvoice'")
    expect(code).toContain('s("ctvoice")')
    expect(code).toContain('setcps(0.4000)')
  })
})
