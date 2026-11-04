import { describe, expect, it } from 'vitest'
import { loadNodeLexicon } from '../scripts/speech/lexicon-node'
import { addPast, addPlural, letterToSound, morphologicalPronunciation, rulesPronunciation } from '../src/speech/g2p'
import { cmuToBritish, createLexicon, parseBritfone } from '../src/speech/lexicon'
import { analyzeText, utteranceWords } from '../src/speech/linguistic'
import { normalizeText } from '../src/speech/normalize'
import { cardinal, clock, date, decimal, money, ordinal, year } from '../src/speech/numbers'
import { formatPronunciation, isVowel, parsePronunciation, PHONEMES, phonemeInfo } from '../src/speech/phonemes'
import { syllabify } from '../src/speech/syllables'

const lexicon = loadNodeLexicon()
const ids = (s: string) => parsePronunciation(s).map((p) => p.id).join(' ')
const words = (text: string) => normalizeText(text).flatMap((s) => s.phrases.flatMap((p) => p.words.map((w) => w.text))).join(' ')
const pron = (word: string) => formatPronunciation(analyzeText(word, { lexicon }).sentences[0]!.phrases[0]!.words[0]!.phones)

describe('phoneme inventory', () => {
  it('has the SSB vowels and consonants with unique ids', () => {
    expect(PHONEMES.filter((p) => p.kind === 'vowel')).toHaveLength(21)
    expect(PHONEMES.filter((p) => p.kind === 'consonant')).toHaveLength(24)
    expect(new Set(PHONEMES.map((p) => p.id)).size).toBe(PHONEMES.length)
    expect(phonemeInfo('əʊ')).toMatchObject({ kind: 'vowel', glide: 'ʊ' })
    expect(phonemeInfo('ð')).toMatchObject({ kind: 'consonant', place: 'dental', voiced: true })
  })

  it('round-trips the stress notation and rejects unknown symbols', () => {
    const p = parsePronunciation('t ə m ˈɑː t ˌəʊ')
    expect(p.map((x) => x.stress ?? '-')).toEqual(['-', 0, '-', 1, '-', 2])
    expect(formatPronunciation(p)).toBe('t ə m ˈɑː t ˌəʊ')
    expect(() => parsePronunciation('k ɹ æ t')).toThrow(/Unknown phoneme/)
  })
})

describe('lexicons', () => {
  it('parses Britfone into our symbols, with alternatives', () => {
    const m = parseBritfone('HELLO(1), h ɛ l ˈəʊ\nHELLO(2), h ə l ˈəʊ\nRUN, ɹ ˈɐ n\nA_LOT, ə l ˈɒ t\n')
    expect(m.get('hello')!.map(formatPronunciation)).toEqual(['h e l ˈəʊ', 'h ə l ˈəʊ'])
    expect(formatPronunciation(m.get('run')![0]!)).toBe('r ˈʌ n')
    expect(m.has('a_lot')).toBe(false)
  })

  it('converts General American CMUdict entries to Southern British', () => {
    const gb = (w: string, arpa: string) => formatPronunciation(cmuToBritish(w, arpa))
    expect(gb('car', 'K AA1 R')).toBe('k ˈɑː')
    expect(gb('water', 'W AO1 T ER0')).toBe('w ˈɔː t ə')
    expect(gb('dog', 'D AO1 G')).toBe('d ˈɒ g')
    expect(gb('hot', 'HH AA1 T')).toBe('h ˈɒ t')
    expect(gb('father', 'F AA1 DH ER0')).toBe('f ˈɑː ð ə')
    expect(gb('near', 'N IH1 R')).toBe('n ˈɪə')
    expect(gb('very', 'V EH1 R IY0')).toBe('v ˈe r i')
    expect(gb('tune', 'T UW1 N')).toBe('t j ˈuː n')
    expect(gb('goat', 'G OW1 T')).toBe('g ˈəʊ t')
    expect(gb('bath', 'B AE1 TH')).toBe('b ˈɑː θ')
    expect(gb('cat', 'K AE1 T')).toBe('k ˈæ t')
    expect(gb('fire', 'F AY1 ER0')).toBe('f ˈaɪ ə')
    expect(gb('hurt', 'HH ER1 T')).toBe('h ˈɜː t')
  })

  it('prefers project entries, then Britfone, then CMUdict', () => {
    const lex = createLexicon({
      britfone: 'TOMATO, t ə m ˈɑː t ˌəʊ\n',
      cmu: { tomato: 'T AH0 M EY1 T OW2', zebra: 'Z IY1 B R AH0' },
      custom: { zebra: [parsePronunciation('z ˈe b r ə')] },
    })
    expect(lex.lookup('Tomato')[0]).toMatchObject({ source: 'britfone' })
    expect(lex.lookup('zebra')[0]).toMatchObject({ source: 'custom' })
    expect(lex.lookup('nothing')).toEqual([])
    expect(lex.stats()).toEqual({ britfone: 1, cmudict: 2, custom: 1 })
  })

  it('loads the full default lexicon', () => {
    const s = lexicon.stats()
    expect(s.britfone).toBeGreaterThan(15000)
    expect(s.cmudict).toBeGreaterThan(120000)
    expect(pron('schedule')).toBe('ʃ ˈe dʒ uː l') // British, from Britfone
    expect(lexicon.lookup('kaleidoscope')[0]?.source).toBe('cmudict')
    expect(pron('kaleidoscope')).toBe('k ə l ˈaɪ d ə s k ˌəʊ p')
  })
})

