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

/** One word of a recorded utterance, as frame indices into the audio (frame = `frame` seconds). */
export interface RecordedWord {
  word: string
  start: number
  end: number
}

export interface RecordedWords {
  /** the encoded audio (MP3), base64 */
  audio: string
  /** words in order, in frames */
  words: RecordedWord[]
  /** length of one frame, seconds (Kokoro: 0.025) */
  frame: number
  /** time of the first sound in the audio before encoding, seconds (aligns the decoded audio) */
  lead: number
  text?: string
  /** silence after the utterance before the pattern repeats, seconds (default 0.6) */
  tail?: number
  source?: string
}

/** Pauses at least this long (frames) are written as rests of their own. */
const REST_MIN = 4
/**
 * Each word's sound runs from its start to the next word's start, so played in the recorded rhythm
 * the cuts add up to the original (overlapping cuts doubled consonants: "say bat" → "stay bat").
 * Before a pause it keeps this many frames of the pause, for the release and decay.
 */
const KEEP = 4
/**
 * Neighbouring cuts overlap by twice this (seconds) and cross-fade linearly, so in the recorded
 * rhythm they sum back to the original. (Butt-joined cuts with short fades left a dip that
 * Whisper heard as a stop: "now say" → "now stay".) Every sound starts this much before its step,
 * which only delays the whole pattern.
 */
const XFADE = 0.005
/** Level that marks the first sound, for aligning the decoded audio with the frame times. */
export const ONSET_LEVEL = 0.02

/**
 * A sound name Strudel's mini-notation accepts. (The program writes object keys unquoted or in
 * single quotes: Strudel reads every double-quoted string as a pattern.)
 */
export function soundName(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '') || 'w'
}

/**
 * Strudel code in which every word is its own sound in the bank "ct", cut from the carried audio,
 * and the utterance is an ordinary pattern of those words. The `@` weights reproduce the original
 * timing, so it sounds as recorded until the pattern is changed.
 */
export function compileStrudelWords(r: RecordedWords): { code: string; seconds: number } {
  const ws = r.words
  if (!ws.length) throw new Error('no words')
  const tail = Math.round((r.tail ?? 0.6) / r.frame)
  const counts = new Map<string, number>()
  const slices: Record<string, [number, number][]> = {}
  const steps: string[] = []
  let line: string[] = []
  ws.forEach((w, i) => {
    const name = soundName(w.word)
    const n = counts.get(name) ?? 0
    counts.set(name, n + 1)
    const next = ws[i + 1]
    const id = n ? `${name}:${n}` : name
    const gap = next ? next.start - w.end : tail
    const cut = gap >= REST_MIN ? Math.min(w.end + KEEP, next ? next.start : Infinity) : next ? next.start : w.end + gap
    ;(slices[name] ??= []).push([+(w.start * r.frame - XFADE).toFixed(4), +(cut * r.frame + XFADE).toFixed(4)])
    const rest = (next ? next.start : w.end + tail) - cut
    if (gap >= REST_MIN && rest > 0) {
      // (never write ~@0: Strudel reads a zero weight as 1 and every step after it slips)
      line.push(`${id}@${cut - w.start}`, `~@${rest}`)
      steps.push(line.join(' '))
      line = []
    } else line.push(`${id}@${(next ? next.start : w.end + tail) - w.start}`)
  })
  if (line.length) steps.push(line.join(' '))
  const frames = ws[ws.length - 1]!.end - ws[0]!.start + tail
  const seconds = frames * r.frame
  const header = r.text ? `// "${r.text.replace(/\n/g, ' ')}": played by Strudel\n` : ''
  const code = `${header}// Continuous-Tunes voice${r.source ? ` (${r.source})` : ''}. Every word is its own Strudel sound in the
// bank "ct", cut from the recording below, so the sentence at the end is an ordinary pattern:
// reorder, repeat or drop words, or add .speed() .note() .room() .rev() .ply() and so on.
// One @ step is ${Math.round(r.frame * 1000)} ms; the weights give the recorded rhythm. A repeated word is word:1, word:2 …
const words = { ${Object.entries(slices).map(([w, sp]) => `${/^[a-z]/.test(w) ? w : sq(w)}: ${JSON.stringify(sp)}`).join(', ')} }
const speech = ${sq(r.audio)}
await (async () => {
  const ac = getAudioContext()
  const audio = await ac.decodeAudioData(Uint8Array.from(atob(speech), (c) => c.charCodeAt(0)).buffer)
  const x = audio.getChannelData(0), rate = audio.sampleRate
  let first = 0
  while (first < x.length && Math.abs(x[first]) < ${ONSET_LEVEL}) first++
  const shift = first / rate - ${r.lead.toFixed(4)}
  const wav = (a, b) => {
    const from = Math.round((a + shift) * rate), n = Math.max(1, Math.min(x.length, Math.round((b + shift) * rate)) - from)
    const fade = Math.min(n / 2, rate * ${2 * XFADE}), v = new DataView(new ArrayBuffer(44 + 2 * n))
    const tag = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
    tag(0, 'RIFF'); v.setUint32(4, 36 + 2 * n, true); tag(8, 'WAVEfmt '); v.setUint32(16, 16, true)
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, 2 * rate, true)
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, 2 * n, true)
    for (let i = 0; i < n; i++) {
      const g = Math.min(1, i / fade, (n - 1 - i) / fade)
      v.setInt16(44 + 2 * i, Math.max(-1, Math.min(1, (x[from + i] ?? 0) * g)) * 32767, true)
    }
    return URL.createObjectURL(new Blob([v], { type: 'audio/wav' }))
  }
  await samples(Object.fromEntries(Object.entries(words).map(([w, spans]) => ['ct_' + w, spans.map(([a, b]) => wav(a, b))])))
})()

setcps(1 / ${seconds.toFixed(3)})
s(\`${steps.join('\n   ')}\`).bank("ct")
`
  return { code, seconds }
}
