/**
 * Sound kits: which drum samples and synth voices a genre plays its genome with.
 * Plain data (dirt-samples names and synth settings); the Strudel compiler turns it into code.
 */

export interface DrumKit {
  /** dirt-samples names, `bank:index`. */
  kick: string
  snare: string
  hat: string
  crash: string
  /** High, mid and low toms for fills. */
  toms: readonly [string, string, string]
  hatGain: number
  /** A sampled break stretched to one bar, layered under the drums at mid and full energy. */
  loop?: { sample: string; gain: number }
}

export interface SynthVoice {
  /** Synth waveform: sine, triangle, square, sawtooth or supersaw. */
  sound: string
  gain: number
  /** Low-pass cutoff in Hz at full energy. */
  lpf: number
  /** Filter resonance (lpq). */
  resonance?: number
  /** Filter envelope depth (lpenv), for plucks and acid lines. */
  filterEnv?: number
  attack?: number
  decay?: number
  sustain?: number
  release?: number
  /** FM index, for bell and electric-piano tones. */
  fm?: number
  room?: number
  /** Echo amount; the echo time is a dotted eighth at the song's tempo. */
  delay?: number
  /** Bit depth for a dusty, lo-fi edge (crush). */
  crush?: number
}

export interface SoundKit {
  drums: DrumKit
  bass: SynthVoice
  lead: SynthVoice
  chords: SynthVoice
  /** Loudness trim so every genre plays at about the same level. */
  master: number
}

/** The original sounds: default dirt-samples drums and plain synths. */
export const DEFAULT_KIT: SoundKit = {
  drums: {
    kick: 'bd',
    snare: 'sd',
    hat: 'hh',
    crash: 'cr',
    toms: ['ht', 'mt', 'lt'],
    hatGain: 0.55,
  },
  bass: { sound: 'sawtooth', gain: 0.7, lpf: 1200 },
  lead: { sound: 'triangle', gain: 0.55, lpf: 0 },
  chords: { sound: 'sawtooth', gain: 0.35, lpf: 1200, room: 0.3 },
  master: 1,
}

const TOMS_808 = ['808ht:2', '808mt:2', '808lt:2'] as const

