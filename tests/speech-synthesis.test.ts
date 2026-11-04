import { describe, expect, it } from 'vitest'
import { loadNodeLexicon } from '../scripts/speech/lexicon-node'
import { decodeWav, encodeWav, mixInto, normalizePeak, resample, rms } from '../src/speech/audio'
import { BACKENDS, getBackend } from '../src/speech/backends'
import { buildFrames } from '../src/speech/backends/formant'
import { synthesizeFrames } from '../src/speech/backends/formant/klatt'
import { CONSONANTS, VOWELS } from '../src/speech/backends/formant/targets'
import { BENCHMARK, DIAGNOSTIC, scoreDiagnostic } from '../src/speech/benchmark'
import { getVoicePreset, speak, validateVoice, VOICE_PRESETS, withControls, DEFAULT_VOICE, M1_VOICE } from '../src/speech'
import { analyzeText } from '../src/speech/linguistic'
import { audioHash, audioMetrics, coverage, editDistance, estimateF0, g2pAccuracy, planMetrics, segmentAcoustics, summarisePhoneAcoustics, voiceHash, wordErrorRate } from '../src/speech/metrics'
import { PHONEME_IDS } from '../src/speech/phonemes'
import { PAUSE, pitchAt, type SpeechPlan } from '../src/speech/plan'
import { planProsody } from '../src/speech/prosody'
import { DEFAULT_SPEECH_SETTINGS, loadSpeechSettings, sanitizeSpeechSettings, saveSpeechSettings } from '../src/speech/settings'
import { MemoryStorage } from '../src/persistence/session'

const lexicon = loadNodeLexicon()
const plan = (text: string, voice = DEFAULT_VOICE) => planProsody(analyzeText(text, { lexicon }), voice)
const segs = (p: SpeechPlan) => p.segments.filter((s) => s.phone !== PAUSE)

/** Energy in a frequency band of a frame, by a direct DFT over the band (no FFT dependency). */
function bandEnergy(x: Float32Array, sr: number, lo: number, hi: number): number {
  let total = 0
  for (let f = lo; f < hi; f += 50) {
    let re = 0
    let im = 0
    for (let n = 0; n < x.length; n++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (x.length - 1))
      re += x[n]! * w * Math.cos((2 * Math.PI * f * n) / sr)
      im -= x[n]! * w * Math.sin((2 * Math.PI * f * n) / sr)
    }
    total += re * re + im * im
  }
  return total
}

describe('prosody', () => {
  it('times every phone with positive durations and no gaps', () => {
    const p = plan('Hello there, how are you today?')
    let t = 0
    for (const s of p.segments) {
      expect(s.start).toBeCloseTo(t, 9)
      expect(s.duration).toBeGreaterThan(0)
      t += s.duration
    }
    expect(p.duration).toBeCloseTo(t, 9)
    expect(p.segments[0]!.phone).toBe(PAUSE)
    expect(p.segments.at(-1)!.phone).toBe(PAUSE)
    expect(p.words.map((w) => w.text)).toEqual(['hello', 'there', 'how', 'are', 'you', 'today'])
  })

  it('lengthens phrase-final syllables and stressed vowels (Klatt rules)', () => {
    const vowelOf = (p: SpeechPlan, word: number) => segs(p).find((s) => s.word === word && s.role === 'nucleus')!
    const final = plan('I saw the cat')
    const medial = plan('I saw the cat today')
    expect(vowelOf(final, 3).duration).toBeGreaterThan(vowelOf(medial, 3).duration * 1.3)
    const m = planMetrics(plan('The photographer took a photograph of the photographic equipment.'))
    expect(m.meanStressedVowelMs).toBeGreaterThan(m.meanUnstressedVowelMs * 1.5)
    // vowels before voiced consonants are longer than before voiceless ones
    expect(vowelOf(plan('bad'), 0).duration).toBeGreaterThan(vowelOf(plan('bat'), 0).duration)
  })

  it('speaks at a plausible rate and scales with the rate control', () => {
    const text = 'The weather has been lovely this week, and the garden is full of flowers.'
    const normal = plan(text)
    const fast = plan(text, withControls(DEFAULT_VOICE, { rate: 2 }))
    const m = planMetrics(normal)
    expect(m.syllablesPerSecond).toBeGreaterThan(3)
    expect(m.syllablesPerSecond).toBeLessThan(7)
    expect(m.implausibleSegments).toBe(0)
    expect(fast.duration).toBeLessThan(normal.duration * 0.62)
    expect(planMetrics(fast).syllablesPerSecond).toBeGreaterThan(m.syllablesPerSecond * 1.8)
  })

  it('pauses at commas and sentence ends, longer at sentence ends', () => {
    const p = plan('One, two. Three')
    const pauses = p.segments.filter((s) => s.phone === PAUSE).map((s) => s.duration)
    expect(pauses).toHaveLength(4) // lead, comma, sentence, tail (on the last sentence's pause)
    expect(pauses[2]!).toBeGreaterThan(pauses[1]!)
  })

  it('rises at the end of yes/no questions and falls at statements and wh-questions', () => {
    expect(planMetrics(plan('You are coming tomorrow?')).finalSlopeSemitones).toBeGreaterThan(2)
    expect(planMetrics(plan('You are coming tomorrow.')).finalSlopeSemitones).toBeLessThan(-2)
    expect(planMetrics(plan('Where are you going tomorrow?')).finalSlopeSemitones).toBeLessThan(-2)
  })

  it('accents content words, more under emphasis, and the monotone voice stays flat', () => {
    const peak = (p: SpeechPlan) => Math.max(...p.pitch.map((x) => x.hz))
    expect(peak(plan('I said the *red* car'))).toBeGreaterThan(peak(plan('I said the red car')))
    const flat = plan('I said the red car', getVoicePreset('monotone'))
    const hz = flat.pitch.map((x) => x.hz)
    expect(Math.max(...hz) - Math.min(...hz)).toBeLessThan(0.5)
    expect(pitchAt(flat.pitch, 0.5)).toBeCloseTo(DEFAULT_VOICE.pitch.baseHz, 0)
  })
})

