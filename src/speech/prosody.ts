/**
 * Prosody engine: Utterance + voice → SpeechPlan (timing, pauses, pitch contour).
 *
 * Durations follow Klatt's segmental duration rules (D. Klatt, "Synthesis by rule of segmental
 * durations in English sentences", 1979; as used in MITalk, Allen, Hunnicutt & Klatt 1987):
 * every phone has an inherent and a minimum duration, and rules scale the compressible part
 * (phrase-final lengthening, stress, polysyllabic and cluster shortening, the voicing of the
 * following consonant, aspiration).
 *
 * Intonation is a simple tune model in the British tradition (nuclear accent and terminal tone,
 * O'Connor & Arnold; Pierrehumbert-style targets): a declining baseline per phrase, a peak on each
 * accented syllable with downstep, a fall at statement ends, a rise at the end of yes/no questions
 * and a small continuation rise at commas.
 */
import type { Utterance } from './linguistic'
import type { Boundary } from './normalize'
import { isVowel, mannerOf, phonemeInfo, type Stress } from './phonemes'
import { PAUSE, type PitchPoint, type PlanSegment, type PlanSentence, type PlanWord, type SpeechPlan } from './plan'
import { syllablePhones } from './syllables'
import type { SpeechVoice } from './voice'

/** [inherent, minimum] durations in ms (Klatt's table, adapted to the SSB inventory). */
export const DURATIONS: Record<string, readonly [number, number]> = {
  iː: [170, 70], ɪ: [130, 40], e: [150, 70], æ: [200, 80], ʌ: [140, 60], ɑː: [240, 100],
  ɒ: [140, 60], ɔː: [240, 100], ʊ: [130, 50], uː: [200, 70], ɜː: [220, 90], ə: [100, 50],
  i: [110, 45], eɪ: [190, 100], aɪ: [250, 150], ɔɪ: [280, 150], əʊ: [220, 90], aʊ: [260, 100],
  ɪə: [230, 100], eə: [230, 100], ʊə: [230, 100],
  p: [90, 50], b: [85, 60], t: [75, 50], d: [75, 50], k: [80, 60], g: [80, 60],
  tʃ: [120, 70], dʒ: [110, 60], f: [100, 80], v: [60, 40], θ: [90, 60], ð: [50, 30],
  s: [105, 60], z: [75, 40], ʃ: [105, 80], ʒ: [70, 40], h: [80, 20], m: [70, 60], n: [60, 50],
  ŋ: [95, 60], l: [80, 40], r: [80, 30], w: [80, 60], j: [80, 40],
}

export const PAUSE_SECONDS: Record<Boundary | 'lead' | 'tail', number> = {
  lead: 0.12,
  comma: 0.18,
  clause: 0.3,
  sentence: 0.5,
  tail: 0.25,
}

const VOICELESS_STOPS = new Set(['p', 't', 'k'])

interface Slot {
  phone: string
  stress: Stress
  accented: boolean
  emphasis: boolean
  role: 'onset' | 'nucleus' | 'coda'
  word: number
  wordInitial: boolean
  wordFinal: boolean
  inWordFinalSyllable: boolean
  inPhraseFinalSyllable: boolean
  polysyllabic: boolean
  /** syllable index within the phrase, for pitch accents */
  syllable: number
}

