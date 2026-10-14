import type { BeatKind } from './measures'
import {
  MEASURE_PATTERNS,
  MEASURE_START_BEAT,
  nextEventAfter,
  normalizeBeat,
  swungStepBeats,
  type MeasureStructureId,
} from './measures'
import {
  celloMelodyHit,
  isPrechorusAcceleration,
  midiToHz,
  sectionAtPhrase,
  trumpetMelodyHit,
  usesArrangement,
  type SongSection,
  type SongStructureId,
} from './songStructure'

export type { BeatKind, MeasureStructureId }

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.1
const BACKGROUND_AHEAD_S = 120
const VISUAL_AHEAD_S = 0.3

type NoteMark = {
  time: number
  nextNoteTime: number
  stepIndex: number
  beatsInMeasure: number
  elapsedBeats: number
  randomSkipSilent: boolean
  randomSkipBeatsLeft: number
  sources: AudioScheduledSourceNode[]
}

type PhraseMark = {
  time: number
  nextPhraseTime: number
  phraseBeats: number
  sources: AudioScheduledSourceNode[]
}

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

export type RandomSkipConfig = {
  minSkip: number
  maxSkip: number
}

export type StartOptions = {
  ramp?: TempoRamp
  skip?: SkipConfig
  randomSkip?: RandomSkipConfig
}

export type PhraseLength = 0 | 8 | 12

export type { SongStructureId, SongSection } from './songStructure'

const ARPEGGIO_HZ = [523.25, 659.25, 783.99, 1046.5] as const

