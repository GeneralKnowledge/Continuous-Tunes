/**
 * Strudel code that speaks from rendered audio: the voice is synthesised beforehand (for example by
 * a neural TTS, scripts/speech/neural/tts.py) and carried inside the pasted program as compressed
 * audio. Strudel decodes it and plays it as a registered sound, so it runs through Strudel's normal
 * effects chain and scheduler like any other sound (`.speed()`, `.gain()`, `.room()` …).
 */
export interface RecordedSpeech {
  /** the encoded audio (MP3 or Ogg Opus), base64 */
  audio: string
  /** length of the speech, seconds */
  seconds: number
  text?: string
  /** silence after the utterance before the pattern repeats, seconds (default 0.6) */
  tail?: number
  /** source description for the header comment */
  source?: string
}

const sq = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export function compileStrudelRecording(r: RecordedSpeech): { code: string; seconds: number } {
  const seconds = r.seconds + (r.tail ?? 0.6)
  const header = r.text ? `// "${r.text.replace(/\n/g, ' ')}": played by Strudel\n` : ''
  const code = `${header}// Continuous-Tunes voice${r.source ? ` (${r.source})` : ''}: the speech is carried below as compressed audio
// and played by Strudel as a registered sound. Paste into strudel.cc.
const ac = getAudioContext()
const voice = await ac.decodeAudioData(Uint8Array.from(atob(${sq(r.audio)}), (c) => c.charCodeAt(0)).buffer)
registerSound('ctvoice', (t, value, onended) => {
  const node = ac.createBufferSource()
  node.buffer = voice
  node.playbackRate.value = value.speed ?? 1
  node.onended = () => { node.disconnect(); onended() }
  node.start(t)
  return { node, stop: (at) => node.stop(at) }
}, { type: 'sample' })

setcps(${(1 / seconds).toFixed(4)})
s("ctvoice")
`
  return { code, seconds }
}
