import type { MusicGenome } from '../music/genome'
import type { FitnessMetrics } from './fitness'

export interface GenerationRecord {
  index: number
  genome: MusicGenome
  fitness: number
  metrics: FitnessMetrics
  mutationName: string
  description: string
  forceAccepted: boolean
  exploredWorse: boolean
  timestamp: number
}

export interface GenerationHistory {
  records: GenerationRecord[]
  maxSize: number
}

export function createHistory(maxSize = 64): GenerationHistory {
  return { records: [], maxSize }
}

export function pushGeneration(
  history: GenerationHistory,
  record: GenerationRecord,
): GenerationHistory {
  const records = [...history.records, record]
  while (records.length > history.maxSize) {
    records.shift()
  }
  return { ...history, records }
}

export function latestGeneration(history: GenerationHistory): GenerationRecord | undefined {
  return history.records[history.records.length - 1]
}