describe('numbers and text normalisation', () => {
  it('reads numbers the British way', () => {
    expect(cardinal(105)).toBe('one hundred and five')
    expect(cardinal(1005)).toBe('one thousand and five')
    expect(cardinal(2_500_021)).toBe('two million five hundred thousand and twenty-one')
    expect(cardinal(-7)).toBe('minus seven')
    expect(ordinal(21)).toBe('twenty-first')
    expect(ordinal(12)).toBe('twelfth')
    expect(ordinal(40)).toBe('fortieth')
    expect(year(1984)).toBe('nineteen eighty-four')
    expect(year(2005)).toBe('two thousand and five')
    expect(year(2026)).toBe('twenty twenty-six')
    expect(year(1900)).toBe('nineteen hundred')
    expect(year(1905)).toBe('nineteen oh five')
    expect(decimal('3.14')).toBe('three point one four')
    expect(money('£', '5.50')).toBe('five pounds fifty')
    expect(money('£', '0.75')).toBe('seventy-five pence')
    expect(money('$', '1')).toBe('one dollar')
    expect(clock(10, 30)).toBe('ten thirty')
    expect(clock(9, 5)).toBe('nine oh five')
    expect(date(3, 11, 2026)).toBe('the third of november twenty twenty-six')
  })

  it('expands numbers, dates, money, symbols and abbreviations in text', () => {
    expect(words('On 3/11/2026 at 10:30.')).toBe('on the third of november twenty twenty six at ten thirty')
    expect(words('It costs £5.50, or 25% off.')).toBe('it costs five pounds fifty or twenty five percent off')
    expect(words('Dr. Smith lives on Baker St. near St. Paul.')).toBe('doctor smith lives on baker street near saint paul')
    expect(words('the 21st time')).toBe('the twenty first time')
    expect(words('3 November')).toBe('the third of november')
    expect(words('In 1984 we had 1,250 & more')).toBe('in nineteen eighty four we had one thousand two hundred and fifty and more')
    expect(words('Run 5 km')).toBe('run five kilometres')
    expect(words('e.g. this')).toBe('for example this')
  })

  it('spells initialisms using letter names', () => {
    const toks = normalizeText('The BBC is OK.', { isKnownWord: (w) => lexicon.has(w) })[0]!.phrases[0]!.words
    expect(toks.map((t) => t.text)).toEqual(['the', 'b', 'b', 'c', 'is', 'okay'])
    expect(toks[1]!.pron).toBe('b ˈiː')
  })

  it('segments sentences and phrases and marks types and emphasis', () => {
    const s = normalizeText('Hello, world. How are you? I am *fine*! Good; thanks.')
    expect(s.map((x) => x.type)).toEqual(['statement', 'question', 'exclamation', 'statement'])
    expect(s[0]!.phrases.map((p) => p.boundary)).toEqual(['comma', 'sentence'])
    expect(s[0]!.phrases[1]!.words.map((w) => w.text)).toEqual(['world'])
    expect(s[1]!.phrases[0]!.words.map((w) => w.text)).toEqual(['how', 'are', 'you'])
    expect(s[2]!.phrases[0]!.words.find((w) => w.text === 'fine')!.emphasis).toBe(true)
    expect(s[3]!.phrases.map((p) => p.boundary)).toEqual(['clause', 'sentence'])
    expect(normalizeText('  ')).toEqual([])
  })

  it('reads ranges, decades, ratios and fractions', () => {
    expect(words('Pages 5-10 and 5–10, from 1990-1995, 10-20% more')).toBe(
      'pages five to ten and five to ten from nineteen ninety to nineteen ninety-five ten to twenty percent more'.replace(/-/g, ' '),
    )
    expect(words('COVID-19 and -5 degrees')).toBe('covid nineteen and minus five degrees')
    expect(words("The 1990s, the 80s and the '60s")).toBe('the nineteen nineties the eighties and the sixties')
    expect(words('A 2:1 win at 2:30')).toBe('a two to one win at two thirty')
    expect(words('1/2, 3/4, 5/8 and 24/7')).toBe('one half three quarters five eighths and twenty four seven')
    expect(words('Call 020-7946-0958')).toBe('call oh two oh seven nine four six oh nine five eight')
  })

  it('reads Unicode fractions, powers and non-ASCII digits instead of dropping them', () => {
    expect(words('1½ cups and ¾ of it')).toBe('one and a half cups and three quarters of it')
    expect(words('x² and 5 m³')).toBe('x squared and five metres cubed')
    expect(words('٣ and ７ and १०')).toBe('three and seven and ten')
  })
})

