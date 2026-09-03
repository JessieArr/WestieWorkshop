export type BeatKind = 'boom' | 'tick' | 'and'
export type MeasureStructureId =
  | 'quarters'
  | 'halves'
  | 'two-four'
  | 'eighth-eighth-quarter'
  | 'eighths'

export type PatternStep = {
  kind: BeatKind
  /** Length of this note in quarter-note beats at the current BPM. */
  beats: number
}

export const MEASURE_STRUCTURES: { id: MeasureStructureId; label: string }[] = [
  { id: 'quarters', label: '1, 2, 3, 4' },
  { id: 'halves', label: '1, 3' },
  { id: 'two-four', label: '2, 4' },
  { id: 'eighth-eighth-quarter', label: '1&2, 3&4' },
  { id: 'eighths', label: '&1&2&3&4' },
]

/** Beat position (0–4) of the first sounded note in the measure. */
export const MEASURE_START_BEAT: Record<MeasureStructureId, number> = {
  quarters: 0,
  halves: 0,
  'two-four': 1,
  'eighth-eighth-quarter': 0,
  eighths: 0,
}

export const MEASURE_PATTERNS: Record<MeasureStructureId, PatternStep[]> = {
  quarters: [
    { kind: 'boom', beats: 1 },
    { kind: 'tick', beats: 1 },
    { kind: 'boom', beats: 1 },
    { kind: 'tick', beats: 1 },
  ],
  halves: [
    { kind: 'boom', beats: 2 },
    { kind: 'boom', beats: 2 },
  ],
  'two-four': [
    { kind: 'tick', beats: 2 },
    { kind: 'tick', beats: 2 },
  ],
  'eighth-eighth-quarter': [
    { kind: 'boom', beats: 0.5 },
    { kind: 'and', beats: 0.5 },
    { kind: 'tick', beats: 1 },
    { kind: 'boom', beats: 0.5 },
    { kind: 'and', beats: 0.5 },
    { kind: 'tick', beats: 1 },
  ],
  eighths: [
    { kind: 'boom', beats: 0.5 },
    { kind: 'and', beats: 0.5 },
    { kind: 'tick', beats: 0.5 },
    { kind: 'and', beats: 0.5 },
    { kind: 'boom', beats: 0.5 },
    { kind: 'and', beats: 0.5 },
    { kind: 'tick', beats: 0.5 },
    { kind: 'and', beats: 0.5 },
  ],
}

export function structureHasAnd(id: MeasureStructureId): boolean {
  return MEASURE_PATTERNS[id].some((step) => step.kind === 'and')
}

/**
 * Duration until the next event, in quarter-note beats.
 * Swing only moves `and` notes; boom/tick stay on their original grid.
 */
export function swungStepBeats(pattern: PatternStep[], index: number, swing: number): number {
  const length = pattern.length
  const step = pattern[index]
  const next = pattern[(index + 1) % length]
  const prev = pattern[(index - 1 + length) % length]
  const amount = Math.min(0.9, Math.max(0.1, swing))

  if (step.kind !== 'and' && next.kind === 'and') {
    return amount * (step.beats + next.beats)
  }
  if (step.kind === 'and') {
    return (1 - amount) * (prev.beats + step.beats)
  }
  return step.beats
}

export type MeasureEvent = {
  kind: BeatKind
  /** Position in the measure, in quarter-note beats from 0 up to 4. */
  beat: number
}

export function measureEvents(structure: MeasureStructureId, swing: number): MeasureEvent[] {
  const pattern = MEASURE_PATTERNS[structure]
  const events: MeasureEvent[] = []
  let beat = MEASURE_START_BEAT[structure]
  for (let i = 0; i < pattern.length; i++) {
    events.push({ kind: pattern[i].kind, beat: normalizeBeat(beat) })
    beat += swungStepBeats(pattern, i, swing)
  }
  return events
}

export function normalizeBeat(beat: number): number {
  return ((beat % 4) + 4) % 4
}

export function nextEventAfter(
  structure: MeasureStructureId,
  swing: number,
  position: number,
): { index: number; beat: number } {
  const events = measureEvents(structure, swing)
  const upcoming = events.find((event) => event.beat > position + 1e-4)
  if (upcoming) {
    return { index: events.indexOf(upcoming), beat: upcoming.beat }
  }
  return { index: 0, beat: events[0]?.beat ?? 0 }
}

