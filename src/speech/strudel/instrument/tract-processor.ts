/**
 * The Strudel voice instrument, articulatory version: an AudioWorklet that speaks through a
 * Kelly-Lochbaum waveguide model of the vocal tract (44 sections from glottis to lips, a 28-section
 * nose coupled through the velum), after Pink Trombone (Neil Thapen, 2017, MIT licence; the
 * scattering, nose junction, turbulence and transient code follows its Tract.js, re-written here
 * so it can run inside the worklet).
 *
 * The control track does not carry formants: it carries articulation. A vowel substrate (four
 * smooth deformation modes of the tube, after Story & Titze 1998), up to three consonant
 * constrictions (place, degree, activation) with lip narrowing, the velum opening, voicing,
 * aspiration and frication. The area function is rebuilt from those every 5 ms; resonances,
 * formant transitions, nasal zeros and the spectra of fricatives follow from the physics.
 *
 * Like processor.ts this function is serialised with toString(): no outside references, worklet
 * globals from globalThis, no class fields.
 */
export function tractProcessorModule(name: string): void {
  const g = globalThis as unknown as {
    sampleRate: number
    currentFrame: number
    AudioWorkletProcessor: new () => { port: MessagePort }
    registerProcessor: (n: string, c: unknown) => void
  }
  const SR = g.sampleRate
  const TWO_PI = 2 * Math.PI
  const N = 44
  const NOSE = 28
  const NOSE_START = N - NOSE + 1
  const LIP_START = 39
  /** track parameters, in the order the encoder writes them, and their integer scale */
  const KEYS = ['f0', 'av', 'ah', 'rd', 'q1', 'q2', 'q3', 'ql', 'i1', 'd1', 'a1', 'w1', 'i2', 'd2', 'a2', 'w2', 'i3', 'd3', 'a3', 'w3', 'lt', 'la', 've', 'ti', 'td', 'tn']
  const SCALE: Record<string, number> = { f0: 10, av: 1000, ah: 1000, rd: 100, q1: 1000, q2: 1000, q3: 1000, ql: 1000, i1: 10, d1: 100, a1: 1000, w1: 100, i2: 10, d2: 100, a2: 1000, w2: 100, i3: 10, d3: 100, a3: 1000, w3: 100, lt: 100, la: 1000, ve: 1000, ti: 10, td: 100, tn: 1000 }
  const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)

  function decodeTrack(text: string): { frames: number; track: Record<string, Float32Array> } {
    const parts = text.split('|')
    const pts = parts.map((p) => {
      let at = 0
      return p.split(' ').map((tok, i) => {
        const c = tok.indexOf(':')
        if (i > 0) at += c >= 0 ? Number(tok.slice(0, c)) : 1
        return [at, Number(c >= 0 ? tok.slice(c + 1) : tok)] as const
      })
    })
    const frames = Math.max(...pts.map((p) => p[p.length - 1]![0])) + 1
    const track: Record<string, Float32Array> = {}
    KEYS.forEach((k, j) => {
      const a = new Float32Array(frames)
      const p = pts[j]!
      const sc = SCALE[k] ?? 1
      for (let m = 0; m < p.length; m++) {
        const [t0, v0] = p[m]!
        const [t1, v1] = p[m + 1] ?? [frames - 1, v0]
        for (let t = t0; t <= t1; t++) a[t] = (v0 + ((v1 - v0) * (t - t0)) / Math.max(1, t1 - t0)) / sc
        if (!p[m + 1]) for (let t = t0; t < frames; t++) a[t] = v0 / sc
      }
      track[k] = a
    })
    return { frames, track }
  }

  /** LF flow derivative (Fant 1995), shape from Rd, negative peak -1 */
  function lfPulse() {
    const p = { alpha: 0, e0: 0, eps: 0, shift: 0, delta: 0, te: 0, omega: 0 }
    const setRd = (rdIn: number) => {
      const rd = clamp(rdIn, 0.3, 2.7)
      const ra = -0.01 + 0.048 * rd
      const rk = 0.224 + 0.118 * rd
      const rg = ((rk / 4) * (0.5 + 1.2 * rk)) / (0.11 * rd - ra * (0.5 + 1.2 * rk))
      const tp = 1 / (2 * rg)
      const te = tp + tp * rk
      const eps = 1 / ra
      const shift = Math.exp(-eps * (1 - te))
      const delta = 1 - shift
      const rhs = ((1 / eps) * (shift - 1) + (1 - te) * shift) / delta
      const upper = -(rhs - (te - tp) / 2)
      const omega = Math.PI / tp
      const s = Math.sin(omega * te)
      const alpha = Math.log((-Math.PI * s * upper) / (tp * 2)) / (tp / 2 - te)
      p.e0 = -1 / (s * Math.exp(alpha * te))
      p.alpha = alpha
      p.eps = eps
      p.shift = shift
      p.delta = delta
      p.te = te
      p.omega = omega
    }
    const at = (t: number) => (t > p.te ? (-Math.exp(-p.eps * (t - p.te)) + p.shift) / p.delta : p.e0 * Math.exp(p.alpha * t) * Math.sin(p.omega * t))
    return { p, setRd, at }
  }

  /** RBJ band-pass (constant 0 dB peak) at the tract rate: shapes the glottal noise sources */
  function bandPass(fc: number, q: number, rate: number) {
    const w = (TWO_PI * fc) / rate
    const al = Math.sin(w) / (2 * q)
    const a0 = 1 + al
    const b0 = al / a0
    const a1 = (-2 * Math.cos(w)) / a0
    const a2 = (1 - al) / a0
    const z = { x1: 0, x2: 0, y1: 0, y2: 0 }
    return (x: number) => {
      const y = b0 * x - b0 * z.x2 - a1 * z.y1 - a2 * z.y2
      z.x2 = z.x1
      z.x1 = x
      z.y2 = z.y1
      z.y1 = y
      return y
    }
  }

  /** neutral tube diameter (cm): narrow larynx tube, uniform above */
  const neutral = (i: number) => (i < 4 ? 0.7 : i < 7 ? 1.0 : 1.5)

  interface Options {
    start: number
    track: string
    frameSeconds: number
    rd: number
    jitter: number
    shimmer: number
    breath: number
    flutter: number
    gain: number
    /** waveguide rate: 88200 Hz is a 17 cm tract; scaled by the voice's formant scale */
    tractRate: number
    /** strength of the release transient when a closure opens */
    burst: number
    /** level of the low-frequency wall radiation (voice bar) */
    wall: number
    /** one-pole coefficient of the turbulence low-pass */
    fricLp: number
    seed: number
  }

  const Base = g.AudioWorkletProcessor
  class TractVoice extends Base {
    o: Options
    tr: Record<string, Float32Array>
    frames: number
    d: Float64Array
    R: Float64Array
    L: Float64Array
    jR: Float64Array
    jL: Float64Array
    refl: Float64Array
    newRefl: Float64Array
    nR: Float64Array
    nL: Float64Array
    njR: Float64Array
    njL: Float64Array
    nRefl: Float64Array
    nd: Float64Array
    st: Record<string, number>
    lf: ReturnType<typeof lfPulse>
    aspF: (x: number) => number
    transients: { pos: number; t0: number; strength: number }[]
    done: boolean
    constructor(init: { processorOptions: Options }) {
      super()
      const o = init.processorOptions
      this.o = o
      const t = decodeTrack(o.track)
      this.tr = t.track
      this.frames = t.frames
      this.d = new Float64Array(N)
      this.R = new Float64Array(N)
      this.L = new Float64Array(N)
      this.jR = new Float64Array(N)
      this.jL = new Float64Array(N + 1)
      this.refl = new Float64Array(N)
      this.newRefl = new Float64Array(N)
      this.nR = new Float64Array(NOSE)
      this.nL = new Float64Array(NOSE)
      this.njR = new Float64Array(NOSE)
      this.njL = new Float64Array(NOSE + 1)
      this.nRefl = new Float64Array(NOSE)
      this.nd = new Float64Array(NOSE)
      // the nose (Pink Trombone's shape); its internal reflections are fixed
      for (let i = 0; i < NOSE; i++) {
        const x = 2 * (i / NOSE)
        this.nd[i] = Math.min(1.9, x < 1 ? 0.4 + 1.6 * x : 0.5 + 1.5 * (2 - x))
      }
      for (let i = 1; i < NOSE; i++) {
        const a0 = this.nd[i - 1]! ** 2
        const a1 = this.nd[i]! ** 2
        this.nRefl[i] = (a0 - a1) / (a0 + a1)
      }
      this.lf = lfPulse()
      this.lf.setRd(o.rd)
      this.aspF = bandPass(500, 0.5, o.tractRate)
      this.transients = []
      this.done = false
      this.st = {
        phase: 1, period: SR / 120, amp: 1, rng: o.seed >>> 0 || 1, lp: 0, dc: 0,
        // tract clock: position in tract samples, previous and current tract output
        tpos: 0, y0: 0, y1: 0, tcount: 0, frame: -1, closure: -1, glottal: 0,
        rL: 0, rR: 0, rN: 0, nrL: 0, nrR: 0, nrN: 0, voice: 0, open: 1, lpOut: 0, fn: 0, wall: 0,
      }
      this.shape(0)
      this.shape(0) // twice so old and new reflections agree
    }
    noise(): number {
      let x = this.st.rng!
      let sum = 0
      for (let i = 0; i < 4; i++) {
        x ^= x << 13
        x ^= x >>> 17
        x ^= x << 5
        sum += (x >>> 0) / 4294967296
      }
      this.st.rng = x
      return (sum - 2) * 1.732
    }
    /** area function at frame index i (with interpolation u) and new reflection coefficients */
    shape(fp: number) {
      const tr = this.tr
      const fr = this.frames
      const i = Math.min(fr - 1, Math.floor(fp))
      const u = fp - i
      const v = (k: string) => {
        const a = tr[k]!
        return a[i]! + (a[Math.min(fr - 1, i + 1)]! - a[i]!) * u
      }
      const q1 = v('q1')
      const q2 = v('q2')
      const q3 = v('q3')
      const ql = v('ql')
      const d = this.d
      for (let k = 0; k < N; k++) {
        const x = clamp((k - 4) / (LIP_START - 4), 0, 1)
        let dv = neutral(k)
        if (k >= 4 && k < LIP_START) dv *= Math.exp(q1 * Math.sin(Math.PI * x) + q2 * Math.sin(TWO_PI * x) + q3 * Math.sin(3 * Math.PI * x))
        if (k >= LIP_START) dv *= Math.exp(ql)
        d[k] = clamp(dv, 0.15, 3.5)
      }
      // consonant constrictions: Pink Trombone's cosine-shaped narrowing around the place
      for (let c = 1; c <= 3; c++) {
        const amount = v('a' + c)
        if (amount <= 0.001) continue
        const index = v('i' + c)
        const diameter = v('d' + c)
        const width = (index < 25 ? 10 : index >= 32 ? 5 : 10 - (5 * (index - 25)) / 7) * (v('w' + c) || 1)
        for (let j = -Math.ceil(width) - 1; j < width + 1; j++) {
          const p = Math.round(index) + j
          if (p < 0 || p >= N) continue
          const rel = Math.abs(p - index) - 0.5
          const shrink = rel <= 0 ? 0 : rel > width ? 1 : 0.5 * (1 - Math.cos((Math.PI * rel) / width))
          const target = diameter + (d[p]! - diameter) * shrink
          if (target < d[p]!) d[p] = d[p]! + (target - d[p]!) * amount
        }
      }
      const la = v('la')
      if (la > 0.001) {
        const lt = v('lt')
        for (let k = LIP_START; k < N; k++) d[k] = Math.min(d[k]!, d[k]! + (lt - d[k]!) * la)
      }
      // reflections
      for (let k = 1; k < N; k++) {
        this.refl[k] = this.newRefl[k]!
        const a0 = d[k - 1]! * d[k - 1]!
        const a1 = d[k]! * d[k]!
        const sum = a0 + a1
        this.newRefl[k] = sum > 1e-6 ? (a0 - a1) / sum : 1
      }
      const s = this.st
      s.rL = s.nrL!
      s.rR = s.nrR!
      s.rN = s.nrN!
      const velA = v('ve') ** 2
      const an0 = d[NOSE_START]! ** 2
      const an1 = d[NOSE_START + 1]! ** 2
      const sum = an0 + an1 + velA
      s.nrL = sum > 1e-6 ? (2 * an0 - sum) / sum : 1
      s.nrR = sum > 1e-6 ? (2 * an1 - sum) / sum : 1
      s.nrN = sum > 1e-6 ? (2 * velA - sum) / sum : 1
      // release transient when a full closure opens (velum closed)
      let closure = -1
      for (let k = 0; k < N; k++) if (d[k]! <= 0.05) closure = k
      if (s.closure! > -1 && closure === -1 && velA < 0.05) this.transients.push({ pos: s.closure!, t0: s.tcount!, strength: this.o.burst })
      s.closure = closure
    }
    /** one waveguide step (Pink Trombone's Tract.step), lambda interpolates the reflections */
    step(glottal: number, lambda: number, turb: number, ti: number, td: number): number {
      const R = this.R
      const L = this.L
      const jR = this.jR
      const jL = this.jL
      const s = this.st
      const rate = this.o.tractRate
      // transients: decaying pressure pulses at a released closure
      for (let k = this.transients.length - 1; k >= 0; k--) {
        const tr = this.transients[k]!
        const age = (s.tcount! - tr.t0) / rate
        if (age > 0.2) {
          this.transients.splice(k, 1)
          continue
        }
        const amp = tr.strength * Math.pow(2, -200 * age)
        R[tr.pos] = R[tr.pos]! + amp / 2
        L[tr.pos] = L[tr.pos]! + amp / 2
      }
      // turbulence noise injected just in front of the constriction
      if (turb > 0 && ti >= 2) {
        const thin = clamp(8 * (0.7 - td), 0, 1)
        const open = clamp(30 * (td - 0.3), 0, 1)
        const x = turb * thin * open
        if (x > 0) {
          const i = Math.floor(ti)
          const delta = ti - i
          if (i + 1 < N) {
            R[i + 1] = R[i + 1]! + (x * (1 - delta)) / 2
            L[i + 1] = L[i + 1]! + (x * (1 - delta)) / 2
          }
          if (i + 2 < N) {
            R[i + 2] = R[i + 2]! + (x * delta) / 2
            L[i + 2] = L[i + 2]! + (x * delta) / 2
          }
        }
      }
      jR[0] = L[0]! * 0.75 + glottal
      jL[N] = R[N - 1]! * -0.85
      for (let i = 1; i < N; i++) {
        const r = this.refl[i]! * (1 - lambda) + this.newRefl[i]! * lambda
        const w = r * (R[i - 1]! + L[i]!)
        jR[i] = R[i - 1]! - w
        jL[i] = L[i]! + w
      }
      const nR = this.nR
      const nL = this.nL
      {
        const i = NOSE_START
        let r = s.nrL! * (1 - lambda) + s.rL! * lambda
        jL[i] = r * R[i - 1]! + (1 + r) * (nL[0]! + L[i]!)
        r = s.nrR! * (1 - lambda) + s.rR! * lambda
        jR[i] = r * L[i]! + (1 + r) * (R[i - 1]! + nL[0]!)
        r = s.nrN! * (1 - lambda) + s.rN! * lambda
        this.njR[0] = r * nL[0]! + (1 + r) * (L[i]! + R[i - 1]!)
      }
      for (let i = 0; i < N; i++) {
        R[i] = jR[i]! * 0.999
        L[i] = jL[i + 1]! * 0.999
      }
      const lip = R[N - 1]!
      this.njL[NOSE] = nR[NOSE - 1]! * -0.85
      for (let i = 1; i < NOSE; i++) {
        const w = this.nRefl[i]! * (nR[i - 1]! + nL[i]!)
        this.njR[i] = nR[i - 1]! - w
        this.njL[i] = nL[i]! + w
      }
      for (let i = 0; i < NOSE; i++) {
        nR[i] = this.njR[i]!
        nL[i] = this.njL[i + 1]!
      }
      s.tcount! += 1
      return lip + nR[NOSE - 1]!
    }
    process(_in: Float32Array[][], out: Float32Array[][]): boolean {
      const o = this.o
      const ch = out[0]![0]!
      const tr = this.tr
      const frames = this.frames
      const s = this.st
      const rate = o.tractRate
      const perFrame = o.frameSeconds * rate
      const endT = frames * perFrame
      const ratio = rate / SR
      const first = g.currentFrame
      const f = (k: string, i: number, u: number) => {
        const a = tr[k]!
        return a[i]! + (a[Math.min(frames - 1, i + 1)]! - a[i]!) * u
      }
      for (let k = 0; k < ch.length; k++) {
        const n = first + k - o.start
        if (n < 0) {
          ch[k] = 0
          continue
        }
        if (s.tpos! >= endT) {
          ch[k] = 0
          this.done = true
          continue
        }
        // advance the waveguide to this output sample's time, then interpolate its output
        const target = (n + 1) * ratio
        while (s.tpos! < target) {
          const fp = s.tpos! / perFrame
          const i = Math.min(frames - 1, Math.floor(fp))
          if (i !== s.frame) {
            s.frame = i
            this.shape(i)
          }
          const u = fp - i
          const lambda = u
          // glottal source at the tract rate
          if (s.phase! >= 1) {
            s.phase! -= 1
            const t = s.tpos! / rate
            const fl = 1 + (0.015 * o.flutter * (Math.sin(TWO_PI * 12.7 * t) + Math.sin(TWO_PI * 7.1 * t) + Math.sin(TWO_PI * 4.7 * t))) / 3
            const f0 = Math.max(40, f('f0', i, u) * fl)
            s.period = (rate / f0) * (1 + o.jitter * this.noise())
            s.amp = 1 + o.shimmer * this.noise()
            this.lf.setRd(f('rd', i, u) || o.rd)
          }
          const flow = this.lf.at(s.phase!)
          const open = s.phase! < this.lf.p.te
          s.phase! += 1 / s.period!
          const av = f('av', i, u)
          const ah = f('ah', i, u)
          // glottal noise, band-passed around 500 Hz as in Pink Trombone (white noise into a
          // waveguide with nearly lossless walls comes out as a flat hiss)
          s.lp = this.aspF(this.noise())
          const asp = ah * s.lp * 0.5 + o.breath * av * s.lp * (open ? 0.35 : 0.1)
          const glottal = flow * av * s.amp! * 0.5 + asp
          // frication noise (white, DC-blocked), modulated by the glottal cycle when voiced
          const w = this.noise()
          s.dc = 0.99 * s.dc! + 0.01 * w
          const mod = av > 0.1 ? (open ? 1 : 0.4) : 1
          // turbulence is not white: its spectrum falls above a few kHz (Stevens 1998), so one
          // pole at about 6 kHz before it is injected
          s.fn = o.fricLp * (w - s.dc) + (1 - o.fricLp) * s.fn!
          const turb = 0.66 * s.fn * f('tn', i, u) * mod
          let y = this.step(glottal, lambda, turb, f('ti', i, u), f('td', i, u))
          // voice bar: with the tract closed, a real voice still radiates through the soft walls
          // of the throat and cheeks at low frequencies. The waveguide's walls are rigid, so the
          // pressure just above the glottis is low-passed (~250 Hz) and added to the output.
          s.wall = s.wall! + 0.018 * (this.R[3]! + this.L[3]! - s.wall!)
          y += o.wall * s.wall
          // two cascaded one-pole low-passes against aliasing on the way down to the output rate
          s.lpOut = 0.5 * y + 0.5 * s.lpOut!
          s.y0 = s.y1!
          s.y1 = s.lpOut
          s.tpos! += 1
        }
        const frac = 1 - (s.tpos! - target)
        ch[k] = (s.y0! + (s.y1! - s.y0!) * frac) * o.gain
      }
      if (this.done) this.port.postMessage('done')
      return !this.done
    }
  }
  g.registerProcessor(name, TractVoice)
}
