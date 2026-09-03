<script lang="ts">
  import {
    measureEvents,
    normalizeBeat,
    type BeatKind,
    type MeasureStructureId,
  } from './measures'

  const CX = 110
  const CY = 110
  const RING_R = 80
  const LABEL_R = 104
  const AND_HALF_SPAN = 0.055
  const BEAT_LABELS = [1, 2, 3, 4] as const

  type Props = {
    structure: MeasureStructureId
    swing: number
    progress: number
    pulsing: boolean
    pulseKind: BeatKind
    pulseBeat: number | null
    playing: boolean
  }

  let {
    structure,
    swing,
    progress,
    pulsing,
    pulseKind,
    pulseBeat,
    playing,
  }: Props = $props()

  const events = $derived(measureEvents(structure, swing))
  const andEvents = $derived(events.filter((event) => event.kind === 'and'))
  const noteEvents = $derived(events.filter((event) => event.kind !== 'and'))
  const needleBeat = $derived(progress * 4)
  const needle = $derived(needlePoints(needleBeat))
  const progressArc = $derived(
    playing && progress > 0.002 ? ringArc(0, needleBeat, RING_R) : '',
  )

  function polar(beat: number, radius: number): { x: number; y: number } {
    const theta = (normalizeBeat(beat) / 4) * Math.PI * 2
    return {
      x: CX + radius * Math.sin(theta),
      y: CY - radius * Math.cos(theta),
    }
  }

  function ringArc(fromBeat: number, toBeat: number, radius: number): string {
    let span = toBeat - fromBeat
    if (span < 0) {
      span += 4
    }
    if (span < 1e-4) {
      return ''
    }

    const start = polar(fromBeat, radius)
    const end = polar(toBeat, radius)
    const large = span > 2 ? 1 : 0
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`
  }

  function andSectionPath(beat: number): string {
    return ringArc(beat - AND_HALF_SPAN, beat + AND_HALF_SPAN, RING_R)
  }

  function needlePoints(beat: number): string {
    const tip = polar(beat, RING_R + 14)
    const inward = polar(beat, RING_R - 2)
    const left = {
      x: inward.x + (inward.y - CY) * 0.085,
      y: inward.y - (inward.x - CX) * 0.085,
    }
    const right = {
      x: inward.x - (inward.y - CY) * 0.085,
      y: inward.y + (inward.x - CX) * 0.085,
    }
    return `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`
  }

  function isPulsing(kind: BeatKind, beat: number): boolean {
    if (!pulsing || pulseBeat === null || kind !== pulseKind) {
      return false
    }
    const delta = Math.abs(normalizeBeat(beat) - normalizeBeat(pulseBeat))
    return Math.min(delta, 4 - delta) < 0.08
  }

  function primaryKind(beatNumber: number): BeatKind | null {
    const target = beatNumber - 1
    const match = noteEvents.find((event) => Math.abs(event.beat - target) < 0.05)
    return match?.kind ?? null
  }
</script>

<svg class="wheel" viewBox="0 0 220 220" aria-hidden="true">
  <circle class="track" cx={CX} cy={CY} r={RING_R} />

  {#if progressArc}
    <path class="progress" d={progressArc} />
  {/if}

  {#each andEvents as event (event.beat)}
    <path
      class="and-section"
      class:hit={isPulsing('and', event.beat)}
      d={andSectionPath(event.beat)}
    />
  {/each}

  {#each noteEvents as event (`${event.kind}-${event.beat}`)}
    {@const point = polar(event.beat, RING_R)}
    <g transform="translate({point.x} {point.y})">
      <g class="note {event.kind}" class:hit={isPulsing(event.kind, event.beat)}>
        <circle r="8" />
      </g>
    </g>
  {/each}

  {#each BEAT_LABELS as beatNumber}
    {@const point = polar(beatNumber - 1, LABEL_R)}
    {@const kind = primaryKind(beatNumber)}
    <text
      class="beat-label"
      class:boom={kind === 'boom'}
      class:tick={kind === 'tick'}
      class:hit={kind !== null && isPulsing(kind, beatNumber - 1)}
      x={point.x}
      y={point.y}
      dy="0.35em"
    >
      {beatNumber}
    </text>
  {/each}

  <polygon class="needle" class:active={playing} points={needle} />
</svg>

<style>
  .wheel {
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .track {
    fill: none;
    stroke: var(--border);
    stroke-width: 6;
  }

  .progress {
    fill: none;
    stroke: var(--accent-border);
    stroke-width: 6;
    stroke-linecap: round;
  }

  .and-section {
    fill: none;
    stroke: var(--and);
    stroke-width: 7;
    stroke-linecap: round;
    transition: stroke-width 80ms ease-out;
  }

  .and-section.hit {
    stroke-width: 12;
  }

  .note {
    transform-origin: 0 0;
    transition: transform 80ms ease-out;
  }

  .note circle {
    stroke: var(--bg);
    stroke-width: 2;
  }

  .note.boom circle {
    fill: var(--boom);
  }

  .note.tick circle {
    fill: var(--tick);
  }

  .note.hit {
    transform: scale(1.45);
  }

  .beat-label {
    fill: var(--text);
    font-family: var(--mono);
    font-size: 24px;
    font-weight: 800;
    text-anchor: middle;
    transition: transform 80ms ease-out;
    transform-box: fill-box;
    transform-origin: center;
  }

  .beat-label.boom {
    fill: var(--boom);
  }

  .beat-label.tick {
    fill: var(--tick);
  }

  .beat-label.hit {
    transform: scale(1.2);
  }

  .needle {
    fill: var(--text-h);
    opacity: 0.35;
    transition: opacity 0.2s;
  }

  .needle.active {
    opacity: 1;
  }
</style>
