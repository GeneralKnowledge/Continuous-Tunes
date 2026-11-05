/**
 * Kokoro (82M-parameter neural TTS, Apache 2.0; the int8 ONNX export from sherpa-onnx's
 * kokoro-multi-lang-v1_0 release) run with onnxruntime-web, in the browser or in Node. Used to
 * render the speech that the Strudel neural-voice program carries and plays (strudel/recorded.ts).
 *
 * Assets (scripts/speech/neural/fetch-kokoro.sh puts them in public/models/kokoro/):
 *   model.int8.onnx  the network (≈114 MB)
 *   voice.bin        one speaker's style table, 510 × 256 float32 (bm_george by default)
 *   tokens.txt       symbol → id
 *   lexicon-gb-en.txt  British English pronunciations in misaki notation
 */
import type { InferenceSession } from 'onnxruntime-web'
import type { Utterance } from '../linguistic'
import { kokoroPieces, kokoroTokens, parseLexicon, parseTokens, type KokoroPiece, type KokoroVocab } from './kokoro-text'

export const KOKORO_RATE = 24000
/** samples per duration frame of the network's output */
export const KOKORO_HOP = 600
const MAX_TOKENS = 500
const STYLE = 256

export interface KokoroAssets {
  model: Uint8Array
  voice: Float32Array
  tokens: string
  lexicon: string
}

export class Kokoro {
  private readonly ort: typeof import('onnxruntime-web')
  private readonly session: InferenceSession
  private readonly voice: Float32Array
  readonly vocab: KokoroVocab

  private constructor(ort: typeof import('onnxruntime-web'), session: InferenceSession, voice: Float32Array, vocab: KokoroVocab) {
    this.ort = ort
    this.session = session
    this.voice = voice
    this.vocab = vocab
  }

  static async create(assets: KokoroAssets, ort?: typeof import('onnxruntime-web')): Promise<Kokoro> {
    const rt = ort ?? (await import('onnxruntime-web'))
    const session = await rt.InferenceSession.create(assets.model, { executionProviders: ['wasm'] })
    return new Kokoro(rt, session, assets.voice, { tokens: parseTokens(assets.tokens), lexicon: parseLexicon(assets.lexicon) })
  }

  /** Fetch the assets from a base URL (the app serves them under models/kokoro/). */
  static async load(base: string): Promise<Kokoro> {
    const get = async (f: string) => {
      const r = await fetch(base + f)
      if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`)
      return r
    }
    const [model, voice, tokens, lexicon] = await Promise.all([
      get('model.int8.onnx').then((r) => r.arrayBuffer()),
      get('voice.bin').then((r) => r.arrayBuffer()),
      get('tokens.txt').then((r) => r.text()),
      get('lexicon-gb-en.txt').then((r) => r.text()),
    ])
    return Kokoro.create({ model: new Uint8Array(model), voice: new Float32Array(voice), tokens, lexicon })
  }

  /** Speech for an utterance at 24 kHz, one sentence (or phrase, if long) per network call. */
  async speak(utt: Utterance, speed = 1): Promise<Float32Array> {
    return (await this.speakWords(utt, speed)).audio
  }

  /**
   * Speech with the time span of every word, taken from the network's own duration predictions
   * (one frame = KOKORO_HOP samples), so the audio can be cut exactly at word boundaries.
   */
  async speakWords(utt: Utterance, speed = 1): Promise<{ audio: Float32Array; words: WordSpan[] }> {
    const parts: Float32Array[] = []
    const words: WordSpan[] = []
    let at = 0
    for (const s of utt.sentences) {
      const pieces = kokoroPieces({ text: s.text, sentences: [s] }, this.vocab.lexicon).map((p) => ({ ...p, ids: kokoroTokens(p.phonemes, this.vocab.tokens) }))
      for (const chunk of splitPieces(pieces)) {
        const ids = chunk.flatMap((p) => p.ids)
        if (!ids.length) continue
        const { audio, durations } = await this.run(ids, speed)
        // durations[0] is the leading pad token; token k of the chunk is durations[k + 1]
        let frame = durations[0]!
        let k = 1
        for (const p of chunk) {
          const start = frame
          for (let j = 0; j < p.ids.length; j++) frame += durations[k++]!
          if (p.word && frame > start) words.push({ word: p.word, start: at + start * KOKORO_HOP, end: at + frame * KOKORO_HOP })
        }
        parts.push(audio)
        at += audio.length
      }
    }
    const out = new Float32Array(at)
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    return { audio: out, words }
  }

  private async run(ids: number[], speed: number): Promise<{ audio: Float32Array; durations: number[] }> {
    const { Tensor } = this.ort
    const n = Math.min(ids.length, 509)
    const style = this.voice.subarray(n * STYLE, (n + 1) * STYLE)
    const tokens = new Tensor('int64', BigInt64Array.from([0, ...ids, 0].map(BigInt)), [1, ids.length + 2])
    const res = await this.session.run({ tokens, style: new Tensor('float32', Float32Array.from(style), [1, STYLE]), speed: new Tensor('float32', Float32Array.of(speed), [1]) })
    // the export's second output is the predicted frames per token (pads included)
    const dur = res[this.session.outputNames.find((o) => o !== 'audio')!]!.data as BigInt64Array | Int32Array
    return { audio: res.audio!.data as Float32Array, durations: Array.from(dur, Number) }
  }
}

/** Time span of one word in the audio, samples at KOKORO_RATE. */
export interface WordSpan {
  word: string
  start: number
  end: number
}

type TokenPiece = KokoroPiece & { ids: number[] }

/** Group pieces into network calls under the token limit, cutting after punctuation where possible. */
function splitPieces(pieces: TokenPiece[]): TokenPiece[][] {
  const out: TokenPiece[][] = []
  let cur: TokenPiece[] = []
  let n = 0
  let lastBreak = -1
  for (const p of pieces) {
    if (n + p.ids.length > MAX_TOKENS && cur.length) {
      const cut = lastBreak > 0 ? lastBreak : cur.length
      out.push(cur.slice(0, cut))
      cur = cur.slice(cut)
      n = cur.reduce((m, q) => m + q.ids.length, 0)
      lastBreak = -1
    }
    cur.push(p)
    n += p.ids.length
    if (!p.word && /[.,;:!?]/.test(p.phonemes)) lastBreak = cur.length
  }
  out.push(cur)
  return out
}