describe('voices', () => {
  it('ships valid presets', () => {
    for (const v of VOICE_PRESETS) expect(validateVoice(v).issues).toEqual([])
    expect(new Set(VOICE_PRESETS.map((v) => v.id)).size).toBe(VOICE_PRESETS.length)
  })

  it('clamps out-of-range values and enforces relationships between fields', () => {
    const wild = { ...DEFAULT_VOICE, pitch: { ...DEFAULT_VOICE.pitch, baseHz: 900, questionRise: 40 }, tract: { ...DEFAULT_VOICE.tract, formantScale: 1.3 } }
    const { voice, issues } = validateVoice(wild)
    expect(voice.pitch.baseHz).toBe(320)
    expect(voice.pitch.baseHz * 2 ** ((voice.pitch.accentSemitones + voice.pitch.questionRise) / 12)).toBeLessThanOrEqual(450.01)
    expect(issues.length).toBeGreaterThanOrEqual(2)
    const lowChild = validateVoice({ ...DEFAULT_VOICE, pitch: { ...DEFAULT_VOICE.pitch, baseHz: 70 }, tract: { ...DEFAULT_VOICE.tract, formantScale: 1.25 } })
    expect(lowChild.voice.pitch.baseHz).toBeGreaterThan(170)
    const broken = validateVoice({ ...DEFAULT_VOICE, source: { breathiness: Number.NaN } } as never)
    expect(broken.voice.source.breathiness).toBe(DEFAULT_VOICE.source.breathiness)
    expect(broken.voice.source.jitter).toBe(DEFAULT_VOICE.source.jitter)
  })
})

