import { describe, expect, it } from 'vitest'
import { analyzeText } from '../src/speech'
import { kokoroPhonemes, kokoroPieces, kokoroTokens, misakiFromPhones, parseLexicon, parseTokens } from '../src/speech/neural/kokoro-text'
import { encodeMp3 } from '../src/speech/neural/mp3'
import { compileStrudelRecording, compileStrudelWords, soundName } from '../src/speech/strudel/recorded'
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

describe('Strudel code with a sound per word', () => {
  it('splits the phoneme string into words and separators', () => {
    const utt = analyzeText('Hello, the zoo.', { lexicon: loadNodeLexicon() })
    const pieces = kokoroPieces(utt, LEX)
    expect(pieces.map((p) => p.phonemes).join('')).toBe(kokoroPhonemes(utt, LEX))
    expect(pieces.filter((p) => p.word).map((p) => p.word)).toEqual(['hello', 'the', 'zoo'])
  })

  it('names sounds so mini-notation accepts them', () => {
    expect(soundName("Don't")).toBe('dont')
    expect(soundName('£')).toBe('w')
  })

  const words = [
    { word: 'the', start: 10, end: 14 },
    { word: 'zoo', start: 15, end: 30 },
    { word: 'the', start: 40, end: 44 },
    { word: 'end', start: 44, end: 60 },
  ]

  it('writes the recorded rhythm as @ weights, numbering repeated words', () => {
    const { code, seconds } = compileStrudelWords({ audio: 'AAAA', words, frame: 0.025, lead: 0.25, tail: 0.5 })
    expect(code).toContain('s(`the@5 zoo@19 ~@6\n   the:1@4 end@20 ~@16`).bank("ct")')
    expect(seconds).toBeCloseTo((60 - 10 + 20) * 0.025)
    expect(code).toContain('const words = { the: [[0.245,0.38],[0.995,1.105]], zoo: [[0.37,0.855]], end: [[1.095,1.605]] }')
    expect(code).toContain("['ct_' + w,")
  })

  it('never writes a zero-length step (Strudel reads @0 as @1, and the rest of the pattern slips)', () => {
    const { code } = compileStrudelWords({ audio: 'AAAA', words: [{ word: 'a', start: 0, end: 10 }, { word: 'b', start: 14, end: 20 }], frame: 0.025, lead: 0 })
    expect(code).toContain('s(`a@14 b@10 ~@20`)')
    expect(code).not.toMatch(/@0\b/)
  })

  it('uses double quotes only for patterns (Strudel reads them as mini-notation)', () => {
    const { code } = compileStrudelWords({ audio: 'AAAA', words, frame: 0.025, lead: 0.25, text: 'the zoo' })
    const doubles = [...code.split('\n').filter((l) => !l.startsWith('//')).join('\n').matchAll(/"[^"\n]*"/g)].map((m) => m[0])
    expect(doubles).toEqual(['"ct"'])
  })
})

