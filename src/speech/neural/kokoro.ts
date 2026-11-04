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
import { kokoroPhonemes, kokoroTokens, parseLexicon, parseTokens, type KokoroVocab } from './kokoro-text'

export const KOKORO_RATE = 24000
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
    const parts: Float32Array[] = []
    for (const s of utt.sentences) {
      const ids = kokoroTokens(kokoroPhonemes({ text: s.text, sentences: [s] }, this.vocab.lexicon), this.vocab.tokens)
      const chunks = ids.length <= MAX_TOKENS ? [ids] : splitAtPunctuation(ids, this.vocab.tokens)
      for (const c of chunks) if (c.length) parts.push(await this.run(c, speed))
    }
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }

  private async run(ids: number[], speed: number): Promise<Float32Array> {
    const { Tensor } = this.ort
    const n = Math.min(ids.length, 509)
    const style = this.voice.subarray(n * STYLE, (n + 1) * STYLE)
    const tokens = new Tensor('int64', BigInt64Array.from([0, ...ids, 0].map(BigInt)), [1, ids.length + 2])
    const res = await this.session.run({ tokens, style: new Tensor('float32', Float32Array.from(style), [1, STYLE]), speed: new Tensor('float32', Float32Array.of(speed), [1]) })
    return res.audio!.data as Float32Array
  }
}

/** Split an over-long token run after commas and full stops, keeping each piece under the limit. */
function splitAtPunctuation(ids: number[], tokens: Map<string, number>): number[][] {
  const breaks = new Set(['.', ',', ';', ':', '!', '?'].map((c) => tokens.get(c)))
  const out: number[][] = []
  let cur: number[] = []
  let lastBreak = -1
  for (const id of ids) {
    cur.push(id)
    if (breaks.has(id)) lastBreak = cur.length
    if (cur.length >= MAX_TOKENS) {
      const cut = lastBreak > 0 ? lastBreak : cur.length
      out.push(cur.slice(0, cut))
      cur = cur.slice(cut)
      lastBreak = -1
    }
  }
  out.push(cur)
  return out
}