describe('formant backend', () => {
  it('has targets for every phoneme', () => {
    for (const id of PHONEME_IDS) expect(VOWELS[id] ?? CONSONANTS[id]).toBeDefined()
    expect(BACKENDS.map((b) => b.id)).toContain('formant')
    expect(() => getBackend('nope')).toThrow()
  })

  it('renders finite, unclipped, deterministic speech that follows the planned pitch', () => {
    const a = speak('Good morning, how are you today?', DEFAULT_VOICE, { lexicon })
    const b = speak('Good morning, how are you today?', DEFAULT_VOICE, { lexicon })
    const c = speak('Good morning, how are you today?', DEFAULT_VOICE, { lexicon, seed: 2 })
    expect(a.samples.length).toBe(Math.ceil(a.plan.duration * a.sampleRate))
    expect(audioHash(a.samples)).toBe(audioHash(b.samples))
    expect(audioHash(a.samples)).not.toBe(audioHash(c.samples))
    const m = audioMetrics(a.samples, a.sampleRate, a.plan)
    expect(m.nonFinite).toBe(0)
    expect(m.clipped).toBe(0)
    expect(m.peak).toBeCloseTo(0.89, 2)
    expect(Math.abs(m.dcOffset)).toBeLessThan(0.01)
    expect(m.voicedVowelShare).toBeGreaterThan(0.9)
    expect(m.f0ErrorSemitones).toBeLessThan(1)
  })

  it('keeps silence silent and speech loud', () => {
    const r = speak('Yes.', DEFAULT_VOICE, { lexicon })
    const lead = r.plan.segments[0]!
    const speech = segs(r.plan)
    const sr = r.sampleRate
    const silent = rms(r.samples, 0, Math.floor(lead.duration * sr * 0.8))
    const loud = rms(r.samples, Math.floor(speech[0]!.start * sr), Math.floor((speech.at(-1)!.start + speech.at(-1)!.duration) * sr))
    expect(silent).toBeLessThan(1e-4)
    expect(loud).toBeGreaterThan(0.05)
  })

  it('gives vowels their formants and /s/ its high-frequency noise', () => {
    const sr = 16000
    const sustained = (word: string) => {
      const r = speak(word, getVoicePreset('monotone'), { lexicon, sampleRate: sr })
      const nucleus = segs(r.plan).find((s) => s.role === 'nucleus')!
      const mid = Math.floor((nucleus.start + nucleus.duration / 2) * sr)
      return r.samples.slice(mid - 320, mid + 320)
    }
    const ee = sustained('bee') // F1 ≈ 280, F2 ≈ 2250
    const ah = sustained('bar') // F1 ≈ 660, F2 ≈ 1080
    expect(bandEnergy(ah, sr, 550, 800) / bandEnergy(ah, sr, 200, 400)).toBeGreaterThan(bandEnergy(ee, sr, 550, 800) / bandEnergy(ee, sr, 200, 400))
    expect(bandEnergy(ee, sr, 1900, 2600)).toBeGreaterThan(bandEnergy(ah, sr, 1900, 2600))

    const r = speak('sass', getVoicePreset('monotone'), { lexicon, sampleRate: sr })
    const s = segs(r.plan)[0]!
    const a = Math.floor((s.start + 0.02) * sr)
    const fric = r.samples.slice(a, a + 640)
    expect(bandEnergy(fric, sr, 4000, 7500)).toBeGreaterThan(bandEnergy(fric, sr, 100, 1500) * 3)
    expect(estimateF0(fric, sr).strength).toBeLessThan(0.5) // aperiodic
  })

  it('aspirates voiceless stops before stressed vowels but not after /s/', () => {
    const aspirationAh = (word: string) => {
      const p = plan(word)
      const frames = buildFrames(p, DEFAULT_VOICE, 22050)
      const v = segs(p).find((s) => s.role === 'nucleus')!
      return frames[Math.round((v.start + 0.01) / 0.005)]!.ah
    }
    expect(aspirationAh('pin')).toBeGreaterThan(0.3)
    expect(aspirationAh('spin')).toBe(0)
  })

  it('renders frames directly at any sample rate', () => {
    const frames = buildFrames(plan('ah'), DEFAULT_VOICE, 8000)
    const out = synthesizeFrames(frames, 0.005, 8000, DEFAULT_VOICE.source)
    expect(out.length).toBe(Math.ceil(frames.length * 40))
    expect(out.every(Number.isFinite)).toBe(true)
  })
})