describe('letter-to-sound and morphology fallback', () => {
  it('produces plausible British pronunciations for regular spellings', () => {
    expect(letterToSound('cat').join(' ')).toBe('k æ t')
    expect(letterToSound('ship').join(' ')).toBe('ʃ ɪ p')
    expect(letterToSound('make').join(' ')).toBe('m eɪ k')
    expect(letterToSound('car').join(' ')).toBe('k ɑː') // non-rhotic
    expect(letterToSound('nation').join(' ')).toBe('n eɪ ʃ ə n')
    const p = rulesPronunciation('blorpington')
    expect(p.filter((x) => x.stress === 1)).toHaveLength(1)
    expect(p.every((x) => x.id)).toBe(true)
  })

  it('applies the voicing rules of -s and -ed', () => {
    const P = (s: string) => parsePronunciation(s)
    expect(ids(formatPronunciation(addPlural(P('k ˈæ t'))))).toBe('k æ t s')
    expect(ids(formatPronunciation(addPlural(P('d ˈɒ g'))))).toBe('d ɒ g z')
    expect(ids(formatPronunciation(addPlural(P('h ˈɔː s'))))).toBe('h ɔː s ɪ z')
    expect(ids(formatPronunciation(addPast(P('w ˈɔː k'))))).toBe('w ɔː k t')
    expect(ids(formatPronunciation(addPast(P('w ˈɒ n t'))))).toBe('w ɒ n t ɪ d')
  })

  it('builds unknown words from known parts', () => {
    const empty = createLexicon({ britfone: 'SUN, s ˈɐ n\nFLOWER, f l ˈaʊ ə\nJUMP, dʒ ˈɐ m p\n' })
    expect(formatPronunciation(morphologicalPronunciation('sunflower', empty)!)).toBe('s ˈʌ n f l ˌaʊ ə')
    expect(formatPronunciation(morphologicalPronunciation('jumped', empty)!)).toBe('dʒ ˈʌ m p t')
    expect(morphologicalPronunciation('zqxv', empty)).toBeNull()
    expect(analyzeText('flimbleshoots', { lexicon }).sentences[0]!.phrases[0]!.words[0]!.pronSource).toMatch(/morphology|rules/)
  })
})

describe('syllables and the utterance structure', () => {
  it('syllabifies by maximal onset with English phonotactics', () => {
    const syl = (s: string) => syllabify(parsePronunciation(s)).map((x) => [...x.onset, x.nucleus, ...x.coda].map((p) => p.id).join('')).join('.')
    expect(syl('ˈe k s t r ə')).toBe('ek.strə')
    expect(syl('ˈæ p ə l')).toBe('æ.pəl')
    expect(syl('k ə n s t r ˈʌ k t')).toBe('kən.strʌkt')
    expect(syl('s ˈɪ ŋ ə')).toBe('sɪŋ.ə')
    expect(syllabify(parsePronunciation('h ə l ˈəʊ')).map((s) => s.stress)).toEqual([0, 1])
  })

  it('turns text into sentences, phrases, words, syllables and phones', () => {
    const u = analyzeText('The apple is red, isn\'t it?', { lexicon })
    expect(u.sentences).toHaveLength(1)
    expect(u.sentences[0]!.type).toBe('question')
    expect(u.sentences[0]!.phrases).toHaveLength(2)
    const ws = utteranceWords(u)
    expect(ws.map((w) => w.text)).toEqual(['the', 'apple', 'is', 'red', "isn't", 'it'])
    expect(ws[0]!.phones.map((p) => p.id).join(' ')).toBe('ð i') // "the" before a vowel
    expect(ws[0]!.isFunction).toBe(true)
    expect(ws[1]!.syllables).toHaveLength(2)
    expect(ws.every((w) => w.phones.length > 0)).toBe(true)
    for (const w of ws.filter((x) => !x.isFunction)) expect(w.phones.some((p) => isVowel(p.id) && p.stress === 1)).toBe(true)
  })

  it('uses weak forms for unstressed function words and strong forms when emphasised', () => {
    expect(pron('of')).toBe('ˈɒ v') // alone it is phrase-final: strong
    const weak = utteranceWords(analyzeText('a cup of tea', { lexicon }))
    expect(formatPronunciation(weak[2]!.phones)).toBe('ə v')
    const strong = utteranceWords(analyzeText('a cup *of* tea', { lexicon }))
    expect(formatPronunciation(strong[2]!.phones)).toBe('ˈɒ v')
  })
})
