/**
 * Song forms: which sections a song has, how long each is relative to the others,
 * and how much energy each carries. One theme genome is rendered at each section's energy.
 */

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
