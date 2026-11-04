/**
 * Render items with the app's own neural path (src/speech/neural/kokoro.ts, onnxruntime-web
 * under Node, our front end for text): the same audio the Speech tab puts into Strudel code.
 *
 *   npx tsx scripts/speech/neural/render.ts <outDir> <items.json> [--speed 1]
 *
 * Needs public/models/kokoro/ (scripts/speech/neural/fetch-kokoro.sh). Writes <outDir>/<id>.wav.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeText, encodeWav } from '../../../src/speech'
import { Kokoro, KOKORO_RATE } from '../../../src/speech/neural/kokoro'
import { loadNodeLexicon } from '../lexicon-node'

const args = process.argv.slice(2)
const si = args.indexOf('--speed')
const speed = si >= 0 ? Number(args.splice(si, 2)[1]) : 1
const [outDir, itemsFile] = args
if (!outDir || !itemsFile) throw new Error('usage: render.ts <outDir> <items.json>')
const dir = 'public/models/kokoro/'
const ort = await import('onnxruntime-web')
ort.env.wasm.numThreads = 1
const k = await Kokoro.create(
  {
    model: new Uint8Array(readFileSync(dir + 'model.int8.onnx')),
    voice: new Float32Array(new Uint8Array(readFileSync(dir + 'voice.bin')).buffer),
    tokens: readFileSync(dir + 'tokens.txt', 'utf8'),
    lexicon: readFileSync(dir + 'lexicon-gb-en.txt', 'utf8'),
  },
  ort,
)
const lexicon = loadNodeLexicon()
mkdirSync(outDir, { recursive: true })
const items: { id: string; text: string }[] = JSON.parse(readFileSync(itemsFile, 'utf8'))
for (const it of items) {
  const audio = await k.speak(analyzeText(it.text, { lexicon }), speed)
  writeFileSync(join(outDir, `${it.id}.wav`), encodeWav(audio, KOKORO_RATE))
}
console.log(`${items.length} rendered to ${outDir}`)
