/**
 * Acoustics of a Pink Trombone tract shape without running speech through it: the waveguide's
 * impulse response gives the transfer function, whose peaks are the formants. Used offline to fit
 * area functions to formant targets (scripts/speech/fit-tract.ts) and in tests.
 */
import { Tract } from 'pink-trombone-mod/Tract.js'
import type { Glottis } from 'pink-trombone-mod/Glottis.js'
import { fft } from '../../../analysis/audio'

/** Number of main-tract sections in Pink Trombone (glottis = 0, lips = 43). */
export const TRACT_N = 44
export const NOSE_N = 28

/** A silent glottis stub: the tract only asks it for a noise modulator. */
export const QUIET_GLOTTIS = { getNoiseModulator: () => 0 } as unknown as Glottis

/** A fresh tract with the given diameters (cm) and velum opening, reflections settled. */
export function makeTract(diameters: ArrayLike<number>, velum: number, tractRate: number, glottis: Glottis = QUIET_GLOTTIS): Tract {
  const t = new Tract(glottis, tractRate)
  for (let i = 0; i < TRACT_N; i++) t.diameter[i] = diameters[i]!
  shapeNose(t, velum)
  t.calculateNoseReflections()
  t.calculateNewBlockParameters()
  t.calculateNewBlockParameters() // twice so old and new reflections agree
  return t
}

/** Pink Trombone's nose shape (TractShaper.shapeNose), with the velum opening given. */
export function shapeNose(t: Tract, velum: number): void {
  for (let i = 0; i < NOSE_N; i++) {
    const d = 2 * (i / NOSE_N)
    let diameter = i === 0 ? velum : d < 1 ? 0.4 + 1.6 * d : 0.5 + 1.5 * (2 - d)
    t.noseDiameter[i] = Math.min(diameter, 1.9)
  }
}

/** Magnitude response (dB) of the tract from glottis to lips+nose, at `bins` points up to rate/4. */
export function tractResponse(diameters: ArrayLike<number>, velum = 0.01, tractRate = 44100, size = 4096): Float64Array {
  const t = makeTract(diameters, velum, tractRate)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let n = 0; n < size; n++) re[n] = t.step(n === 0 ? 1 : 0, 1)
  fft(re, im)
  const out = new Float64Array(size / 2)
  for (let k = 0; k < size / 2; k++) out[k] = 10 * Math.log10(re[k]! ** 2 + im[k]! ** 2 + 1e-20)
  return out
}

/** The first `count` spectral peaks (formants) of a tract shape, Hz. */
export function tractFormants(diameters: ArrayLike<number>, count = 4, velum = 0.01, tractRate = 44100): number[] {
  const size = 4096
  const r = tractResponse(diameters, velum, tractRate, size)
  const hz = (k: number) => (k * tractRate) / size
  const peaks: number[] = []
  for (let k = 2; k < r.length - 1 && peaks.length < count; k++) {
    if (hz(k) < 120) continue
    if (r[k]! > r[k - 1]! && r[k]! >= r[k + 1]!) {
      // parabolic interpolation of the peak
      const a = r[k - 1]!, b = r[k]!, c = r[k + 1]!
      const p = (0.5 * (a - c)) / (a - 2 * b + c)
      peaks.push(hz(k + p))
    }
  }
  return peaks
}