/** Klatt's rules for one phone in its phrase context; returns seconds before rate scaling. */
function klattDuration(slots: readonly Slot[], i: number, voice: SpeechVoice): number {
  const s = slots[i]!
  const prev = slots[i - 1]
  const next = slots[i + 1]
  const [inh, min0] = DURATIONS[s.phone] ?? [80, 40]
  const vowel = isVowel(s.phone)
  let min = min0
  let pct = 1

  // Rule 2: phrase-final lengthening of the final syllable's vowel and coda
  if (s.inPhraseFinalSyllable && (vowel || s.role === 'coda')) pct *= 1.4
  // Rule 3: non-phrase-final shortening of vowels
  if (vowel && !s.inPhraseFinalSyllable) pct *= 0.6
  // Rule 4: non-word-final shortening
  if (vowel && !s.inWordFinalSyllable) pct *= 0.85
  // Rule 5: polysyllabic shortening
  if (vowel && s.polysyllabic) pct *= 0.8
  // Rule 6: non-initial consonant shortening
  if (!vowel && !s.wordInitial) pct *= 0.85
  // Rule 7: unstressed shortening (secondary stress counts half)
  if (s.stress === 0) {
    min /= 2
    pct *= vowel ? (s.inWordFinalSyllable ? 0.7 : 0.5) : 0.7
  } else if (s.stress === 2 && vowel) {
    pct *= 0.85
  } else if (vowel) {
    pct *= voice.timing.stressLengthening
  }
  // Rule 8: emphasis
  if (s.emphasis && vowel && s.stress === 1) pct *= 1.4
  // Rule 9: postvocalic context (full effect phrase-finally, half elsewhere)
  if (vowel && next && next.word === s.word) {
    let f = 1
    if (!isVowel(next.phone)) {
      const manner = mannerOf(next.phone)
      const voiced = phonemeInfo(next.phone).kind === 'consonant' && (phonemeInfo(next.phone) as { voiced: boolean }).voiced
      if (manner === 'fricative' && voiced) f = 1.6
      else if (manner === 'stop' && voiced) f = 1.2
      else if (manner === 'nasal') f = 0.85
      else if ((manner === 'stop' || manner === 'affricate') && !voiced) f = 0.7
      else if (manner === 'fricative' && !voiced) f = 0.85
    }
    pct *= s.inPhraseFinalSyllable ? f : 1 + (f - 1) / 2
  } else if (vowel && s.wordFinal && s.inPhraseFinalSyllable) {
    pct *= 1.2 // open syllable at the end of a phrase
  }
  // Rule 10: clusters
  if (vowel) {
    if (next && isVowel(next.phone)) pct *= 1.2
    if (prev && isVowel(prev.phone)) pct *= 0.7
  } else {
    const prevC = !!prev && !isVowel(prev.phone)
    const nextC = !!next && !isVowel(next.phone)
    if (prevC && nextC) pct *= 0.5
    else if (prevC || nextC) pct *= 0.7
  }
  let ms = min + (inh - min) * pct
  // Rule 11: aspiration after a voiceless stop lengthens a stressed vowel or sonorant
  if (s.stress !== 0 && prev && prev.word === s.word && VOICELESS_STOPS.has(prev.phone)) {
    const m = mannerOf(s.phone)
    if (vowel || m === 'approximant' || m === 'lateral') ms += 25
  }
  return ms / 1000
}

const st = (semitones: number) => 2 ** (semitones / 12)

