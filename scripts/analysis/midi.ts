/**
 * A minimal Standard MIDI File reader: note-ons with their time in seconds, enough for drum
 * performances (the Groove MIDI Dataset). Handles format 0/1, running status and tempo changes.
 */
export interface MidiNote {
  time: number
  pitch: number
  velocity: number
}

export interface MidiFile {
  ppq: number
  /** First tempo in BPM (120 when the file has none). */
  bpm: number
  notes: MidiNote[]
}

export function parseMidi(buf: Uint8Array): MidiFile {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let p = 0
  const str = (n: number) => String.fromCharCode(...buf.subarray(p, p + n))
  if (str(4) !== 'MThd') throw new Error('not a MIDI file')
  const headerLen = view.getUint32(4)
  const tracks = view.getUint16(10)
  const ppq = view.getUint16(12)
  p = 8 + headerLen
  // Events in ticks first; tempo changes from any track apply to all
  const tempos: { tick: number; usPerBeat: number }[] = []
  const raw: { tick: number; pitch: number; velocity: number }[] = []
  for (let t = 0; t < tracks; t++) {
    if (str(4) !== 'MTrk') throw new Error('bad track')
    const len = view.getUint32(p + 4)
    p += 8
    const end = p + len
    let tick = 0
    let status = 0
    const vlq = () => {
      let v = 0
      for (;;) {
        const b = buf[p++]!
        v = (v << 7) | (b & 0x7f)
        if (!(b & 0x80)) return v
      }
    }
    while (p < end) {
      tick += vlq()
      let b = buf[p]!
      if (b & 0x80) {
        status = b
        p++
      }
      b = status
      if (b === 0xff) {
        const type = buf[p++]!
        const l = vlq()
        if (type === 0x51) tempos.push({ tick, usPerBeat: (buf[p]! << 16) | (buf[p + 1]! << 8) | buf[p + 2]! })
        p += l
      } else if (b === 0xf0 || b === 0xf7) {
        p += vlq()
      } else {
        const hi = b & 0xf0
        const d1 = buf[p++]!
        const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : buf[p++]!
        if (hi === 0x90 && d2 > 0) raw.push({ tick, pitch: d1, velocity: d2 })
      }
    }
    p = end
  }
  tempos.sort((a, b) => a.tick - b.tick)
  if (tempos.length === 0 || tempos[0]!.tick > 0) tempos.unshift({ tick: 0, usPerBeat: 500000 })
  const toSeconds = (tick: number) => {
    let s = 0
    for (let i = 0; i < tempos.length; i++) {
      const a = tempos[i]!
      const b = tempos[i + 1]
      const until = b && b.tick < tick ? b.tick : tick
      if (until > a.tick) s += ((until - a.tick) / ppq) * (a.usPerBeat / 1e6)
      if (!b || b.tick >= tick) break
    }
    return s
  }
  const notes = raw.map((n) => ({ time: toSeconds(n.tick), pitch: n.pitch, velocity: n.velocity })).sort((a, b) => a.time - b.time)
  return { ppq, bpm: 60e6 / tempos[0]!.usPerBeat, notes }
}
