/**
 * Offline rendering: npx tsx scripts/speech/say.ts "Text to say" out.wav [voiceId] [rate] [sampleRate]
 */
import { writeFileSync } from 'node:fs'
import { encodeWav, getVoicePreset, speak, withControls } from '../../src/speech'
import { formatPronunciation } from '../../src/speech/phonemes'
import { loadNodeLexicon } from './lexicon-node'

const [text = 'Hello, this is Continuous speaking.', out = 'speech.wav', voiceId = 'alder', rate = '1', sr = '22050'] =
  process.argv.slice(2)
const voice = withControls(getVoicePreset(voiceId), { rate: Number(rate) })
const result = speak(text, voice, { lexicon: loadNodeLexicon(), sampleRate: Number(sr) })
writeFileSync(out, encodeWav(result.samples, result.sampleRate))
for (const s of result.utterance.sentences)
  for (const p of s.phrases)
    console.log(`[${p.boundary}]`, p.words.map((w) => `${w.text} /${formatPronunciation(w.phones)}/`).join(' '))
console.log(`${out}: ${result.plan.duration.toFixed(2)} s, ${result.plan.segments.length} segments, voice ${voice.id}`)