describe('audio utilities', () => {
  it('round-trips 16-bit WAV', () => {
    const x = new Float32Array(1000).map((_, i) => Math.sin(i / 10) * 0.5)
    const bytes = encodeWav(x, 22050)
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF')
    expect(bytes.length).toBe(44 + 2000)
    const back = decodeWav(bytes)
    expect(back.sampleRate).toBe(22050)
    expect(Math.max(...back.samples.map((v, i) => Math.abs(v - x[i]!)))).toBeLessThan(1e-4)
  })

  it('resamples without changing pitch or length in time', () => {
    const sr = 22050
    const x = new Float32Array(sr / 2).map((_, i) => Math.sin((2 * Math.PI * 200 * i) / sr))
    const y = resample(x, sr, 48000)
    expect(y.length).toBe(Math.round(x.length * (48000 / sr)))
    expect(estimateF0(y.subarray(4000, 6000), 48000).hz).toBeCloseTo(200, -1)
    expect(rms(y, 1000, 20000)).toBeCloseTo(Math.SQRT1_2, 1)
  })

  it('mixes and normalises', () => {
    const m = mixInto(new Float32Array([0.1, 0.1]), new Float32Array([0.2, 0.2]), 1, 0.5)
    expect([...m].map((v) => +v.toFixed(3))).toEqual([0.1, 0.2, 0.1])
    expect(Math.max(...normalizePeak(new Float32Array([0.1, -0.5]))).toFixed(2)).toBe('0.18')
    expect(normalizePeak(new Float32Array([0, 0]))[0]).toBe(0)
  })
})

describe('benchmark and metrics', () => {
  it('measures word error rate on normalised words', () => {
    expect(editDistance(['a', 'b', 'c'], ['a', 'c'])).toBe(1)
    expect(wordErrorRate('It costs £5.', 'it costs five pounds')).toBe(0)
    expect(wordErrorRate('You are here', "you're here")).toBe(0)
    expect(wordErrorRate('one two three four', 'one too three')).toBe(0.5)
  })

  it('covers the phoneme inventory and analyses every item', () => {
    const utts = BENCHMARK.map((b) => analyzeText(b.text, { lexicon }))
    const cov = coverage(utts)
    expect(cov.phonemesUsed.length).toBeGreaterThanOrEqual(PHONEME_IDS.length - 3)
    expect(cov.diphones).toBeGreaterThan(300)
    expect(cov.guessedWords).toEqual(expect.arrayContaining(['blorpington']))
    for (const u of utts) expect(planMetrics(planProsody(u, DEFAULT_VOICE)).implausibleSegments).toBe(0)
  })

  it('measures letter-to-sound accuracy against the lexicon', () => {
    const r = g2pAccuracy(lexicon, ['cat', 'ship', 'make', 'nation', 'think', 'garden', 'running', 'zzz-not-a-word'])
    expect(r.words).toBe(7)
    expect(r.phoneErrorRate).toBeLessThan(0.35)
  })
})

describe('speech settings', () => {
  it('sanitises stored settings and keeps them under their own prefix', () => {
    const s = sanitizeSpeechSettings({ text: 'hi', voiceId: 'nobody', backendId: 'x', rate: 9, pitch: Number.NaN })
    expect(s).toEqual({ ...DEFAULT_SPEECH_SETTINGS, text: 'hi', rate: 2 })
    const store = new MemoryStorage()
    store.setItem('channel:house', 'music state')
    saveSpeechSettings(store, { ...DEFAULT_SPEECH_SETTINGS, voiceId: 'cedar' })
    expect(loadSpeechSettings(store).voiceId).toBe('cedar')
    expect(store.getItem('channel:house')).toBe('music state')
    store.setItem('settings', '{broken')
    expect(loadSpeechSettings(store)).toEqual(DEFAULT_SPEECH_SETTINGS)
  })
})

