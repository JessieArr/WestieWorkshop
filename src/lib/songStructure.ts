export type SongStructureId = 'verse-chorus' | 'verse-prechorus-chorus' | 'count-transitions'
export type SongSection = 'verse' | 'prechorus' | 'chorus'

export const SONG_STRUCTURES: { id: SongStructureId; label: string }[] = [
  { id: 'verse-chorus', label: 'Verse, Chorus' },
  { id: 'verse-prechorus-chorus', label: 'Verse, Prechorus, Chorus' },
  { id: 'count-transitions', label: 'Count Transitions' },
]

export function usesArrangement(structure: SongStructureId): boolean {
  return structure !== 'count-transitions'
}


export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function sectionAtPhrase(structure: SongStructureId, phraseIndex: number): SongSection {
  if (structure === 'verse-chorus') {
    return phraseIndex % 2 === 0 ? 'verse' : 'chorus'
  }

  const cycle = phraseIndex % 3
  if (cycle === 0) {
    return 'verse'
  }
  if (cycle === 1) {
    return 'prechorus'
  }
  return 'chorus'
}

export function sectionLabel(section: SongSection): string {
  if (section === 'prechorus') {
    return 'Prechorus'
  }
  return section.charAt(0).toUpperCase() + section.slice(1)
}

/** Legato cello lines — one sustained note per bar. */
const VERSE_CELLO_8: number[] = [55, 57, 59, 57, 55, 52, 50, 55]
const VERSE_CELLO_12: number[] = [55, 57, 59, 60, 59, 57, 55, 52, 50, 52, 53, 55]

function celloLine(phraseBars: number): number[] {
  return phraseBars === 12 ? VERSE_CELLO_12 : VERSE_CELLO_8
}

export type CelloMelodyHit = {
  midi: number
  duration: number
  fadeOut: boolean
}

export type TrumpetMelodyHit = {
  midi: number
  duration: number
  fadeOut: boolean
}

type TrumpetMelodyEntry = TrumpetMelodyHit & { bar: number; beat: number }

export function celloMelodyHit(
  phraseBars: number,
  barInPhrase: number,
  beatInBar: number,
  beatInPhrase: number,
  section: SongSection,
): CelloMelodyHit | null {
  const line = celloLine(phraseBars)
  if (barInPhrase < 0 || barInPhrase >= line.length) {
    return null
  }

  if (section === 'verse' || section === 'prechorus') {
    if (beatInBar !== 0) {
      return null
    }
    return { midi: line[barInPhrase], duration: 4.15, fadeOut: false }
  }

  const beatsPerPhrase = line.length * 4
  if (beatInPhrase >= beatsPerPhrase - 2) {
    return null
  }

  if (beatInBar !== 0 && beatInBar !== 2) {
    return null
  }

  if (beatInBar === 0) {
    return { midi: line[barInPhrase], duration: 2.1, fadeOut: false }
  }

  if (barInPhrase >= line.length - 1) {
    return null
  }

  return { midi: line[barInPhrase + 1], duration: 2.1, fadeOut: false }
}

