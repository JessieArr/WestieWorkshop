export type BeatKind = 'boom' | 'tick' | 'and'
export type MeasureStructureId = 'quarters' | 'halves' | 'eighth-eighth-quarter' | 'eighths'

export type PatternStep = {
  kind: BeatKind
  /** Length of this note in quarter-note beats at the current BPM. */
  beats: number
}

export const MEASURE_STRUCTURES: { id: MeasureStructureId; label: string }[] = [
  { id: 'quarters', label: '♩♩♩♩' },
  { id: 'halves', label: '𝅗𝅥 𝅗𝅥' },
  { id: 'eighth-eighth-quarter', label: '♪♪♩♪♪♩' },
  { id: 'eighths', label: '♪♪♪♪♪♪♪♪' },
]

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

