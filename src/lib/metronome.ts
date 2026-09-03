import type { BeatKind } from './measures'
import {
  MEASURE_PATTERNS,
  MEASURE_START_BEAT,
  nextEventAfter,
  normalizeBeat,
  swungStepBeats,
  type MeasureStructureId,
} from './measures'

export type { BeatKind, MeasureStructureId }

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.1

export type BeatHandler = (time: number, kind: BeatKind, beat: number, audible: boolean) => void

const BOOM = {
  type: 'sine' as const,
  frequency: 92,
  endFrequency: 52,
  duration: 0.16,
  gain: 0.55,
}

const SNARE_BURSTS = [
  { offset: 0, gain: 0.72, duration: 0.09 },
  { offset: 0.012, gain: 0.42, duration: 0.08 },
  { offset: 0.024, gain: 0.24, duration: 0.11 },
] as const

export type TempoRamp = {
  from: number
  to: number
  duration: number
}

export type SkipUnit = 'beats' | 'measures'

export type SkipConfig = {
  every: number
  skip: number
  unit: SkipUnit
}

export type StartOptions = {
  ramp?: TempoRamp
  skip?: SkipConfig
}

export type PhraseLength = 0 | 8 | 12

const ARPEGGIO_HZ = [523.25, 659.25, 783.99, 1046.5] as const

type ActiveRamp = TempoRamp & {
  startTime: number
}

export class Metronome {
  bpm = 120
  onBeat: BeatHandler | null = null
  structure: MeasureStructureId = 'quarters'
  /** Placement of `and` notes between surrounding beats, 0.1–0.9. */
  swing = 0.5