/** Trumpet chorus line — quarter-note melody (double the verse rate). */
const CHORUS_TRUMPET_8: TrumpetMelodyEntry[] = [
  { bar: 0, beat: 0, midi: 67, duration: 0.92, fadeOut: false },
  { bar: 0, beat: 1, midi: 68, duration: 0.92, fadeOut: false },
  { bar: 0, beat: 2, midi: 69, duration: 0.92, fadeOut: false },
  { bar: 0, beat: 3, midi: 70, duration: 0.92, fadeOut: false },
  { bar: 1, beat: 0, midi: 71, duration: 0.92, fadeOut: false },
  { bar: 1, beat: 1, midi: 72, duration: 0.92, fadeOut: false },
  { bar: 1, beat: 2, midi: 72, duration: 0.92, fadeOut: false },
  { bar: 1, beat: 3, midi: 73, duration: 0.92, fadeOut: false },
  { bar: 2, beat: 0, midi: 74, duration: 0.92, fadeOut: false },
  { bar: 2, beat: 1, midi: 73, duration: 0.92, fadeOut: false },
  { bar: 2, beat: 2, midi: 72, duration: 0.92, fadeOut: false },
  { bar: 2, beat: 3, midi: 71, duration: 0.92, fadeOut: false },
  { bar: 3, beat: 0, midi: 71, duration: 0.92, fadeOut: false },
  { bar: 3, beat: 1, midi: 70, duration: 0.92, fadeOut: false },
  { bar: 3, beat: 2, midi: 69, duration: 0.92, fadeOut: false },
  { bar: 3, beat: 3, midi: 68, duration: 0.92, fadeOut: false },
  { bar: 4, beat: 0, midi: 67, duration: 0.92, fadeOut: false },
  { bar: 4, beat: 1, midi: 68, duration: 0.92, fadeOut: false },
  { bar: 4, beat: 2, midi: 69, duration: 0.92, fadeOut: false },
  { bar: 4, beat: 3, midi: 70, duration: 0.92, fadeOut: false },
  { bar: 5, beat: 0, midi: 71, duration: 0.92, fadeOut: false },
  { bar: 5, beat: 1, midi: 72, duration: 0.92, fadeOut: false },
  { bar: 5, beat: 2, midi: 72, duration: 0.92, fadeOut: false },
  { bar: 5, beat: 3, midi: 73, duration: 0.92, fadeOut: false },
  { bar: 6, beat: 0, midi: 74, duration: 0.92, fadeOut: false },
  { bar: 6, beat: 1, midi: 75, duration: 0.92, fadeOut: false },
  { bar: 6, beat: 2, midi: 76, duration: 0.92, fadeOut: false },
  { bar: 6, beat: 3, midi: 77, duration: 0.92, fadeOut: false },
  { bar: 7, beat: 0, midi: 78, duration: 0.92, fadeOut: false },
  { bar: 7, beat: 1, midi: 79, duration: 0.92, fadeOut: false },
  { bar: 7, beat: 2, midi: 79, duration: 6, fadeOut: true },
]

const CHORUS_TRUMPET_12: TrumpetMelodyEntry[] = [
  ...CHORUS_TRUMPET_8.slice(0, -1),
  { bar: 7, beat: 2, midi: 79, duration: 0.92, fadeOut: false },
  { bar: 7, beat: 3, midi: 78, duration: 0.92, fadeOut: false },
  { bar: 8, beat: 0, midi: 76, duration: 0.92, fadeOut: false },
  { bar: 8, beat: 1, midi: 75, duration: 0.92, fadeOut: false },
  { bar: 8, beat: 2, midi: 74, duration: 0.92, fadeOut: false },
  { bar: 8, beat: 3, midi: 73, duration: 0.92, fadeOut: false },
  { bar: 9, beat: 0, midi: 72, duration: 0.92, fadeOut: false },
  { bar: 9, beat: 1, midi: 71, duration: 0.92, fadeOut: false },
  { bar: 9, beat: 2, midi: 71, duration: 0.92, fadeOut: false },
  { bar: 9, beat: 3, midi: 70, duration: 0.92, fadeOut: false },
  { bar: 10, beat: 0, midi: 69, duration: 0.92, fadeOut: false },
  { bar: 10, beat: 1, midi: 68, duration: 0.92, fadeOut: false },
  { bar: 10, beat: 2, midi: 67, duration: 0.92, fadeOut: false },
  { bar: 10, beat: 3, midi: 66, duration: 0.92, fadeOut: false },
  { bar: 11, beat: 0, midi: 67, duration: 0.92, fadeOut: false },
  { bar: 11, beat: 1, midi: 68, duration: 0.92, fadeOut: false },
  { bar: 11, beat: 2, midi: 69, duration: 0.92, fadeOut: false },
  { bar: 11, beat: 3, midi: 72, duration: 6, fadeOut: true },
]

export function trumpetMelodyHit(
  phraseBars: number,
  barInPhrase: number,
  beatInBar: number,
): TrumpetMelodyHit | null {
  const hits = phraseBars === 12 ? CHORUS_TRUMPET_12 : CHORUS_TRUMPET_8
  const hit = hits.find((entry) => entry.bar === barInPhrase && entry.beat === beatInBar)
  if (!hit) {
    return null
  }
  return { midi: hit.midi, duration: hit.duration, fadeOut: hit.fadeOut }
}

export function isPrechorusAcceleration(
  phraseBars: number,
  barInPhrase: number,
  section: SongSection,
): boolean {
  return section === 'prechorus' && barInPhrase >= phraseBars - 4
}
