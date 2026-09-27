import { cloneGenome, type MusicGenome } from './genome'
import { validateGenome } from './validation'

/**
 * Soft genre fingerprints applied after mutation.
 * Nudges genomes toward channel identity without freezing evolution.
 */
export function applyChannelFingerprint(channelId: string, genome: MusicGenome): MusicGenome {
  const g = cloneGenome(genome)
  const spb = g.stepsPerBar

  switch (channelId) {
    case 'house': {
      // Four-on-floor: kick on every beat (0, spb/4, …)
      const step = Math.max(1, Math.floor(spb / 4))
      for (let i = 0; i < g.drums.kick.length; i++) {
        if (i % step === 0) g.drums.kick[i] = true
      }
      g.activeLayers.drums = true
      g.activeLayers.bass = true
      // House likes a bit of swing, not none
      if (g.parameters.swing < 0.04) g.parameters.swing = 0.06
      break
    }
    case 'ambient':
    case 'downtempo': {
      // Sparse / no aggressive drums
      g.drums.snare = g.drums.snare.map(() => false)
      g.drums.kick = g.drums.kick.map((on, i) => on && i % spb === 0)
      // Prefer pads + melody
      g.activeLayers.chords = true
      if (g.activeLayers.drums && density(g.drums.hihat) > 0.4) {
        g.drums.hihat = g.drums.hihat.map((on, i) => on && i % 4 === 0)
      }
      break
    }
    case 'minimal': {
      // Keep sparse: thin hihat if too busy
      if (density(g.drums.hihat) > 0.45) {
        g.drums.hihat = g.drums.hihat.map((on, i) => on && i % 2 === 0)
      }
      break
    }
    case 'folk': {
      // Melody-forward; keep drums gentle
      g.activeLayers.melody = true
      if (density(g.drums.kick) > 0.35) {
        g.drums.kick = g.drums.kick.map((on, i) => on && i % 4 === 0)
      }
      break
    }
    case 'electronic':
    default:
      // Keep bass+drums engaged for electronic energy
      if (!g.activeLayers.drums && !g.activeLayers.bass) {
        g.activeLayers.drums = true
        g.activeLayers.bass = true
      }
      break
  }

  return validateGenome(g)
}

function density(arr: boolean[]): number {
  if (arr.length === 0) return 0
  return arr.filter(Boolean).length / arr.length
}