export const KITS: Record<string, SoundKit> = {
  default: DEFAULT_KIT,
  // Electro / acid: 808 drums, a squelchy resonant bass, a plucked arp lead
  electronic: {
    drums: { kick: '808bd:4', snare: '808sd:3', hat: '808hc:1', crash: '808cy:3', toms: TOMS_808, hatGain: 0.5 },
    bass: { sound: 'sawtooth', gain: 0.6, lpf: 900, resonance: 14, filterEnv: 3, decay: 0.18, sustain: 0.2 },
    lead: { sound: 'square', gain: 0.32, lpf: 2600, filterEnv: 2, decay: 0.12, sustain: 0.05, delay: 0.3 },
    chords: { sound: 'sawtooth', gain: 0.22, lpf: 1600, attack: 0.01, decay: 0.25, sustain: 0.3, room: 0.35 },
    master: 0.86,
  },
  // House: a club kick, claps, open hats, organ stabs and a round bass
  house: {
    drums: { kick: 'clubkick:2', snare: 'realclaps:1', hat: '808oh:1', crash: 'cr:1', toms: TOMS_808, hatGain: 0.4 },
    bass: { sound: 'sawtooth', gain: 0.65, lpf: 520, resonance: 2, decay: 0.3, sustain: 0.5 },
    lead: { sound: 'sine', gain: 0.4, lpf: 0, fm: 2.5, decay: 0.4, sustain: 0.2, delay: 0.25 },
    chords: { sound: 'square', gain: 0.24, lpf: 1800, attack: 0.005, decay: 0.22, sustain: 0.15, room: 0.45 },
    master: 0.56,
  },
  // Minimal / dub techno: club kick, rimshots, a sub bass and echoing chord stabs
  minimal: {
    drums: { kick: 'clubkick:1', snare: 'rm:1', hat: 'hh27:2', crash: 'cr:2', toms: TOMS_808, hatGain: 0.35 },
    bass: { sound: 'sine', gain: 0.85, lpf: 300, decay: 0.25, sustain: 0.6 },
    lead: { sound: 'sine', gain: 0.3, lpf: 0, decay: 0.08, sustain: 0, delay: 0.45 },
    chords: { sound: 'sawtooth', gain: 0.26, lpf: 900, resonance: 4, attack: 0.005, decay: 0.15, sustain: 0, room: 0.5, delay: 0.55 },
    master: 0.98,
  },
  // Ambient: soft swelling pads, a glassy lead, lots of space
  ambient: {
    drums: { kick: 'bd:3', snare: 'sn:5', hat: 'hh:6', crash: 'cr:4', toms: ['ht', 'mt', 'lt'], hatGain: 0.3 },
    bass: { sound: 'sine', gain: 0.75, lpf: 400, attack: 0.05, release: 0.8 },
    lead: { sound: 'triangle', gain: 0.45, lpf: 2400, attack: 0.03, release: 0.9, room: 0.7, delay: 0.4 },
    chords: { sound: 'supersaw', gain: 0.22, lpf: 1100, attack: 0.6, release: 1.6, room: 0.85 },
    master: 1.56,
  },
  // Downtempo: laid-back kit, electric piano chords, a warm round bass
  downtempo: {
    drums: { kick: '808bd:9', snare: 'sn:8', hat: 'hh:2', crash: 'cr:3', toms: TOMS_808, hatGain: 0.4 },
    bass: { sound: 'triangle', gain: 0.85, lpf: 650, decay: 0.4, sustain: 0.5 },
    lead: { sound: 'sine', gain: 0.4, lpf: 0, fm: 1.5, decay: 0.5, sustain: 0.2, delay: 0.3, room: 0.3 },
    chords: { sound: 'triangle', gain: 0.4, lpf: 1600, fm: 0.8, attack: 0.01, decay: 0.8, sustain: 0.3, room: 0.4 },
    master: 1,
  },
  // Folk: acoustic-ish drums, a plucked lead and strummed chords
  folk: {
    drums: { kick: 'bd:5', snare: 'sn:2', hat: 'hh:4', crash: 'cr', toms: ['ht', 'mt', 'lt'], hatGain: 0.4 },
    bass: { sound: 'triangle', gain: 0.85, lpf: 900, decay: 0.35, sustain: 0.4 },
    lead: { sound: 'sawtooth', gain: 0.3, lpf: 2200, filterEnv: 1.5, decay: 0.25, sustain: 0.1, room: 0.25 },
    chords: { sound: 'triangle', gain: 0.35, lpf: 2400, attack: 0.005, decay: 0.6, sustain: 0.2, room: 0.35 },
    master: 1.1,
  },
  // Lo-fi hip hop: dusty 808s, crushed electric piano, a soft sine bass
  lofi: {
    drums: { kick: '808bd:2', snare: '808sd:7', hat: '808hc:0', crash: '808cy:1', toms: TOMS_808, hatGain: 0.32 },
    bass: { sound: 'sine', gain: 0.9, lpf: 500, decay: 0.4, sustain: 0.5 },
    lead: { sound: 'sine', gain: 0.35, lpf: 0, fm: 1.2, decay: 0.5, sustain: 0.1, delay: 0.3, crush: 10 },
    chords: { sound: 'triangle', gain: 0.4, lpf: 1300, fm: 0.6, attack: 0.02, decay: 0.9, sustain: 0.35, room: 0.35, crush: 9 },
    master: 1.5,
  },
  // Drum & bass: a stretched break under punchy drums, a growling bass, airy pads
  dnb: {
    drums: {
      kick: 'clubkick:3',
      snare: 'sn:10',
      hat: 'hh27:5',
      crash: 'cr:5',
      toms: TOMS_808,
      hatGain: 0.35,
      loop: { sample: 'breaks165', gain: 0.45 },
    },
    bass: { sound: 'sawtooth', gain: 0.7, lpf: 380, resonance: 6, decay: 0.3, sustain: 0.7 },
    lead: { sound: 'square', gain: 0.25, lpf: 2400, decay: 0.2, sustain: 0.2, delay: 0.35, room: 0.3 },
    chords: { sound: 'supersaw', gain: 0.2, lpf: 1400, attack: 0.3, release: 1, room: 0.6 },
    master: 0.5,
  },
  // Trance: a hard kick, rolling plucked bass, a supersaw lead and big pads
  trance: {
    drums: { kick: 'hardkick:1', snare: 'cp:1', hat: 'hh27:7', crash: 'cr:1', toms: TOMS_808, hatGain: 0.4 },
    bass: { sound: 'sawtooth', gain: 0.6, lpf: 800, filterEnv: 2, decay: 0.12, sustain: 0 },
    lead: { sound: 'supersaw', gain: 0.28, lpf: 3600, attack: 0.01, decay: 0.2, sustain: 0.6, delay: 0.35, room: 0.45 },
    chords: { sound: 'supersaw', gain: 0.2, lpf: 1800, attack: 0.25, release: 0.8, room: 0.7 },
    master: 0.94,
  },
}

export function getKit(id: string): SoundKit {
  return KITS[id] ?? DEFAULT_KIT
}
