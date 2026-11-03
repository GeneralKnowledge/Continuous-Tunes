/**
 * Node loader for the default lexicon (tests and offline scripts). The browser uses
 * src/speech/lexicon-loader.ts, which lets Vite split the dictionaries into lazy chunks.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dictionary } from 'cmu-pronouncing-dictionary'
import { createLexicon, type Lexicon } from '../../src/speech/lexicon'
import { CUSTOM_LEXICON } from '../../src/speech/custom-lexicon'

let cached: Lexicon | null = null

export function loadNodeLexicon(): Lexicon {
  if (cached) return cached
  const require = createRequire(import.meta.url)
  const britfone = readFileSync(require.resolve('britfone/britfone.main.3.0.1.csv'), 'utf8')
  cached = createLexicon({ britfone, cmu: dictionary, custom: CUSTOM_LEXICON })
  return cached
}
