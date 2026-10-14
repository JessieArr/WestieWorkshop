import {
  measureEvents,
  normalizeBeat,
  type BeatKind,
  type MeasureStructureId,
} from './measures'

const SIZE = 512
const VIEW = 220
const SCALE = SIZE / VIEW
const CX = 110
const CY = 110
const RING_R = 80
const LABEL_R = 104
const AND_HALF_SPAN = 0.055
const BEAT_LABELS = [1, 2, 3, 4] as const

export type WheelArtworkInput = {
  structure: MeasureStructureId
  swing: number
  progress: number
  bpm: number
  bar: number | null
  section: string | null
  playing: boolean
}

const FALLBACK = {
  text: '#6b6375',
  textH: '#08060d',
  bg: '#ffffff',
  border: '#e5e4e7',
  accent: '#aa3bff',
  accentBorder: 'rgba(170, 59, 255, 0.5)',
  boom: '#aa3bff',
  tick: '#e07a1a',
  and: '#8b8494',
}

function palette() {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    text: read('--text', FALLBACK.text),
    textH: read('--text-h', FALLBACK.textH),
    bg: read('--bg', FALLBACK.bg),
    border: read('--border', FALLBACK.border),
    accent: read('--accent', FALLBACK.accent),
    accentBorder: read('--accent-border', FALLBACK.accentBorder),
    boom: read('--boom', FALLBACK.boom),
    tick: read('--tick', FALLBACK.tick),
    and: read('--and', FALLBACK.and),
  }
}

function polar(beat: number, radius: number): { x: number; y: number } {
  const theta = (normalizeBeat(beat) / 4) * Math.PI * 2
  return {
    x: CX + radius * Math.sin(theta),
    y: CY - radius * Math.cos(theta),
  }
}

export async function renderWheelArtwork(input: WheelArtworkInput): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not draw the lock screen artwork')
  }

  const colors = palette()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
  ctx.lineCap = 'round'

  ctx.beginPath()
  ctx.arc(CX, CY, RING_R, 0, Math.PI * 2)
  ctx.strokeStyle = colors.border
  ctx.lineWidth = 6
  ctx.stroke()

  const needleBeat = input.progress * 4
  if (input.playing && input.progress > 0.002) {
    strokeArc(ctx, 0, needleBeat, RING_R, colors.accentBorder, 6)
  }

  const events = measureEvents(input.structure, input.swing)
  for (const event of events) {
    if (event.kind !== 'and') continue
    strokeArc(ctx, event.beat - AND_HALF_SPAN, event.beat + AND_HALF_SPAN, RING_R, colors.and, 7)
  }

  for (const event of events) {
    if (event.kind === 'and') continue
    const point = polar(event.beat, RING_R)
    ctx.beginPath()
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2)
    ctx.fillStyle = event.kind === 'boom' ? colors.boom : colors.tick
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = colors.bg
    ctx.stroke()
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '800 24px ui-monospace, SFMono-Regular, Consolas, monospace'
  for (const beatNumber of BEAT_LABELS) {
    const point = polar(beatNumber - 1, LABEL_R)
    const kind = primaryKind(events, beatNumber)
    ctx.fillStyle = kind === 'boom' ? colors.boom : kind === 'tick' ? colors.tick : colors.text
    ctx.fillText(String(beatNumber), point.x, point.y)
  }

  const tip = polar(needleBeat, RING_R + 14)
  const inward = polar(needleBeat, RING_R - 2)
  const left = {
    x: inward.x + (inward.y - CY) * 0.085,
    y: inward.y - (inward.x - CX) * 0.085,
  }
  const right = {
    x: inward.x - (inward.y - CY) * 0.085,
    y: inward.y + (inward.x - CX) * 0.085,
  }
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(left.x, left.y)
  ctx.lineTo(right.x, right.y)
  ctx.closePath()
  ctx.fillStyle = colors.textH
  ctx.globalAlpha = input.playing ? 1 : 0.35
  ctx.fill()
  ctx.globalAlpha = 1

  const extraLines = (input.bar === null ? 0 : 1) + (input.section === null ? 0 : 1)
  const bpmY = extraLines === 0 ? CY - 6 : extraLines === 1 ? CY - 16 : CY - 26
  ctx.fillStyle = colors.textH
  ctx.font = '800 46px ui-monospace, SFMono-Regular, Consolas, monospace'
  ctx.fillText(String(input.bpm), CX, bpmY)
  ctx.fillStyle = colors.accent
  ctx.font = '700 13px ui-monospace, SFMono-Regular, Consolas, monospace'
  ctx.fillText('BPM', CX, bpmY + 28)
  ctx.fillStyle = colors.text
  ctx.font = '700 12px ui-monospace, SFMono-Regular, Consolas, monospace'
  let detailY = bpmY + 46
  if (input.bar !== null) {
    ctx.fillText(`Bar ${input.bar}`, CX, detailY)
    detailY += 16
  }
  if (input.section !== null) {
    ctx.fillText(input.section, CX, detailY)
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (!blob) {
    throw new Error('Could not encode the lock screen artwork')
  }
  return blob
}

function strokeArc(
  ctx: CanvasRenderingContext2D,
  fromBeat: number,
  toBeat: number,
  radius: number,
  color: string,
  width: number,
): void {
  let span = toBeat - fromBeat
  if (span < 0) span += 4
  if (span < 1e-4) return
  const start = (normalizeBeat(fromBeat) / 4) * Math.PI * 2 - Math.PI / 2
  ctx.beginPath()
  ctx.arc(CX, CY, radius, start, start + (span / 4) * Math.PI * 2)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

function primaryKind(
  events: { kind: BeatKind; beat: number }[],
  beatNumber: number,
): BeatKind | null {
  const target = beatNumber - 1
  const match = events.find((event) => event.kind !== 'and' && Math.abs(event.beat - target) < 0.05)
  return match?.kind ?? null
}
