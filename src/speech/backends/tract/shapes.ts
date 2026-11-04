/**
 * Area-function shapes for the articulatory (tract) backend, in Pink Trombone's 44 sections
 * (0 = glottis, 43 = lips). Section diameters are in cm; the waveguide runs at TRACT_RATE, where
 * 44 sections make a 17 cm adult male tract (uniform tube: 500/1500/2500 Hz).
 */
export const TRACT_RATE = 88200
export const N = 44
export const LIP_START = 39

/** Neutral tube: narrow larynx tube above the glottis, uniform elsewhere. */
export function neutral(i: number): number {
  return i < 4 ? 0.7 : i < 7 ? 1.0 : 1.5
}

/** Tract diameters from mode weights [q1, q2, q3, lips] (see fit-tract.ts). */
export function shapeFromParams(p: readonly number[]): Float64Array {
  const d = new Float64Array(N)
  const [q1 = 0, q2 = 0, q3 = 0, lips = 0] = p
  for (let i = 0; i < N; i++) {
    const x = Math.min(1, Math.max(0, (i - 4) / (LIP_START - 4)))
    let v = neutral(i)
    if (i >= 4 && i < LIP_START) v *= Math.exp(q1 * Math.sin(Math.PI * x) + q2 * Math.sin(2 * Math.PI * x) + q3 * Math.sin(3 * Math.PI * x))
    if (i >= LIP_START) v *= Math.exp(lips)
    d[i] = Math.min(3.5, Math.max(0.15, v))
  }
  return d
}