describe('M2 acoustics and evaluation', () => {
  it('LF pulse: flow returns to zero each period and the negative peak is −1', async () => {
    const { LfPulse } = await import('../src/speech/backends/formant/klatt')
    for (const rd of [0.5, 0.9, 1.6, 2.5]) {
      const p = new LfPulse()
      p.setRd(rd)
      let area = 0
      let min = 0
      const N = 20000
      for (let i = 0; i < N; i++) {
        const v = p.at(i / N)
        area += v / N
        min = Math.min(min, v)
      }
      expect(Math.abs(area)).toBeLessThan(0.03) // the Rd regression balances areas only approximately
      expect(min).toBeCloseTo(-1, 2)
    }
  })

  it('keeps the frozen M1 backend reproducible and separate from the current engine', () => {
    const text = 'Now say thin again.'
    const m1a = speak(text, M1_VOICE, { lexicon })
    const m1b = speak(text, M1_VOICE, { lexicon })
    const cur = speak(text, DEFAULT_VOICE, { lexicon })
    expect(m1a.backend).toBe('formant-m1')
    expect(audioHash(m1a.samples)).toBe(audioHash(m1b.samples))
    expect(audioHash(cur.samples)).not.toBe(audioHash(m1a.samples))
  })

  it('puts fricative energy where natural speech has it (below 8 kHz, /s/ above /ʃ/)', () => {
    const r = speak('She sells sea shells. Five thin fish, fine thin vines.', DEFAULT_VOICE, { lexicon })
    const sum = summarisePhoneAcoustics(segmentAcoustics(r.samples, r.sampleRate, r.plan))
    const get = (p: string) => sum.find((x) => x.phone === p)!
    expect(get('s').centroid).toBeGreaterThan(get('ʃ').centroid + 1500)
    expect(get('f').centroid).toBeLessThan(7000) // M1: ~8 kHz, invisible to 16 kHz listeners
    expect(get('θ').centroid).toBeLessThan(7000)
    expect(get('f').levelDb).toBeLessThan(get('s').levelDb) // non-sibilants are weaker
    for (const p of ['s', 'ʃ', 'f', 'θ']) expect(get(p).outside).toEqual([])
    // voiced fricatives carry frication, not only a low murmur (M1: 98% of energy under 500 Hz)
    expect(get('v').low).toBeLessThan(0.95)
  })

  it('gives vowels energy above 4 kHz (higher poles) without clipping', () => {
    const r = speak('The weather has been lovely this week.', DEFAULT_VOICE, { lexicon })
    const vowelRows = segmentAcoustics(r.samples, r.sampleRate, r.plan).filter((x) => VOWELS[x.phone])
    expect(vowelRows.length).toBeGreaterThan(5)
    const m = audioMetrics(r.samples, r.sampleRate, r.plan)
    expect(m.clipped).toBe(0)
    expect(m.voicedVowelShare).toBeGreaterThan(0.9)
    expect(m.f0ErrorSemitones).toBeLessThan(0.5)
  })

  it('scores diagnostic items as a closed set', () => {
    const item = DIAGNOSTIC.find((d) => d.target === 'thin')!
    expect(scoreDiagnostic(item, ['now', 'say', 'thin', 'again'])).toEqual({ heard: 'thin', correct: true, foil: false })
    expect(scoreDiagnostic(item, ['now', 'say', 'fin', 'again'])).toEqual({ heard: 'fin', correct: false, foil: true })
    expect(scoreDiagnostic(item, ['now', 'save', 'it', 'again']).correct).toBe(false)
    expect(DIAGNOSTIC.length).toBeGreaterThanOrEqual(50)
  })

  it('hashes voices independently of key order', () => {
    const a = voiceHash(DEFAULT_VOICE)
    const b = voiceHash(JSON.parse(JSON.stringify({ ...DEFAULT_VOICE, pitch: { ...DEFAULT_VOICE.pitch } })))
    expect(a).toBe(b)
    expect(voiceHash(M1_VOICE)).not.toBe(a)
  })
})

describe('M5 connected speech', () => {
  const words = (text: string, connectedSpeech = true) => analyzeText(text, { lexicon, connectedSpeech }).sentences.flatMap((s) => s.phrases.flatMap((p) => p.words))
  const ids = (w: { phones: { id: string }[] }) => w.phones.map((p) => p.id).join(' ')

  it('moves the nucleus off a phrase-final "again"', () => {
    const p = plan('Now say bead again.')
    const accented = new Set(segs(p).filter((s) => s.accented).map((s) => p.words[s.word]!.text))
    expect(accented.has('bead')).toBe(true)
    expect(accented.has('again')).toBe(false)
    // alone, "again" keeps its accent
    expect(segs(plan('Again.')).some((s) => s.accented)).toBe(true)
  })

  it('chooses noun and verb forms of homographs from the word before', () => {
    const w = words('I want to record a record. I have read it. They live near a live band.')
    const get = (text: string, n = 0) => w.filter((x) => x.text === text)[n]!
    expect(get('record', 0).phones.findIndex((p) => p.stress === 1)).toBeGreaterThan(get('record', 1).phones.findIndex((p) => p.stress === 1))
    expect(ids(get('read'))).toBe('r e d')
    expect(ids(get('live', 0))).toContain('ɪ')
    expect(ids(get('live', 1))).toContain('aɪ')
  })

  it('links a final r before a vowel in the same phrase only', () => {
    const w = words('Far away. Far, away. Far town.')
    expect(ids(w[0]!).endsWith('r')).toBe(true)
    expect(ids(w[2]!).endsWith('r')).toBe(false)
    expect(ids(w[4]!).endsWith('r')).toBe(false)
  })

  it('leaves the M1 front end unchanged', () => {
    const w = words('Far away, I want to record it again.', false)
    expect(ids(w[0]!).endsWith('r')).toBe(false)
    expect(w.some((x) => x.deaccent)).toBe(false)
    expect(validateVoice(M1_VOICE).voice.frontend).toBe('m1')
  })
})

