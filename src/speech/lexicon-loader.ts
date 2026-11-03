/**
 * Browser loader for the default lexicon. The dictionaries (Britfone ≈ 0.5 MB, CMUdict ≈ 3.6 MB)
 * are dynamic imports, so Vite puts them in their own chunks, fetched the first time speech is used.
 */
import { CUSTOM_LEXICON } from './custom-lexicon'
import { createLexicon, type Lexicon } from './lexicon'

let pending: Promise<Lexicon> | null = null

export function loadLexicon(): Promise<Lexicon> {
  pending ??= (async () => {
    const [brit, cmu] = await Promise.all([
      import('britfone/britfone.main.3.0.1.csv?raw'),
      import('cmu-pronouncing-dictionary'),
    ])
    return createLexicon({ britfone: brit.default, cmu: cmu.dictionary, custom: CUSTOM_LEXICON })
  })()
  pending.catch(() => {
    pending = null
  })
  return pending
}