  private ctx: AudioContext | null = null
  private noiseBuffer: AudioBuffer | null = null
  private nextNoteTime = 0
  private stepIndex = 0
  private beatsInMeasure = 0
  private heardBeat = 0
  private heardTime = 0
  private hasHeard = false
  private timerId: ReturnType<typeof setTimeout> | null = null
  private ramp: ActiveRamp | null = null
  private skip: SkipConfig | null = null
  private elapsedBeats = 0
  private phraseLength: PhraseLength = 0
  private phraseBeats = 0
  private nextPhraseTime = 0
  private crashBuffer: AudioBuffer | null = null

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0
  }

  get currentBpm(): number {
    return this.bpmAt(this.currentTime)
  }

  get isRunning(): boolean {
    return this.timerId !== null
  }

  get measureProgress(): number {
    if (!this.isRunning || !this.hasHeard) {
      return 0
    }

    const extra =
      (Math.max(0, this.currentTime - this.heardTime) * Math.max(1, this.bpmAt(this.currentTime))) /
      60
    return normalizeBeat(this.heardBeat + extra) / 4
  }

  get currentBar(): number {
    if (this.phraseLength <= 0) {
      return 1
    }
    if (!this.isRunning) {
      return 1
    }

    const bpm = Math.max(1, this.bpmAt(this.currentTime))
    const beatsAhead = Math.max(0, (this.nextPhraseTime - this.currentTime) * bpm / 60)
    const currentBeat = Math.max(0, this.phraseBeats - beatsAhead)
    return (Math.floor(currentBeat / 4) % this.phraseLength) + 1
  }

  setStructure(structure: MeasureStructureId): void {
    if (this.structure === structure) {
      return
    }
    this.structure = structure
    this.realignUpcoming()
  }

  setSwing(swing: number): void {
    const amount = Math.min(0.9, Math.max(0.1, swing))
    if (Math.abs(this.swing - amount) < 1e-6) {
      return
    }
    this.swing = amount
    this.realignUpcoming()
  }

  setPhraseLength(length: PhraseLength): void {
    this.phraseLength = length
  }

  /** Align the wheel to a note at the moment it is heard. */
  hearBeat(beat: number): void {
    this.heardBeat = normalizeBeat(beat)
    this.heardTime = this.currentTime
    this.hasHeard = true
  }

  private playheadBeat(): number {
    if (!this.hasHeard) {
      return -0.001
    }
    return (
      this.heardBeat +
      (Math.max(0, this.currentTime - this.heardTime) * Math.max(1, this.bpmAt(this.currentTime))) /
        60
    )
  }

  private realignUpcoming(): void {
    if (!this.isRunning) {
      this.stepIndex = 0
      this.beatsInMeasure = 0
      return
    }

    const position = this.playheadBeat()
    const next = nextEventAfter(this.structure, this.swing, position)
    this.stepIndex = next.index
    this.beatsInMeasure = next.beat

    const bpm = Math.max(1, this.bpmAt(this.currentTime))
    let beatsUntil = next.beat - normalizeBeat(Math.max(0, position))
    if (beatsUntil < 1e-4) {
      beatsUntil += 4
    }
    if (!this.hasHeard) {
      beatsUntil = 0
    }
    this.nextNoteTime = this.currentTime + (60 / bpm) * beatsUntil
  }

  bpmAt(time: number): number {
    if (!this.ramp || this.ramp.duration <= 0) {
      return this.bpm
    }

    const progress = Math.min(1, Math.max(0, (time - this.ramp.startTime) / this.ramp.duration))
    return this.ramp.from + (this.ramp.to - this.ramp.from) * progress
  }

  async start(options?: StartOptions): Promise<void> {
    if (this.isRunning) {
      return
    }

    this.ctx ??= new AudioContext()
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    const ramp = options?.ramp
    this.stepIndex = 0
    this.hasHeard = true
    this.heardBeat = 0
    this.heardTime = this.ctx.currentTime
    if (ramp && ramp.duration > 0) {
      this.ramp = { ...ramp, startTime: this.ctx.currentTime }
      this.bpm = ramp.from
    } else {
      this.ramp = null
    }
    this.skip = options?.skip ?? null
    const startBeat = MEASURE_START_BEAT[this.structure]
    this.beatsInMeasure = startBeat
    this.elapsedBeats = startBeat
    this.phraseBeats = 0
    this.nextPhraseTime = this.ctx.currentTime
    const bpm = Math.max(1, this.bpmAt(this.ctx.currentTime))
    this.nextNoteTime = this.ctx.currentTime + (60 / bpm) * startBeat
    this.scheduler()
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
    this.stepIndex = 0
    this.beatsInMeasure = 0
    this.elapsedBeats = 0
    this.phraseBeats = 0
    this.nextPhraseTime = 0
    this.hasHeard = false
    this.heardBeat = 0
    this.heardTime = 0
    this.ramp = null
    this.skip = null
  }

  async destroy(): Promise<void> {
    this.stop()
    if (this.ctx) {
      await this.ctx.close()
      this.ctx = null
    }
    this.noiseBuffer = null
    this.crashBuffer = null
  }

  private scheduler = (): void => {
    const ctx = this.ctx
    if (!ctx) {
      return
    }

    while (this.nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const pattern = MEASURE_PATTERNS[this.structure]
      const step = pattern[this.stepIndex % pattern.length]
      const beat = normalizeBeat(this.beatsInMeasure)
      const audible = !this.isSilentAt(this.elapsedBeats)
      if (audible) {
        if (step.kind === 'boom') {
          this.scheduleBoom(this.nextNoteTime)
        } else if (step.kind === 'tick') {
          this.scheduleSnare(this.nextNoteTime)
        } else {
          this.scheduleAnd(this.nextNoteTime)
        }
      }
      this.onBeat?.(this.nextNoteTime, step.kind, beat, audible)
      const stepIndex = this.stepIndex % pattern.length
      this.stepIndex = (this.stepIndex + 1) % pattern.length
      const bpm = Math.max(1, this.bpmAt(this.nextNoteTime))
      this.bpm = bpm
      const stepBeats = swungStepBeats(pattern, stepIndex, this.swing)
      this.nextNoteTime += (60 / bpm) * stepBeats
      this.beatsInMeasure += stepBeats
      this.elapsedBeats += stepBeats
      if (this.beatsInMeasure >= 4 - 1e-6) {
        this.beatsInMeasure -= 4
      }
    }

    while (this.nextPhraseTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      this.schedulePhraseAccent(this.nextPhraseTime, this.phraseBeats)
      const bpm = Math.max(1, this.bpmAt(this.nextPhraseTime))
      this.nextPhraseTime += 60 / bpm
      this.phraseBeats += 1
    }

    this.timerId = setTimeout(this.scheduler, LOOKAHEAD_MS)
  }

  private isSilentAt(elapsedBeats: number): boolean {
    if (!this.skip) {
      return false
    }

    const unitBeats = this.skip.unit === 'measures' ? 4 : 1
    const playFor = Math.max(1, this.skip.every) * unitBeats
    const skipFor = Math.max(1, this.skip.skip) * unitBeats
    const cycle = playFor + skipFor
    const pos = ((elapsedBeats % cycle) + cycle) % cycle
    return pos >= playFor - 1e-6
  }

  private scheduleBoom(time: number): void {
    const ctx = this.ctx
    if (!ctx) {
      return
    }

    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = BOOM.type
    oscillator.frequency.setValueAtTime(BOOM.frequency, time)
    oscillator.frequency.exponentialRampToValueAtTime(BOOM.endFrequency, time + BOOM.duration)

    gain.gain.setValueAtTime(BOOM.gain, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + BOOM.duration)

    oscillator.connect(gain)
    gain.connect(ctx.destination)

    oscillator.start(time)
    oscillator.stop(time + BOOM.duration)
  }

  private scheduleSnare(time: number): void {
    const ctx = this.ctx
    if (!ctx) {
      return
    }

    const noise = this.getNoiseBuffer(ctx)

    for (const burst of SNARE_BURSTS) {
      const start = time + burst.offset
      const source = ctx.createBufferSource()
      source.buffer = noise

      const highpass = ctx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.setValueAtTime(900, start)

      const bandpass = ctx.createBiquadFilter()
      bandpass.type = 'bandpass'
      bandpass.frequency.setValueAtTime(1800, start)
      bandpass.Q.setValueAtTime(0.85, start)

      const sizzle = ctx.createBiquadFilter()
      sizzle.type = 'highpass'
      sizzle.frequency.setValueAtTime(4500, start)

      const bodyGain = ctx.createGain()
      bodyGain.gain.setValueAtTime(burst.gain, start)
      bodyGain.gain.exponentialRampToValueAtTime(0.001, start + burst.duration)

      const sizzleGain = ctx.createGain()
      sizzleGain.gain.setValueAtTime(burst.gain * 0.35, start)
      sizzleGain.gain.exponentialRampToValueAtTime(0.001, start + burst.duration * 0.7)

      source.connect(highpass)
      highpass.connect(bandpass)
      bandpass.connect(bodyGain)
      bodyGain.connect(ctx.destination)

      source.connect(sizzle)
      sizzle.connect(sizzleGain)
      sizzleGain.connect(ctx.destination)

      source.start(start)
      source.stop(start + burst.duration)
    }

    const body = ctx.createOscillator()
    const bodyGain = ctx.createGain()
    body.type = 'triangle'
    body.frequency.setValueAtTime(210, time)
    body.frequency.exponentialRampToValueAtTime(130, time + 0.07)
    bodyGain.gain.setValueAtTime(0.2, time)
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08)
    body.connect(bodyGain)
    bodyGain.connect(ctx.destination)
    body.start(time)
    body.stop(time + 0.08)
  }

  private scheduleAnd(time: number): void {
    const ctx = this.ctx
    if (!ctx) {
      return
    }

    const noise = this.getNoiseBuffer(ctx)
    const source = ctx.createBufferSource()
    source.buffer = noise

    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.setValueAtTime(6500, time)

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(8500, time)
    bandpass.Q.setValueAtTime(0.7, time)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.38, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.035)

    source.connect(highpass)
    highpass.connect(bandpass)
    bandpass.connect(gain)
    gain.connect(ctx.destination)

    source.start(time)
    source.stop(time + 0.04)

    const ping = ctx.createOscillator()
    const pingGain = ctx.createGain()
    ping.type = 'triangle'
    ping.frequency.setValueAtTime(3800, time)
    ping.frequency.exponentialRampToValueAtTime(2400, time + 0.02)
    pingGain.gain.setValueAtTime(0.1, time)
    pingGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025)
    ping.connect(pingGain)
    pingGain.connect(ctx.destination)
    ping.start(time)
    ping.stop(time + 0.025)
  }

  private schedulePhraseAccent(time: number, beatIndex: number): void {
    if (this.phraseLength === 0) {
      return
    }

    const beatsPerPhrase = this.phraseLength * 4
    const pos = ((beatIndex % beatsPerPhrase) + beatsPerPhrase) % beatsPerPhrase
    const lastMeasureStart = (this.phraseLength - 1) * 4

    if (pos >= lastMeasureStart && pos < lastMeasureStart + 4) {
      this.scheduleArpeggioTone(time, pos - lastMeasureStart)
    }

    if (beatIndex > 0 && pos === 0) {
      this.scheduleCrash(time)
    }
  }

  private scheduleArpeggioTone(time: number, index: number): void {
    const ctx = this.ctx
    if (!ctx) {
      return
    }

    const frequency = ARPEGGIO_HZ[index] ?? ARPEGGIO_HZ[0]
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(frequency, time)
    gain.gain.setValueAtTime(0.28, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(time)
    oscillator.stop(time + 0.24)
  }

  private scheduleCrash(time: number): void {
    const ctx = this.ctx
    if (!ctx) {
      return
    }

    const bpm = Math.max(1, this.bpmAt(time))
    const duration = (60 / bpm) * 2
    const noise = this.getCrashBuffer(ctx)
    const source = ctx.createBufferSource()
    source.buffer = noise

    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.setValueAtTime(700, time)

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(3200, time)
    bandpass.Q.setValueAtTime(0.45, time)

    const sizzle = ctx.createBiquadFilter()
    sizzle.type = 'highpass'
    sizzle.frequency.setValueAtTime(6500, time)

    const bodyGain = ctx.createGain()
    bodyGain.gain.setValueAtTime(0.62, time)
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + duration)

    const sizzleGain = ctx.createGain()
    sizzleGain.gain.setValueAtTime(0.4, time)
    sizzleGain.gain.exponentialRampToValueAtTime(0.001, time + duration)

    source.connect(highpass)
    highpass.connect(bandpass)
    bandpass.connect(bodyGain)
    bodyGain.connect(ctx.destination)

    source.connect(sizzle)
    sizzle.connect(sizzleGain)
    sizzleGain.connect(ctx.destination)

    source.start(time)
    source.stop(time + duration)
  }

  private getCrashBuffer(ctx: AudioContext): AudioBuffer {
    if (this.crashBuffer) {
      return this.crashBuffer
    }

    const length = Math.floor(ctx.sampleRate * 4)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1
    }

    this.crashBuffer = buffer
    return buffer
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) {
      return this.noiseBuffer
    }

    const length = Math.floor(ctx.sampleRate * 0.2)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1
    }

    this.noiseBuffer = buffer
    return buffer
  }
}
