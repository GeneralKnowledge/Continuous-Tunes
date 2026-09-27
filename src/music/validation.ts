import {
  BARS_OPTIONS,
  CHORD_VOICINGS,
  OCTAVE_MAX,
  OCTAVE_MIN,
  SCALE_DEGREE_MAX,
  SCALE_DEGREE_MIN,
  SCALE_MODES,
  STEPS_PER_BAR_OPTIONS,
  TEMPO_MAX,
  TEMPO_MIN,
  totalSteps,
  type MusicGenome,
  type ScaleMode,
  type ChordVoicing,
} from './genome'

export class GenomeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenomeValidationError'
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function assertBoolArray(name: string, arr: unknown, len: number): asserts arr is boolean[] {
  if (!Array.isArray(arr) || arr.length !== len) {
    throw new GenomeValidationError(`${name} must be boolean[] of length ${len}`)
  }
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'boolean') {
      throw new GenomeValidationError(`${name}[${i}] must be boolean`)
    }
  }
}

function assertNoteArray(name: string, arr: unknown, len: number): asserts arr is (number | null)[] {
  if (!Array.isArray(arr) || arr.length !== len) {
    throw new GenomeValidationError(`${name} must be (number|null)[] of length ${len}`)
  }
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (v === null) continue
    if (typeof v !== 'number' || !Number.isInteger(v) || v < SCALE_DEGREE_MIN || v > SCALE_DEGREE_MAX) {
      throw new GenomeValidationError(
        `${name}[${i}] must be null or integer ${SCALE_DEGREE_MIN}–${SCALE_DEGREE_MAX}`,
      )
    }
  }
}

function isScaleMode(v: unknown): v is ScaleMode {
  return typeof v === 'string' && (SCALE_MODES as readonly string[]).includes(v)
}

function isChordVoicing(v: unknown): v is ChordVoicing {
  return typeof v === 'string' && (CHORD_VOICINGS as readonly string[]).includes(v)
}

/**
 * Validate a candidate genome. Throws GenomeValidationError on failure.
 * Returns the same object typed as MusicGenome on success.
 */
export function validateGenome(raw: unknown): MusicGenome {
  if (!isObject(raw)) throw new GenomeValidationError('Genome must be an object')

  const { tempo, stepsPerBar, bars, scale, drums, bass, melody, chords, activeLayers, parameters } =
    raw

  if (typeof tempo !== 'number' || !Number.isFinite(tempo) || tempo < TEMPO_MIN || tempo > TEMPO_MAX) {
    throw new GenomeValidationError(`tempo must be ${TEMPO_MIN}–${TEMPO_MAX}`)
  }
  if (
    typeof stepsPerBar !== 'number' ||
    !(STEPS_PER_BAR_OPTIONS as readonly number[]).includes(stepsPerBar)
  ) {
    throw new GenomeValidationError(`stepsPerBar must be one of ${STEPS_PER_BAR_OPTIONS.join(',')}`)
  }
  if (typeof bars !== 'number' || !(BARS_OPTIONS as readonly number[]).includes(bars)) {
    throw new GenomeValidationError(`bars must be one of ${BARS_OPTIONS.join(',')}`)
  }

  if (!isObject(scale)) throw new GenomeValidationError('scale must be an object')
  if (
    typeof scale.root !== 'number' ||
    !Number.isInteger(scale.root) ||
    scale.root < 0 ||
    scale.root > 11
  ) {
    throw new GenomeValidationError('scale.root must be integer 0–11')
  }
  if (!isScaleMode(scale.mode)) {
    throw new GenomeValidationError(`scale.mode must be one of ${SCALE_MODES.join(',')}`)
  }

  const steps = totalSteps({ stepsPerBar, bars })

  if (!isObject(drums)) throw new GenomeValidationError('drums must be an object')
  assertBoolArray('drums.kick', drums.kick, steps)
  assertBoolArray('drums.snare', drums.snare, steps)
  assertBoolArray('drums.hihat', drums.hihat, steps)

  if (!isObject(bass)) throw new GenomeValidationError('bass must be an object')
  assertNoteArray('bass.notes', bass.notes, steps)
  if (
    typeof bass.octave !== 'number' ||
    !Number.isInteger(bass.octave) ||
    bass.octave < OCTAVE_MIN ||
    bass.octave > OCTAVE_MAX
  ) {
    throw new GenomeValidationError(`bass.octave must be ${OCTAVE_MIN}–${OCTAVE_MAX}`)
  }

  if (!isObject(melody)) throw new GenomeValidationError('melody must be an object')
  assertNoteArray('melody.notes', melody.notes, steps)
  if (
    typeof melody.octave !== 'number' ||
    !Number.isInteger(melody.octave) ||
    melody.octave < OCTAVE_MIN ||
    melody.octave > OCTAVE_MAX
  ) {
    throw new GenomeValidationError(`melody.octave must be ${OCTAVE_MIN}–${OCTAVE_MAX}`)
  }

  if (!isObject(chords)) throw new GenomeValidationError('chords must be an object')
  if (!Array.isArray(chords.progression) || chords.progression.length !== bars) {
    throw new GenomeValidationError(`chords.progression must be number[] of length ${bars}`)
  }
  for (let i = 0; i < chords.progression.length; i++) {
    const d = chords.progression[i]
    if (typeof d !== 'number' || !Number.isInteger(d) || d < SCALE_DEGREE_MIN || d > SCALE_DEGREE_MAX) {
      throw new GenomeValidationError(
        `chords.progression[${i}] must be integer ${SCALE_DEGREE_MIN}–${SCALE_DEGREE_MAX}`,
      )
    }
  }
  if (!isChordVoicing(chords.voicing)) {
    throw new GenomeValidationError(`chords.voicing must be one of ${CHORD_VOICINGS.join(',')}`)
  }
  assertBoolArray('chords.rhythm', chords.rhythm, steps)

  if (!isObject(activeLayers)) throw new GenomeValidationError('activeLayers must be an object')
  for (const key of ['drums', 'bass', 'melody', 'chords'] as const) {
    if (typeof activeLayers[key] !== 'boolean') {
      throw new GenomeValidationError(`activeLayers.${key} must be boolean`)
    }
  }

  if (!isObject(parameters)) throw new GenomeValidationError('parameters must be an object')
  if (
    typeof parameters.swing !== 'number' ||
    !Number.isFinite(parameters.swing) ||
    parameters.swing < 0 ||
    parameters.swing > 1
  ) {
    throw new GenomeValidationError('parameters.swing must be 0–1')
  }

  return raw as unknown as MusicGenome
}

/** Soft check — returns true/false instead of throwing. */
export function isValidGenome(raw: unknown): raw is MusicGenome {
  try {
    validateGenome(raw)
    return true
  } catch {
    return false
  }
}
