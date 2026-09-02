const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.1

export type BeatKind = 'boom' | 'tick'
export type BeatHandler = (time: number, kind: BeatKind) => void

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

export class Metronome {
  bpm = 120
  onBeat: BeatHandler | null = null

  private ctx: AudioContext | null = null
  private noiseBuffer: AudioBuffer | null = null
  private nextNoteTime = 0
  private beat = 0
  private timerId: ReturnType<typeof setTimeout> | null = null

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0
  }

  get isRunning(): boolean {
    return this.timerId !== null
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return
    }

    this.ctx ??= new AudioContext()
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    this.beat = 0
    this.nextNoteTime = this.ctx.currentTime
    this.scheduler()
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
    this.beat = 0
  }

  async destroy(): Promise<void> {
    this.stop()
    if (this.ctx) {
      await this.ctx.close()
      this.ctx = null
    }
    this.noiseBuffer = null
  }

  private scheduler = (): void => {
    const ctx = this.ctx
    if (!ctx) {
      return
    }

    while (this.nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const kind: BeatKind = this.beat % 2 === 0 ? 'boom' : 'tick'
      if (kind === 'boom') {
        this.scheduleBoom(this.nextNoteTime)
      } else {
        this.scheduleSnare(this.nextNoteTime)
      }
      this.onBeat?.(this.nextNoteTime, kind)
      this.beat += 1
      this.nextNoteTime += 60 / this.bpm
    }

    this.timerId = setTimeout(this.scheduler, LOOKAHEAD_MS)
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