export function planProsody(utt: Utterance, voice: SpeechVoice): SpeechPlan {
  const rate = voice.timing.rate
  const pauseScale = voice.timing.pauseScale
  const segments: PlanSegment[] = []
  const pitch: PitchPoint[] = []
  const words: PlanWord[] = []
  const sentences: PlanSentence[] = []
  const P = voice.pitch
  let t = 0

  const pause = (seconds: number) => {
    const duration = (seconds * pauseScale) / Math.sqrt(rate)
    segments.push({
      phone: PAUSE, start: t, duration, stress: 0, accented: false, role: 'pause', word: -1,
      wordInitial: false, wordFinal: false, phraseFinal: false,
    })
    t += duration
  }

  pause(PAUSE_SECONDS.lead)

  for (const sentence of utt.sentences) {
    const sentenceStart = t
    sentence.phrases.forEach((phrase, phraseIndex) => {
      // Flatten the phrase into slots with their syllable context
      const slots: Slot[] = []
      let syllable = 0
      const totalSyllables = phrase.words.reduce((n, w) => n + w.syllables.length, 0)
      phrase.words.forEach((w, wi) => {
        const wordIndex = words.length + wi
        const accentable = !w.isFunction || w.emphasis
        w.syllables.forEach((syl, si) => {
          const phones = syllablePhones(syl)
          phones.forEach((ph, pi) => {
            const role = pi < syl.onset.length ? 'onset' : pi === syl.onset.length ? 'nucleus' : 'coda'
            slots.push({
              phone: ph.id,
              stress: syl.stress,
              accented: accentable && syl.stress === 1,
              emphasis: w.emphasis,
              role,
              word: wordIndex,
              wordInitial: si === 0 && pi === 0,
              wordFinal: si === w.syllables.length - 1 && pi === phones.length - 1,
              inWordFinalSyllable: si === w.syllables.length - 1,
              inPhraseFinalSyllable: syllable === totalSyllables - 1,
              polysyllabic: w.syllables.length > 1,
              syllable,
            })
          })
          syllable++
        })
      })

      // Timing
      const phraseStart = t
      const sylTimes: { start: number; nucleusStart: number; nucleusEnd: number; accented: boolean; emphasis: boolean }[] = []
      slots.forEach((s, i) => {
        const duration = klattDuration(slots, i, voice) / rate
        segments.push({
          phone: s.phone, start: t, duration, stress: s.stress, accented: s.accented, role: s.role,
          word: s.word, wordInitial: s.wordInitial, wordFinal: s.wordFinal,
          phraseFinal: s.inPhraseFinalSyllable,
        })
        const syl = (sylTimes[s.syllable] ??= { start: t, nucleusStart: t, nucleusEnd: t + duration, accented: s.accented, emphasis: s.emphasis })
        if (s.role === 'nucleus') {
          syl.nucleusStart = t
          syl.nucleusEnd = t + duration
        }
        t += duration
      })
      // Word timing
      phrase.words.forEach((w) => {
        const idx = words.length
        const segs = segments.filter((sg) => sg.word === idx)
        words.push({
          text: w.text,
          start: segs[0]?.start ?? t,
          end: segs.length ? segs[segs.length - 1]!.start + segs[segs.length - 1]!.duration : t,
          phones: w.phones.map((p) => p.id).join(' '),
        })
      })
      const phraseEnd = t

      // Pitch: declining baseline, accents with downstep, terminal tone
      const reset = phraseIndex === 0 ? 1 : 0.97
      const baseline = (time: number) => P.baseHz * reset * st(-P.declination * (time - phraseStart))
      const isFinalPhrase = phrase.boundary === 'sentence'
      const yesNo = isFinalPhrase && sentence.type === 'question' && !sentence.whQuestion
      const excl = sentence.type === 'exclamation' ? 1.25 : 1
      const accented = sylTimes.map((s, i) => ({ ...s, i })).filter((s) => s.accented)
      // A phrase with no content word still gets its last stressed syllable as nucleus
      if (accented.length === 0 && sylTimes.length) {
        const last = sylTimes.length - 1
        accented.push({ ...sylTimes[last]!, i: last })
      }
      pitch.push({ time: phraseStart, hz: baseline(phraseStart) })
      accented.forEach((a, k) => {
        const nuclear = k === accented.length - 1
        const down = 0.85 ** k
        let size = P.accentSemitones * excl * (nuclear ? 1.15 : 0.85 * down)
        if (a.emphasis) size *= 1.6
        const peakT = a.nucleusStart + 0.6 * (a.nucleusEnd - a.nucleusStart)
        if (nuclear && yesNo) {
          // low nuclear accent, then the rise
          pitch.push({ time: a.start, hz: baseline(a.start) })
          pitch.push({ time: peakT, hz: baseline(peakT) * st(-1) })
          return
        }
        pitch.push({ time: a.start, hz: baseline(a.start) })
        pitch.push({ time: peakT, hz: baseline(peakT) * st(size) })
        if (!nuclear) {
          const after = Math.min(a.nucleusEnd + 0.06, phraseEnd)
          pitch.push({ time: after, hz: baseline(after) * st(size * 0.35) })
        }
      })
      let endHz: number
      if (yesNo) endHz = baseline(phraseEnd) * st(P.questionRise)
      else if (isFinalPhrase) endHz = baseline(phraseEnd) * st(-P.finalFall)
      else if (phrase.boundary === 'comma') endHz = baseline(phraseEnd) * st(Math.min(2, P.accentSemitones * 0.5))
      else endHz = baseline(phraseEnd) * st(Math.min(1, P.accentSemitones * 0.25))
      pitch.push({ time: phraseEnd, hz: endHz })

      pause(PAUSE_SECONDS[phrase.boundary])
    })
    sentences.push({ text: sentence.text, type: sentence.type, start: sentenceStart, end: t })
  }

  if (segments.length === 1) pause(PAUSE_SECONDS.tail)
  else {
    // the last boundary's pause doubles as trailing silence
    const last = segments[segments.length - 1]!
    const want = (PAUSE_SECONDS.tail * pauseScale) / Math.sqrt(rate)
    if (last.duration < want) {
      t += want - last.duration
      last.duration = want
    }
  }

  // keep pitch points strictly ordered (accents can land on the same instant)
  pitch.sort((a, b) => a.time - b.time)
  return { duration: t, segments, pitch, words, sentences }
}
