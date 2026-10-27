/**
 * Song forms: which sections a song has, how long each is relative to the others,
 * and how much energy each carries. One theme genome is rendered at each section's energy.
 */
import type { Rng } from '../lib/rng'

export const SECTION_ROLES = [
  'intro',
  'groove',
  'verse',
  'chorus',
  'build',
  'drop',
  'peak',
  'breakdown',
  'outro',
] as const
export type SectionRole = (typeof SECTION_ROLES)[number]

export const SECTION_LABELS: Record<SectionRole, string> = {
  intro: 'Intro',
  groove: 'Groove',
  verse: 'Verse',
  chorus: 'Chorus',
  build: 'Build',
  drop: 'Drop',
  peak: 'Peak',
  breakdown: 'Breakdown',
  outro: 'Outro',
}

export interface FormSection {
  role: SectionRole
  /** Relative length; scaled to the song's target length. */
  weight: number
  /** Energy 0–1 at the start of the section. */
  energy: number
  /** Energy at the end, for sections that ramp (builds, fades). */
  energyEnd?: number
}

export interface SongTemplate {
  /** Target song length at "medium". */
  minutes: number
  sections: FormSection[]
}

const DRIVING: SongTemplate = {
  minutes: 4.5,
  sections: [
    { role: 'intro', weight: 2, energy: 0.3 },
    { role: 'groove', weight: 2, energy: 0.6 },
    { role: 'build', weight: 1, energy: 0.6, energyEnd: 0.9 },
    { role: 'drop', weight: 4, energy: 1 },
    { role: 'breakdown', weight: 2, energy: 0.35 },
    { role: 'build', weight: 1, energy: 0.5, energyEnd: 0.9 },
    { role: 'drop', weight: 4, energy: 1 },
    { role: 'outro', weight: 2, energy: 0.4, energyEnd: 0.2 },
  ],
}

export const SONG_TEMPLATES: Record<string, SongTemplate> = {
  driving: DRIVING,
  groovy: DRIVING,
  sparse: {
    minutes: 4.5,
    sections: [
      { role: 'intro', weight: 2, energy: 0.25 },
      { role: 'groove', weight: 4, energy: 0.5 },
      { role: 'peak', weight: 4, energy: 0.75 },
      { role: 'breakdown', weight: 2, energy: 0.3 },
      { role: 'groove', weight: 4, energy: 0.55 },
      { role: 'outro', weight: 2, energy: 0.3, energyEnd: 0.15 },
    ],
  },
  lush: {
    minutes: 7,
    sections: [
      { role: 'intro', weight: 2, energy: 0.2, energyEnd: 0.4 },
      { role: 'verse', weight: 4, energy: 0.5 },
      { role: 'peak', weight: 3, energy: 0.75 },
      { role: 'verse', weight: 3, energy: 0.55 },
      { role: 'outro', weight: 3, energy: 0.45, energyEnd: 0.15 },
    ],
  },
  chill: {
    minutes: 6,
    sections: [
      { role: 'intro', weight: 2, energy: 0.25 },
      { role: 'verse', weight: 3, energy: 0.5 },
      { role: 'chorus', weight: 3, energy: 0.75 },
      { role: 'verse', weight: 3, energy: 0.5 },
      { role: 'chorus', weight: 3, energy: 0.8 },
      { role: 'outro', weight: 2, energy: 0.3, energyEnd: 0.15 },
    ],
  },
  dusty: {
    minutes: 3,
    sections: [
      { role: 'intro', weight: 1, energy: 0.3 },
      { role: 'verse', weight: 2, energy: 0.55 },
      { role: 'chorus', weight: 2, energy: 0.75 },
      { role: 'verse', weight: 2, energy: 0.55 },
      { role: 'chorus', weight: 2, energy: 0.8 },
      { role: 'outro', weight: 1, energy: 0.3, energyEnd: 0.15 },
    ],
  },
  rolling: {
    minutes: 5,
    sections: [
      { role: 'intro', weight: 2, energy: 0.3, energyEnd: 0.5 },
      { role: 'build', weight: 1, energy: 0.55, energyEnd: 0.9 },
      { role: 'drop', weight: 4, energy: 1 },
      { role: 'breakdown', weight: 2, energy: 0.35 },
      { role: 'build', weight: 1, energy: 0.5, energyEnd: 0.9 },
      { role: 'drop', weight: 4, energy: 1 },
      { role: 'outro', weight: 2, energy: 0.4, energyEnd: 0.2 },
    ],
  },
  euphoric: {
    minutes: 7,
    sections: [
      { role: 'intro', weight: 2, energy: 0.35 },
      { role: 'groove', weight: 3, energy: 0.6 },
      { role: 'breakdown', weight: 3, energy: 0.3, energyEnd: 0.5 },
      { role: 'build', weight: 1, energy: 0.6, energyEnd: 0.95 },
      { role: 'drop', weight: 4, energy: 1 },
      { role: 'groove', weight: 2, energy: 0.65 },
      { role: 'outro', weight: 2, energy: 0.4, energyEnd: 0.2 },
    ],
  },
  folk: {
    minutes: 4,
    sections: [
      { role: 'intro', weight: 1, energy: 0.3 },
      { role: 'verse', weight: 3, energy: 0.5 },
      { role: 'chorus', weight: 2, energy: 0.8 },
      { role: 'verse', weight: 3, energy: 0.5 },
      { role: 'chorus', weight: 2, energy: 0.85 },
      { role: 'outro', weight: 1, energy: 0.3, energyEnd: 0.2 },
    ],
  },
}