describe('hybrid research backends', () => {
  it('tract: a uniform 17 cm tube resonates near 500/1500/2500 Hz', async () => {
    const { tractFormants } = await import('../src/speech/backends/tract/acoustics')
    const { TRACT_RATE } = await import('../src/speech/backends/tract/shapes')
    const f = tractFormants(new Array(44).fill(1.5), 3, 0.01, TRACT_RATE)
    expect(f[0]).toBeGreaterThan(400)
    expect(f[0]).toBeLessThan(620)
    expect(f[1]).toBeGreaterThan(1300)
    expect(f[1]).toBeLessThan(1700)
    expect(f[2]).toBeGreaterThan(2250)
    expect(f[2]).toBeLessThan(2750)
  })

  it('tract: renders a sentence with sound in it and is deterministic', () => {
    const voice = { ...DEFAULT_VOICE, backend: 'tract' }
    const a = speak('A big ship.', voice, { lexicon })
    const b = speak('A big ship.', voice, { lexicon })
    expect(audioHash(a.samples)).toBe(audioHash(b.samples))
    expect(rms(a.samples)).toBeGreaterThan(0.005)
    expect(a.samples.every((x) => Number.isFinite(x))).toBe(true)
  })

  it('units: concatenates a tiny diphone database and reports missing diphones', async () => {
    const units = await import('../src/speech/backends/units')
    const sr = 16000
    // one synthetic voiced diphone _-ɑː and ɑː-_ (120 Hz pulse train), everything else missing
    const len = 1600
    const pcm = new Int16Array(len * 2)
    const marks: number[] = []
    for (let i = 0; i < len; i += Math.round(sr / 120)) marks.push(i)
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(8000 * Math.sin((2 * Math.PI * 240 * i) / sr))
    units.setUnitDatabase({
      sampleRate: sr,
      speakerF0: 120,
      pcm,
      units: {
        '_-ɑː': { offset: 0, length: len, mid: len / 2, marks: marks.filter((m) => m >= len / 2) },
        'ɑː-_': { offset: len, length: len, mid: len / 2, marks: marks.filter((m) => m < len / 2) },
      },
    })
    try {
      const p = plan('Ah.')
      const out = units.renderUnits(p, DEFAULT_VOICE, { sampleRate: 16000 })
      expect(out.length).toBe(Math.ceil(p.duration * 16000))
      expect(rms(out)).toBeGreaterThan(0.01)
      expect(units.lastStats.units).toBeGreaterThan(0)
      const q = plan('Ah, see.')
      units.renderUnits(q, DEFAULT_VOICE, { sampleRate: 16000 })
      expect(units.lastStats.missing.length).toBeGreaterThan(0)
    } finally {
      units.setUnitDatabase(null)
    }
  })

  it('recorded excitation off leaves the default voice unchanged even with pulses loaded', async () => {
    const { setExcitationPulses } = await import('../src/speech/backends/formant/klatt')
    const text = 'Now say bead again.'
    const before = audioHash(speak(text, DEFAULT_VOICE, { lexicon }).samples)
    const pulse = Array.from({ length: 256 }, (_, i) => Math.sin((2 * Math.PI * i) / 256) - (i === 200 ? 4 : 0))
    setExcitationPulses([pulse, pulse])
    try {
      expect(audioHash(speak(text, DEFAULT_VOICE, { lexicon }).samples)).toBe(before)
      const rex = validateVoice({ ...DEFAULT_VOICE, source: { ...DEFAULT_VOICE.source, excitation: 1 } }).voice
      const r = speak(text, rex, { lexicon })
      expect(audioHash(r.samples)).not.toBe(before)
      expect(r.samples.every((x) => Number.isFinite(x))).toBe(true)
    } finally {
      setExcitationPulses(null)
    }
  })
})
