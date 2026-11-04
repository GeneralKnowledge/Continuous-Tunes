/**
 * Write the minimal-pair corpus (src/speech/strudel/consonant-corpus.ts) as items.json for
 * render-offline.ts, voice-corpus-style renders and pairs-eval.py.
 *   npx tsx scripts/speech/pairs-items.ts <items.json>
 */
import { writeFileSync } from 'node:fs'
import { analyzeText } from '../../src/speech'
import { pairItems } from '../../src/speech/strudel/consonant-corpus'
import { loadNodeLexicon } from './lexicon-node'

const lexicon = loadNodeLexicon()
const items = pairItems().map((it) => {
  const utt = analyzeText(it.text, { lexicon })
  const word = utt.sentences.flatMap((s) => s.phrases.flatMap((p) => p.words)).find((w) => w.text.toLowerCase() === it.target)
  return { ...it, phones: word?.phones.map((p) => p.id).join(' ') ?? '?' }
})
writeFileSync(process.argv[2] ?? 'pairs.json', JSON.stringify(items, null, 1))
const byWord = new Map(items.map((i) => [i.target, i.phones]))
console.log(items.length, 'items;', [...byWord].map(([w, p]) => `${w} /${p}/`).join(', '))