export const SONG_LENGTHS = ['short', 'medium', 'long'] as const
export type SongLength = (typeof SONG_LENGTHS)[number]

const LENGTH_SCALE: Record<SongLength, number> = { short: 0.6, medium: 1, long: 1.5 }

export function getSongTemplate(personalityId: string): SongTemplate {
  return SONG_TEMPLATES[personalityId] ?? DRIVING
}

/** A form section with its length fixed in bars. */
export interface PlannedSection {
  role: SectionRole
  bars: number
  energy: number
  energyEnd?: number
}

/**
 * Turn a template into sections with bar counts for a tempo and song length.
 * Each section is a multiple of 4 bars (at least 4) so phrases stay even.
 */
export function planForm(template: SongTemplate, tempo: number, length: SongLength): PlannedSection[] {
  const targetBars = (template.minutes * LENGTH_SCALE[length] * tempo) / 4
  const totalWeight = template.sections.reduce((a, s) => a + s.weight, 0)
  return template.sections.map((s) => ({
    role: s.role,
    bars: Math.max(4, Math.round((targetBars * s.weight) / totalWeight / 4) * 4),
    energy: s.energy,
    ...(s.energyEnd !== undefined ? { energyEnd: s.energyEnd } : {}),
  }))
}

/** The sections a song builds towards; they play the contrast material. */
export const HIGHLIGHT_ROLES: ReadonlySet<SectionRole> = new Set<SectionRole>(['drop', 'peak', 'chorus'])

const formBars = (form: readonly PlannedSection[]) => form.reduce((a, s) => a + s.bars, 0)

/** Intro first, outro last, every build leads into a highlight, and at least one highlight. */
function formHolds(form: readonly PlannedSection[], targetBars: number): boolean {
  const total = formBars(form)
  return (
    form[0]?.role === 'intro' &&
    form[form.length - 1]?.role === 'outro' &&
    form.some((s) => HIGHLIGHT_ROLES.has(s.role)) &&
    form.every((s, i) => s.role !== 'build' || HIGHLIGHT_ROLES.has(form[i + 1]?.role as SectionRole)) &&
    total >= targetBars * 0.75 &&
    total <= targetBars * 1.35
  )
}

const round = (x: number) => Number(x.toFixed(2))

/**
 * A variation on a planned form for the next song, inside the genre's template: a section
 * stretched or trimmed by a phrase, repeated or left out, or its energy nudged.
 * Intro, outro and the builds into highlights stay. Returns the new form and what changed.
 */
export function varyForm(
  form: readonly PlannedSection[],
  rng: Rng,
  changes = 1,
): { form: PlannedSection[]; changes: string[] } {
  const target = formBars(form)
  let out = form.map((s) => ({ ...s }))
  const done: string[] = []
  for (let attempt = 0; attempt < 24 && done.length < changes; attempt++) {
    const middle = out.map((_, i) => i).filter((i) => i > 0 && i < out.length - 1)
    if (middle.length === 0) break
    const i = rng.pick(middle)
    const sec = out[i]!
    const label = SECTION_LABELS[sec.role].toLowerCase()
    const next = out.map((s) => ({ ...s }))
    let change = ''
    switch (rng.pick(['stretch', 'trim', 'repeat', 'drop', 'energy'] as const)) {
      case 'stretch':
        if (sec.role === 'build' || sec.bars >= 32) continue
        next[i]!.bars += 4
        change = `longer ${label}`
        break
      case 'trim':
        if (sec.bars < 8) continue
        next[i]!.bars -= 4
        change = `shorter ${label}`
        break
      case 'repeat':
        if (sec.role === 'build') continue
        next.splice(i + 1, 0, { ...sec })
        change = `extra ${label}`
        break
      case 'drop':
        if (HIGHLIGHT_ROLES.has(sec.role) || sec.role === 'build' || out.length <= 4) continue
        next.splice(i, 1)
        change = `no ${label}`
        break
      case 'energy': {
        if (sec.role === 'build' || sec.energyEnd !== undefined) continue
        const [lo, hi] = HIGHLIGHT_ROLES.has(sec.role) ? [0.7, 1] : [0.15, 0.8]
        const e = round(Math.max(lo, Math.min(hi, sec.energy + (rng.chance(0.5) ? 0.1 : -0.1))))
        if (e === sec.energy) continue
        next[i]!.energy = e
        change = `${e > sec.energy ? 'busier' : 'calmer'} ${label}`
        break
      }
    }
    if (!formHolds(next, target)) continue
    out = next
    done.push(change)
  }
  return { form: out, changes: done }
}
