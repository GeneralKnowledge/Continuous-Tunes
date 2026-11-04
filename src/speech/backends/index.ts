/**
 * Backend registry. Every backend reads the same SpeechPlan, so they can be compared on identical
 * linguistic and prosodic input.
 *
 * - formant:    the reference engine (Klatt-style cascade/parallel), improved from M2 on
 * - formant-m1: the M1 engine frozen as merged, for A/B comparison against the baseline
 * - tract:      experimental articulatory engine (Pink Trombone waveguide driven from the plan)
 * - units:      experimental recorded diphones + TD-PSOLA (needs a unit database, see units/)
 */
import { formantBackend } from './formant'
import { formantM1Backend } from './formant-m1'
import { tractBackend } from './tract'
import { unitsBackend } from './units'
import type { SpeechBackend } from './types'

export const BACKENDS: readonly SpeechBackend[] = [formantBackend, formantM1Backend, tractBackend, unitsBackend]

export function getBackend(id: string): SpeechBackend {
  const b = BACKENDS.find((x) => x.id === id)
  if (!b) throw new Error(`Unknown speech backend: ${id}`)
  return b
}

export type { SpeechBackend, RenderOptions } from './types'