const RANDOM_SKIP_MIN_PLAY = 4
const RANDOM_SKIP_MAX_PLAY = 16

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

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
  private master: GainNode | null = null
  private streamDest: MediaStreamAudioDestinationNode | null = null
  private outputEl: HTMLAudioElement | null = null
  private speakersConnected = false
  private contextWatcher: (() => void) | null = null
  private noiseBuffer: AudioBuffer | null = null
  private scheduleAheadS = SCHEDULE_AHEAD_S
  private noteMarks: NoteMark[] = []
  private phraseMarks: PhraseMark[] = []
  private nextNoteTime = 0
  private stepIndex = 0
  private beatsInMeasure = 0
  private heardBeat = 0
  private heardTime = 0
  private hasHeard = false
  private timerId: ReturnType<typeof setTimeout> | null = null
  private ramp: ActiveRamp | null = null
  private skip: SkipConfig | null = null
  private randomSkip: RandomSkipConfig | null = null
  private randomSkipSilent = false
  private randomSkipBeatsLeft = 0
  private elapsedBeats = 0
  private phraseLength: PhraseLength = 0
  private phraseBeats = 0
  private nextPhraseTime = 0
  private songStructure: SongStructureId | null = null
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

  get currentSongSection(): SongSection | null {
    if (!this.songStructure || this.phraseLength <= 0) {
      return null
    }

    if (!usesArrangement(this.songStructure)) {
      return null
    }

    if (!this.isRunning) {
      return sectionAtPhrase(this.songStructure, 0)
    }

    const bpm = Math.max(1, this.bpmAt(this.currentTime))
    const beatsAhead = Math.max(0, (this.nextPhraseTime - this.currentTime) * bpm / 60)
    const currentBeat = Math.max(0, this.phraseBeats - beatsAhead)
    const beatsPerPhrase = this.phraseLength * 4
    const phraseIndex = Math.floor(currentBeat / beatsPerPhrase)
    return sectionAtPhrase(this.songStructure, phraseIndex)
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
    if (this.phraseLength === length) return
    this.phraseLength = length
    this.refreshPhraseQueue()
  }

  setSongStructure(structure: SongStructureId | null): void {
    if (this.songStructure === structure) return
    this.songStructure = structure
    this.refreshPhraseQueue()
  }

  /**
   * Call from the play gesture, before any await, so the page can keep
   * clicking after the screen locks. Clicks go out through a media element
   * fed by this context; direct speakers are only the fallback.
   */
  engageOutput(): Promise<void> {
    const ctx = this.ensureContext()
    this.watchContext()
    const resumePromise = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()
    // Firefox only keeps audio going with the screen off when the context itself
    // is playing through the speakers. A media-element stream does not count, and
    // unplugging the speakers makes Firefox suspend the page on lock.
    if (this.firefoxSpeakers()) {
      this.useSpeakers()
      return resumePromise.then(
        () => undefined,
        () => undefined,
      )
    }
    this.armBackgroundOutput()
    const playPromise = this.outputEl?.play() ?? Promise.reject(new Error('missing output'))
    return playPromise.then(
      () => {
        this.preferStreamOutput()
        return resumePromise.then(
          () => undefined,
          () => undefined,
        )
      },
      () => {
        this.useSpeakers()
        return resumePromise.then(
          () => undefined,
          () => undefined,
        )
      },
    )
  }

  /** Queue enough clicks to survive the page being frozen after the screen locks. */
  holdForBackground(): void {
    this.scheduleAheadS = BACKGROUND_AHEAD_S
    if (this.ctx?.state === 'suspended') {
      void this.ctx.resume()
    }
    if (this.isRunning) this.enqueueAhead()
  }

  /** Drop the long background queue so tempo edits apply on the next clicks. */
  resumeForeground(): void {
    this.scheduleAheadS = SCHEDULE_AHEAD_S
    if (!this.isRunning || !this.ctx) return
    this.cancelScheduledFrom(this.ctx.currentTime + SCHEDULE_AHEAD_S)
    if (this.nextPhraseTime > this.ctx.currentTime + 3) {
      this.pullPhraseCursor(this.ctx.currentTime)
    }
    this.enqueueAhead()
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

    if (this.ctx) this.cancelScheduledFrom(this.ctx.currentTime + 0.05)

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
    this.enqueueAhead()
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

    const ctx = this.ensureContext()
    if (!this.streamDest && !this.speakersConnected) {
      this.useSpeakers()
    }
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    const ramp = options?.ramp
    this.stepIndex = 0
    this.hasHeard = true
    this.heardBeat = 0
    this.heardTime = ctx.currentTime
    if (ramp && ramp.duration > 0) {
      this.ramp = { ...ramp, startTime: ctx.currentTime }
      this.bpm = ramp.from
    } else {
      this.ramp = null
    }
    this.skip = options?.skip ?? null
    this.randomSkip = options?.randomSkip ?? null
    if (this.randomSkip) {
      this.randomSkipSilent = false
      this.randomSkipBeatsLeft = randomInt(RANDOM_SKIP_MIN_PLAY, RANDOM_SKIP_MAX_PLAY)
    } else {
      this.randomSkipSilent = false
      this.randomSkipBeatsLeft = 0
    }
    const startBeat = MEASURE_START_BEAT[this.structure]
    this.beatsInMeasure = startBeat
    this.elapsedBeats = startBeat
    this.phraseBeats = 0
    this.nextPhraseTime = ctx.currentTime
    const bpm = Math.max(1, this.bpmAt(ctx.currentTime))
    this.nextNoteTime = ctx.currentTime + (60 / bpm) * startBeat
    this.dropSchedule()
    this.scheduler()
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
    this.dropSchedule()
    this.outputEl?.pause()
    this.scheduleAheadS = SCHEDULE_AHEAD_S
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
    this.randomSkip = null
    this.randomSkipSilent = false
    this.randomSkipBeatsLeft = 0
  }

  async destroy(): Promise<void> {
    this.stop()
    if (this.outputEl) {
      this.outputEl.srcObject = null
      this.outputEl.remove()
      this.outputEl = null
    }
    this.streamDest = null
    this.master = null
    this.speakersConnected = false
    if (this.ctx) {
      if (this.contextWatcher) {
        this.ctx.removeEventListener('statechange', this.contextWatcher)
        this.contextWatcher = null
      }
      await this.ctx.close()
      this.ctx = null
    }
    this.noiseBuffer = null
    this.crashBuffer = null
  }

  private firefoxSpeakers(): boolean {
    return /Firefox\//.test(navigator.userAgent)
  }

  private ensureContext(): AudioContext {
    this.ctx ??= new AudioContext({ latencyHint: 'interactive' })
    if (!this.master) {
      this.master = this.ctx.createGain()
    }
    return this.ctx
  }

  private watchContext(): void {
    const ctx = this.ctx
    if (!ctx || this.contextWatcher) return
    this.contextWatcher = () => {
      if (ctx.state === 'suspended' && this.isRunning) {
        void ctx.resume()
      }
    }
    ctx.addEventListener('statechange', this.contextWatcher)
  }

  private armBackgroundOutput(): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || this.outputEl) return

    const streamDest = ctx.createMediaStreamDestination()
    master.connect(streamDest)
    const audio = document.createElement('audio')
    audio.srcObject = streamDest.stream
    audio.preload = 'auto'
    audio.setAttribute('playsinline', '')
    audio.setAttribute('data-metronome-output', '')
    audio.setAttribute('aria-hidden', 'true')
    audio.style.position = 'fixed'
    audio.style.width = '0'
    audio.style.height = '0'
    audio.style.opacity = '0'
    audio.style.pointerEvents = 'none'
    document.body.appendChild(audio)
    this.streamDest = streamDest
    this.outputEl = audio
  }

  private useSpeakers(): void {
    if (!this.ctx || !this.master || this.speakersConnected) return
    this.master.connect(this.ctx.destination)
    this.speakersConnected = true
  }

  private preferStreamOutput(): void {
    if (!this.outputEl || !this.master || !this.ctx || !this.speakersConnected) return
    this.master.disconnect(this.ctx.destination)
    this.speakersConnected = false
  }

  private output(): AudioNode {
    return this.master ?? this.ctx!.destination
  }

  private scheduler = (): void => {
    if (!this.ctx) return
    this.enqueueAhead()
    this.timerId = setTimeout(this.scheduler, LOOKAHEAD_MS)
  }

  private enqueueAhead(): void {
    const ctx = this.ctx
    if (!ctx) return

    const horizon = ctx.currentTime + this.scheduleAheadS
    while (this.nextNoteTime <= horizon + 1e-4) {
      const pattern = MEASURE_PATTERNS[this.structure]
      const step = pattern[this.stepIndex % pattern.length]
      const beat = normalizeBeat(this.beatsInMeasure)
      const noteTime = this.nextNoteTime
      const tooLate = noteTime < ctx.currentTime - 0.05
      const sources =
        tooLate || this.isSilentAt(this.elapsedBeats) ? [] : this.scheduleKind(step.kind, noteTime)
      if (!tooLate) {
        this.noteMarks.push({
          time: noteTime,
          nextNoteTime: noteTime,
          stepIndex: this.stepIndex,
          beatsInMeasure: this.beatsInMeasure,
          elapsedBeats: this.elapsedBeats,
          randomSkipSilent: this.randomSkipSilent,
          randomSkipBeatsLeft: this.randomSkipBeatsLeft,
          sources,
        })
        if (noteTime <= ctx.currentTime + VISUAL_AHEAD_S) {
          this.onBeat?.(noteTime, step.kind, beat, sources.length > 0)
        }
      }

      const stepIndex = this.stepIndex % pattern.length
      this.stepIndex = (this.stepIndex + 1) % pattern.length
      const bpm = Math.max(1, this.bpmAt(noteTime))
      this.bpm = bpm
      const stepBeats = swungStepBeats(pattern, stepIndex, this.swing)
      const advanced = noteTime + (60 / bpm) * stepBeats
      if (advanced <= noteTime) break
      this.nextNoteTime = advanced
      this.beatsInMeasure += stepBeats
      this.elapsedBeats += stepBeats
      if (this.beatsInMeasure >= 4 - 1e-6) {
        this.beatsInMeasure -= 4
      }
      this.advanceRandomSkip(stepBeats)
    }

    while (this.nextPhraseTime <= horizon + 1e-4) {
      if (this.phraseLength === 0 && this.nextPhraseTime > ctx.currentTime + 2) break
      const phraseTime = this.nextPhraseTime
      const phraseBeats = this.phraseBeats
      const tooLate = phraseTime < ctx.currentTime - 0.05
      const bpm = Math.max(1, this.bpmAt(phraseTime))
      const beatDuration = 60 / bpm
      const sources = tooLate ? [] : this.schedulePhraseEvent(phraseTime, phraseBeats, beatDuration)
      if (!tooLate && this.phraseLength > 0) {
        this.phraseMarks.push({
          time: phraseTime,
          nextPhraseTime: phraseTime,
          phraseBeats,
          sources,
        })
      }
      const advanced = phraseTime + beatDuration
      if (advanced <= phraseTime) break
      this.nextPhraseTime = advanced
      this.phraseBeats += 1
    }

    this.pruneMarks(ctx.currentTime - 4)
  }

  private schedulePhraseEvent(
    time: number,
    phraseBeats: number,
    beatDuration: number,
  ): AudioScheduledSourceNode[] {
    if (this.phraseLength <= 0) return []

    const sources: AudioScheduledSourceNode[] = []
    if (this.songStructure && usesArrangement(this.songStructure)) {
      sources.push(...this.scheduleSongStructure(time, phraseBeats))
      const beatsPerPhrase = this.phraseLength * 4
      const beatInPhrase = phraseBeats % beatsPerPhrase
      const phraseIndex = Math.floor(phraseBeats / beatsPerPhrase)
      const barInPhrase = Math.floor(beatInPhrase / 4)
      const section = sectionAtPhrase(this.songStructure, phraseIndex)
      if (isPrechorusAcceleration(this.phraseLength, barInPhrase, section)) {
        sources.push(...this.scheduleQuietCymbal(time + beatDuration / 2))
      }
    } else {
      sources.push(...this.schedulePhraseAccent(time, phraseBeats))
    }
    return sources
  }

  private scheduleKind(kind: 'boom' | 'tick' | 'and', time: number): AudioScheduledSourceNode[] {
    if (kind === 'boom') return this.scheduleBoom(time)
    if (kind === 'tick') return this.scheduleSnare(time)
    return this.scheduleAnd(time)
  }

  private refreshPhraseQueue(): void {
    if (!this.isRunning || !this.ctx) return
    this.cancelPhraseMarks(this.ctx.currentTime + 0.05)
    if (this.nextPhraseTime > this.ctx.currentTime + 3) {
      this.pullPhraseCursor(this.ctx.currentTime)
    }
    this.enqueueAhead()
  }

  private pullPhraseCursor(time: number): void {
    const bpm = Math.max(1, this.bpmAt(this.currentTime))
    const beatsAhead = ((this.nextPhraseTime - time) * bpm) / 60
    this.phraseBeats = Math.max(0, Math.round(this.phraseBeats - beatsAhead))
    this.nextPhraseTime = time
  }

  private cancelScheduledFrom(time: number): void {
    this.cancelNoteMarks(time)
    this.cancelPhraseMarks(time)
  }

  private cancelNoteMarks(time: number): void {
    let restore: NoteMark | null = null
    const keep: NoteMark[] = []
    for (const mark of this.noteMarks) {
      if (mark.time >= time - 1e-4) {
        if (!restore || mark.time < restore.time) restore = mark
        this.stopSources(mark.sources)
      } else {
        keep.push(mark)
      }
    }
    this.noteMarks = keep
    if (!restore) return
    this.nextNoteTime = restore.nextNoteTime
    this.stepIndex = restore.stepIndex
    this.beatsInMeasure = restore.beatsInMeasure
    this.elapsedBeats = restore.elapsedBeats
    this.randomSkipSilent = restore.randomSkipSilent
    this.randomSkipBeatsLeft = restore.randomSkipBeatsLeft
  }

  private cancelPhraseMarks(time: number): void {
    let restore: PhraseMark | null = null
    const keep: PhraseMark[] = []
    for (const mark of this.phraseMarks) {
      if (mark.time >= time - 1e-4) {
        if (!restore || mark.time < restore.time) restore = mark
        this.stopSources(mark.sources)
      } else {
        keep.push(mark)
      }
    }
    this.phraseMarks = keep
    if (!restore) return
    this.nextPhraseTime = restore.nextPhraseTime
    this.phraseBeats = restore.phraseBeats
  }

  private dropSchedule(): void {
    for (const mark of this.noteMarks) this.stopSources(mark.sources)
    for (const mark of this.phraseMarks) this.stopSources(mark.sources)
    this.noteMarks = []
    this.phraseMarks = []
  }

  private pruneMarks(cutoff: number): void {
    if (this.noteMarks.length > 32) {
      this.noteMarks = this.noteMarks.filter((mark) => mark.time >= cutoff)
    }
    if (this.phraseMarks.length > 32) {
      this.phraseMarks = this.phraseMarks.filter((mark) => mark.time >= cutoff)
    }
  }

  private stopSources(sources: AudioScheduledSourceNode[]): void {
    for (const source of sources) {
      try {
        source.stop(0)
      } catch {
        try {
          source.disconnect()
        } catch {
          // The node already ended.
        }
      }
    }
  }

  private isSilentAt(elapsedBeats: number): boolean {
    if (this.randomSkip) {
      return this.randomSkipSilent
    }

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

  private advanceRandomSkip(stepBeats: number): void {
    if (!this.randomSkip) {
      return
    }

    this.randomSkipBeatsLeft -= stepBeats
    if (this.randomSkipBeatsLeft > 1e-6) {
      return
    }

    if (this.randomSkipSilent) {
      this.randomSkipSilent = false
      this.randomSkipBeatsLeft = randomInt(RANDOM_SKIP_MIN_PLAY, RANDOM_SKIP_MAX_PLAY)
      return
    }

    const minSkip = Math.max(1, this.randomSkip.minSkip)
    const maxSkip = Math.max(minSkip, this.randomSkip.maxSkip)
    this.randomSkipSilent = true
    this.randomSkipBeatsLeft = randomInt(minSkip, maxSkip)
  }

  private scheduleBoom(time: number): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    if (!ctx) return []

    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = BOOM.type
    oscillator.frequency.setValueAtTime(BOOM.frequency, time)
    oscillator.frequency.exponentialRampToValueAtTime(BOOM.endFrequency, time + BOOM.duration)

    gain.gain.setValueAtTime(BOOM.gain, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + BOOM.duration)

    oscillator.connect(gain)
    gain.connect(this.output())

    oscillator.start(time)
    oscillator.stop(time + BOOM.duration)
    return [oscillator]
  }

  private scheduleSnare(time: number): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    if (!ctx) return []

    const noise = this.getNoiseBuffer(ctx)
    const sources: AudioScheduledSourceNode[] = []

    for (const burst of SNARE_BURSTS) {
      const start = time + burst.offset
      const source = ctx.createBufferSource()
      source.buffer = noise
      sources.push(source)

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
      bodyGain.connect(this.output())

      source.connect(sizzle)
      sizzle.connect(sizzleGain)
      sizzleGain.connect(this.output())

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
    bodyGain.connect(this.output())
    body.start(time)
    body.stop(time + 0.08)
    sources.push(body)
    return sources
  }

  private scheduleAnd(time: number): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    if (!ctx) return []

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
    gain.connect(this.output())

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
    pingGain.connect(this.output())
    ping.start(time)
    ping.stop(time + 0.025)
    return [source, ping]
  }

  private scheduleSongStructure(time: number, phraseBeat: number): AudioScheduledSourceNode[] {
    if (!this.songStructure || this.phraseLength <= 0) return []
    const sources: AudioScheduledSourceNode[] = []

    const beatsPerPhrase = this.phraseLength * 4
    const beatInPhrase = ((phraseBeat % beatsPerPhrase) + beatsPerPhrase) % beatsPerPhrase
    const phraseIndex = Math.floor(phraseBeat / beatsPerPhrase)
    const barInPhrase = Math.floor(beatInPhrase / 4)
    const beatInBar = beatInPhrase % 4
    const section = sectionAtPhrase(this.songStructure, phraseIndex)
    const bpm = Math.max(1, this.bpmAt(time))

    const hit = celloMelodyHit(this.phraseLength, barInPhrase, beatInBar, beatInPhrase, section)
    if (hit) {
      sources.push(...this.scheduleLegatoCello(time, midiToHz(hit.midi), hit.duration, bpm, hit.fadeOut))
    }

    if (section === 'chorus') {
      const trumpetHit = trumpetMelodyHit(this.phraseLength, barInPhrase, beatInBar)
      if (trumpetHit) {
        sources.push(
          ...this.scheduleTrumpet(
            time,
            midiToHz(trumpetHit.midi),
            trumpetHit.duration,
            bpm,
            trumpetHit.fadeOut,
          ),
        )
      }
    }

    if (section === 'prechorus') {
      sources.push(...this.scheduleQuietCymbal(time))
    }
    return sources
  }

  private scheduleLegatoCello(
    time: number,
    hz: number,
    durationBeats: number,
    bpm: number,
    fadeOut = false,
  ): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    if (!ctx) return []

    const duration = (60 / bpm) * durationBeats
    const oscillator = ctx.createOscillator()
    const filter = ctx.createBiquadFilter()
    const gain = ctx.createGain()

    oscillator.type = 'sawtooth'
    oscillator.frequency.setValueAtTime(hz, time)

    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(820, time)
    filter.Q.setValueAtTime(0.7, time)

    gain.gain.setValueAtTime(0.001, time)
    gain.gain.linearRampToValueAtTime(0.11, time + 0.07)
    if (fadeOut) {
      gain.gain.setValueAtTime(0.11, time + 0.1)
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration)
    } else {
      gain.gain.setValueAtTime(0.11, time + duration - 0.08)
      gain.gain.linearRampToValueAtTime(0.001, time + duration)
    }

    oscillator.connect(filter)
    filter.connect(gain)
    gain.connect(this.output())
    oscillator.start(time)
    oscillator.stop(time + duration + 0.05)
    return [oscillator]
  }

  private scheduleTrumpet(
    time: number,
    hz: number,
    durationBeats: number,
    bpm: number,
    fadeOut = false,
  ): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    if (!ctx) return []

    const baseDuration = (60 / bpm) * durationBeats
    const sources: AudioScheduledSourceNode[] = []
    const duration = fadeOut ? baseDuration * 1.5 : baseDuration
    const attack = Math.min(0.016, baseDuration * 0.12)
    const mix = ctx.createGain()
    mix.gain.setValueAtTime(1, time)

    const harmonics = [
      { mult: 1, level: 1, type: 'sawtooth' as OscillatorType },
      { mult: 2, level: 0.62, type: 'sawtooth' as OscillatorType },
      { mult: 3, level: 0.38, type: 'square' as OscillatorType },
      { mult: 4, level: 0.22, type: 'sine' as OscillatorType },
      { mult: 5, level: 0.14, type: 'sine' as OscillatorType },
    ]

    for (const harmonic of harmonics) {
      const oscillator = ctx.createOscillator()
      const harmonicGain = ctx.createGain()
      oscillator.type = harmonic.type
      oscillator.frequency.setValueAtTime(hz * harmonic.mult, time)
      harmonicGain.gain.setValueAtTime(harmonic.level, time)
      oscillator.connect(harmonicGain)
      harmonicGain.connect(mix)
      oscillator.start(time)
      oscillator.stop(time + duration + 0.08)
      sources.push(oscillator)
    }

    const noise = this.getNoiseBuffer(ctx)
    const noiseSource = ctx.createBufferSource()
    noiseSource.buffer = noise

    const noiseFilter = ctx.createBiquadFilter()
    noiseFilter.type = 'bandpass'
    noiseFilter.frequency.setValueAtTime(2200, time)
    noiseFilter.Q.setValueAtTime(2.4, time)

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(fadeOut ? 0.035 : 0.07, time)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.035)

    noiseSource.connect(noiseFilter)
    noiseFilter.connect(noiseGain)
    noiseGain.connect(mix)
    noiseSource.start(time)
    noiseSource.stop(time + 0.04)
    sources.push(noiseSource)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.setValueAtTime(0.9, time)
    filter.frequency.setValueAtTime(Math.min(5200, hz * 9), time)
    filter.frequency.exponentialRampToValueAtTime(Math.min(2400, hz * 4.5), time + attack + 0.05)
    if (fadeOut) {
      filter.frequency.exponentialRampToValueAtTime(Math.min(900, hz * 2), time + duration * 0.7)
    } else {
      filter.frequency.setValueAtTime(Math.min(1800, hz * 3.5), time + baseDuration * 0.45)
    }

    const gain = ctx.createGain()
    const peak = fadeOut ? 0.1 : 0.13
    gain.gain.setValueAtTime(0.001, time)
    gain.gain.linearRampToValueAtTime(peak, time + attack)
    if (fadeOut) {
      gain.gain.setValueAtTime(peak * 0.82, time + attack + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration)
    } else {
      gain.gain.setValueAtTime(peak * 0.7, time + baseDuration * 0.55)
      gain.gain.exponentialRampToValueAtTime(0.001, time + baseDuration)
    }

    mix.connect(filter)
    filter.connect(gain)
    gain.connect(this.output())
    return sources
  }

  private scheduleQuietCymbal(time: number): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    if (!ctx) return []

    const bpm = Math.max(1, this.bpmAt(time))
    const duration = (60 / bpm) * 0.55
    const noise = this.getCrashBuffer(ctx)
    const source = ctx.createBufferSource()
    source.buffer = noise

    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.setValueAtTime(1200, time)

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(4800, time)
    bandpass.Q.setValueAtTime(0.55, time)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.1, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration)

    source.connect(highpass)
    highpass.connect(bandpass)
    bandpass.connect(gain)
    gain.connect(this.output())
    source.start(time)
    source.stop(time + duration)
    return [source]
  }

  private schedulePhraseAccent(time: number, beatIndex: number): AudioScheduledSourceNode[] {
    if (this.phraseLength === 0) return []
    const sources: AudioScheduledSourceNode[] = []

    const beatsPerPhrase = this.phraseLength * 4
    const pos = ((beatIndex % beatsPerPhrase) + beatsPerPhrase) % beatsPerPhrase
    const lastMeasureStart = (this.phraseLength - 1) * 4

    if (pos >= lastMeasureStart && pos < lastMeasureStart + 4) {
      sources.push(...this.scheduleArpeggioTone(time, pos - lastMeasureStart))
    }

    if (beatIndex > 0 && pos === 0) {
      sources.push(...this.scheduleCrash(time))
    }
    return sources
  }

  private scheduleArpeggioTone(time: number, index: number): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    if (!ctx) return []

    const frequency = ARPEGGIO_HZ[index] ?? ARPEGGIO_HZ[0]
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(frequency, time)
    gain.gain.setValueAtTime(0.28, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22)
    oscillator.connect(gain)
    gain.connect(this.output())
    oscillator.start(time)
    oscillator.stop(time + 0.24)
    return [oscillator]
  }

  private scheduleCrash(time: number): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    if (!ctx) return []

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
    bodyGain.connect(this.output())

    source.connect(sizzle)
    sizzle.connect(sizzleGain)
    sizzleGain.connect(this.output())

    source.start(time)
    source.stop(time + duration)
    return [source]
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
