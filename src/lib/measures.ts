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
