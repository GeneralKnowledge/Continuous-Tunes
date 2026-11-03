/**
 * Our own entries, checked before Britfone and CMUdict. Keep this small: it is for words both
 * dictionaries get wrong for British English, or that the project needs (its own name).
 */
import { parsePronunciation, type Pronunciation } from './phonemes'

const ENTRIES: Record<string, string[]> = {
  continuous: ['k ə n t ˈɪ n j uː ə s'],
  strudel: ['s t r ˈuː d ə l'],
  formant: ['f ˈɔː m ə n t'],
  formants: ['f ˈɔː m ə n t s'],
  diphone: ['d ˈaɪ f əʊ n'],
  diphones: ['d ˈaɪ f əʊ n z'],
}

export const CUSTOM_LEXICON: Record<string, Pronunciation[]> = Object.fromEntries(
  Object.entries(ENTRIES).map(([w, prons]) => [w, prons.map(parsePronunciation)]),
)
