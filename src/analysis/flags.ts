/**
 * Weakness flags: places where the measurements suggest something a listener should check.
 * Thresholds are genre-relative and deliberately loose; a flag is a question, not a verdict, and
 * no flag is ever "fixed" by chasing its number (see docs/research/musical-quality-audit.md).
 */
import type { AudioAnalysis } from './audio'
import type { SongAnalysis } from './symbolic'

export interface GenreProfile {
  /** The genre's drums imitate players (feel, ghosts, bar-to-bar variation) rather than machines. */
  humanDrums: boolean
  /** Upper bound on played events per second before it reads as busy. */
  maxOnsetsPerSecond: number
  /** The genre is built from repeated loops, so long identical runs are less suspicious. */
  loopBased: boolean
}

export const GENRE_PROFILES: Record<string, GenreProfile> = {
  ambient: { humanDrums: false, maxOnsetsPerSecond: 8, loopBased: false },
  electronic: { humanDrums: false, maxOnsetsPerSecond: 40, loopBased: true },
  minimal: { humanDrums: false, maxOnsetsPerSecond: 30, loopBased: true },
  trance: { humanDrums: false, maxOnsetsPerSecond: 45, loopBased: true },
  house: { humanDrums: true, maxOnsetsPerSecond: 30, loopBased: true },
  dnb: { humanDrums: true, maxOnsetsPerSecond: 45, loopBased: true },
  downtempo: { humanDrums: true, maxOnsetsPerSecond: 20, loopBased: false },
  folk: { humanDrums: true, maxOnsetsPerSecond: 16, loopBased: false },
  lofi: { humanDrums: true, maxOnsetsPerSecond: 16, loopBased: false },
}

export interface Flag {
  id: string
  where: string
  detail: string
}

export function detectFlags(genre: string, sym: SongAnalysis | null, audio: AudioAnalysis | null): Flag[] {
  const p = GENRE_PROFILES[genre] ?? { humanDrums: false, maxOnsetsPerSecond: 30, loopBased: true }
  const out: Flag[] = []
  const add = (id: string, where: string, detail: string) => out.push({ id, where, detail })
  if (sym) {
    for (const [i, s] of sym.sections.entries()) {
      const where = `${i}:${s.role}`
      if (s.drums && s.bars >= 8) {
        if (s.drums.distinctPer8 <= (p.humanDrums ? 2 : 1)) add('static-drums', where, `${s.drums.distinctPer8} distinct drum bars per 8 (human drummers: ~6–7)`)
        if (p.humanDrums && s.drums.velocitySpread < 0.03) add('machine-velocity', where, `drum velocity spread ${s.drums.velocitySpread} (GMD: 0.1–0.2 of the mean)`)
        if (p.humanDrums && s.drums.timingSpreadMs < 1) add('grid-locked', where, 'no micro-timing on any drum hit')
        if (p.humanDrums && s.drums.ghostShare < 0.05 && (s.density.snare ?? 0) > 0) add('no-ghosts', where, `ghost share ${s.drums.ghostShare} (GMD funk 0.41, hip-hop 0.27)`)
      }
      if (s.melody && s.bars >= 8 && s.melody.velocitySpread < 0.02) add('flat-melody-dynamics', where, 'every melody note at the same level')
      const r = s.relations
      if (r.bassOnKick !== null && genre !== 'dnb' && genre !== 'lofi' && genre !== 'folk' && r.bassOnKick > 0.5 && ['house', 'trance', 'minimal', 'electronic'].includes(genre)) add('bass-on-kick', where, `${r.bassOnKick} of bass notes land on kicks in a genre that steers around them`)
      if (r.counterWithMelody !== null && r.counterWithMelody > 0.5) add('counter-collides', where, `${r.counterWithMelody} of counter notes start with a melody note`)
      if (r.melodyCounterGap !== null && Math.abs(r.melodyCounterGap) < 3) add('register-clash', where, `melody and counter ${r.melodyCounterGap} semitones apart`)
    }
    const run = sym.song.longestLoopRun
    if (run >= (p.loopBased ? 24 : 16)) add('unchanged-loop', 'song', `${run} bars where every layer repeats the same loop exactly`)
    if (sym.song.sectionContrast < 0.05) add('weak-section-contrast', 'song', `adjacent sections differ by ${sym.song.sectionContrast}`)
    if (sym.song.materialContrast !== null && sym.song.materialContrast < 0.04) add('weak-material-contrast', 'song', `A and B sections differ by ${sym.song.materialContrast}`)
    const mb = sym.song.melodyBars
    if (mb.distinct > 0 && mb.distinct <= 2) add('melody-static', 'song', `only ${mb.distinct} distinct melody bars in the song`)
    if (mb.distinct >= 4 && mb.novel > 0.6) add('melody-unrelated', 'song', `${mb.novel} of the distinct melody bars resemble no other (little motif development)`)
    if (sym.song.onsetsPerSecond > p.maxOnsetsPerSecond) add('busy', 'song', `${sym.song.onsetsPerSecond} events/s (genre guide ≤ ${p.maxOnsetsPerSecond})`)
    for (const t of sym.transitions) {
      if (Math.abs(t.densityChange) > 0.6 && !t.prepared) add('unprepared-transition', `${t.from}→${t.to}`, `density ${t.densityChange > 0 ? '+' : ''}${Math.round(t.densityChange * 100)}% with no fill, riser or crash`)
    }
  }
  if (audio) {
    if (audio.tempo.error !== null && Math.abs(audio.tempo.error) > 2) add('tempo-unclear', 'audio', `heard ${audio.tempo.bpm} BPM, written ${audio.tempo.expected}`)
    if (audio.tempo.windowStd > 2) add('tempo-unstable', 'audio', `tempo estimate wanders ±${audio.tempo.windowStd} BPM between 12 s windows`)
    if (audio.loudness.overShare > 1e-4) add('over-full-scale', 'audio', `${(audio.loudness.overShare * 100).toFixed(2)}% of samples at or past full scale (peak +${audio.loudness.peakDb} dBFS)`)
    for (const [i, s] of audio.sections.entries()) {
      if (s.end - s.start >= 12 && s.barSelfSimilarity > 0.998) add('audio-loop', `${i}:${s.role}`, `bars sound near-identical (similarity ${s.barSelfSimilarity})`)
    }
    if (audio.sections.length > 2 && audio.sectionLoudnessStep < 1) add('flat-loudness-shape', 'audio', `sections differ by only ${audio.sectionLoudnessStep} LU on average`)
  }
  return out
}
