<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Metronome } from './lib/metronome'
  import {
    MEASURE_STRUCTURES,
    structureHasAnd,
    type BeatKind,
    type MeasureStructureId,
  } from './lib/measures'

  const MIN_BPM = 40
  const MAX_BPM = 240
  const MIN_SWING = 10
  const MAX_SWING = 90
  const MIN_RAMP_SECONDS = 1
  const MAX_RAMP_SECONDS = 600

  const metronome = new Metronome()

  let bpm = $state(120)
  let startBpm = $state(80)
  let endBpm = $state(140)
  let rampSeconds = $state(30)
  let rampEnabled = $state(false)
  let measureStructure = $state<MeasureStructureId>('quarters')
  let swingPercent = $state(50)
  let playing = $state(false)
  let pulsing = $state(false)
  let beatKind = $state<BeatKind>('boom')
  let liveBpm = $state(120)
  let beatGeneration = 0
  let pulseTimer: ReturnType<typeof setTimeout> | null = null

  const displayedBpm = $derived(playing ? liveBpm : rampEnabled ? startBpm : bpm)
  const swingEnabled = $derived(structureHasAnd(measureStructure))

  metronome.onBeat = (time, kind) => {
    const generation = beatGeneration
    const delayMs = Math.max(0, (time - metronome.currentTime) * 1000)
    setTimeout(() => {
      if (generation !== beatGeneration) {
        return
      }
      beatKind = kind
      pulsing = true
      if (pulseTimer !== null) {
        clearTimeout(pulseTimer)
      }
      pulseTimer = setTimeout(() => {
        pulsing = false
        pulseTimer = null
      }, kind === 'tick' ? 140 : kind === 'and' ? 55 : 80)
    }, delayMs)
  }

  $effect(() => {
    metronome.structure = measureStructure
  })

  $effect(() => {
    metronome.swing = Number(swingPercent) / 100
  })

  $effect(() => {
    if (playing && rampEnabled) {
      return
    }
    metronome.bpm = bpm
  })

  $effect(() => {
    if (!playing) {
      return
    }

    let frame = 0
    const update = () => {
      liveBpm = Math.round(metronome.currentBpm)
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  })

  function setRampEnabled(enabled: boolean): void {
    rampEnabled = enabled
    if (enabled) {
      startBpm = bpm
      if (endBpm === startBpm) {
        endBpm = Math.min(MAX_BPM, startBpm + 20)
      }
    } else {
      bpm = startBpm
    }
  }

  async function togglePlayback(): Promise<void> {
    if (playing) {
      stopPlayback()
      return
    }

    if (rampEnabled) {
      const duration = clamp(Number(rampSeconds) || MIN_RAMP_SECONDS, MIN_RAMP_SECONDS, MAX_RAMP_SECONDS)
      rampSeconds = duration
      liveBpm = startBpm
      await metronome.start({
        from: clamp(Number(startBpm) || MIN_BPM, MIN_BPM, MAX_BPM),
        to: clamp(Number(endBpm) || MIN_BPM, MIN_BPM, MAX_BPM),
        duration,
      })
    } else {
      liveBpm = bpm
      await metronome.start()
    }

    playing = true
  }

  function stopPlayback(): void {
    metronome.stop()
    playing = false
    pulsing = false
    beatKind = 'boom'
    beatGeneration += 1
    if (pulseTimer !== null) {
      clearTimeout(pulseTimer)
      pulseTimer = null
    }
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  }

  onDestroy(() => {
    beatGeneration += 1
    if (pulseTimer !== null) {
      clearTimeout(pulseTimer)
    }
    void metronome.destroy()
  })
</script>

<main class="player">
  <header>
    <h1>Metronome</h1>
    <p>Choose a measure structure, then press play.</p>
  </header>

  <div class="tempo" class:pulsing class:boom={beatKind === 'boom'} class:tick={beatKind === 'tick'} class:and={beatKind === 'and'} aria-live="polite">
    <span class="bpm-value">{displayedBpm}</span>
    <span class="bpm-unit">BPM</span>
  </div>

  <label class="measure">
    <span class="slider-label">Measure structure</span>
    <select bind:value={measureStructure} aria-label="Measure structure">
      {#each MEASURE_STRUCTURES as option (option.id)}
        <option value={option.id}>{option.label}</option>
      {/each}
    </select>
  </label>

  <label class="slider">
    <span class="slider-label">Swing · {swingPercent}%</span>
    <input
      type="range"
      min={MIN_SWING}
      max={MAX_SWING}
      step="1"
      bind:value={swingPercent}
      disabled={!swingEnabled}
      aria-valuemin={MIN_SWING}
      aria-valuemax={MAX_SWING}
      aria-valuenow={swingPercent}
      aria-label="Swing amount for and notes"
    />
    <span class="slider-range">
      <span>{MIN_SWING}%</span>
      <span>{MAX_SWING}%</span>
    </span>
  </label>

  <label class="toggle">
    <input
      type="checkbox"
      checked={rampEnabled}
      disabled={playing}
      onchange={(event) => setRampEnabled(event.currentTarget.checked)}
    />
    Transition between two tempos
  </label>

  {#if rampEnabled}
    <label class="slider">
      <span class="slider-label">Start · {startBpm} BPM</span>
      <input
        type="range"
        min={MIN_BPM}
        max={MAX_BPM}
        step="1"
        bind:value={startBpm}
        disabled={playing}
        aria-valuemin={MIN_BPM}
        aria-valuemax={MAX_BPM}
        aria-valuenow={startBpm}
        aria-label="Starting tempo in beats per minute"
      />
      <span class="slider-range">
        <span>{MIN_BPM}</span>
        <span>{MAX_BPM}</span>
      </span>
    </label>

    <label class="slider">
      <span class="slider-label">End · {endBpm} BPM</span>
      <input
        type="range"
        min={MIN_BPM}
        max={MAX_BPM}
        step="1"
        bind:value={endBpm}
        disabled={playing}
        aria-valuemin={MIN_BPM}
        aria-valuemax={MAX_BPM}
        aria-valuenow={endBpm}
        aria-label="Ending tempo in beats per minute"
      />
      <span class="slider-range">
        <span>{MIN_BPM}</span>
        <span>{MAX_BPM}</span>
      </span>
    </label>

    <label class="duration">
      <span class="slider-label">Duration</span>
      <span class="duration-field">
        <input
          type="number"
          min={MIN_RAMP_SECONDS}
          max={MAX_RAMP_SECONDS}
          step="1"
          bind:value={rampSeconds}
          disabled={playing}
          onblur={() => {
            rampSeconds = clamp(
              Number(rampSeconds) || MIN_RAMP_SECONDS,
              MIN_RAMP_SECONDS,
              MAX_RAMP_SECONDS,
            )
          }}
          aria-label="Tempo transition duration in seconds"
        />
        <span>seconds</span>
      </span>
    </label>
  {:else}
    <label class="slider">
      <span class="slider-label">Tempo</span>
      <input
        type="range"
        min={MIN_BPM}
        max={MAX_BPM}
        step="1"
        bind:value={bpm}
        aria-valuemin={MIN_BPM}
        aria-valuemax={MAX_BPM}
        aria-valuenow={bpm}
        aria-label="Metronome tempo in beats per minute"
      />
      <span class="slider-range">
        <span>{MIN_BPM}</span>
        <span>{MAX_BPM}</span>
      </span>
    </label>
  {/if}

  <button
    type="button"
    class="play"
    class:playing
    aria-pressed={playing}
    onclick={togglePlayback}
  >
    {playing ? 'Stop' : 'Play'}
  </button>
</main>

<style>
  .player {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 28px;
    flex-grow: 1;
    width: min(32rem, calc(100% - 48px));
    margin: 0 auto;
    padding: 48px 0;
    text-align: center;
  }

  header p {
    color: var(--text);
  }

  .tempo {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 10px;
    min-height: 5.5rem;
    transition: transform 80ms ease-out;
  }

  .tempo.pulsing.boom {
    transform: scale(1.03);
  }

  .tempo.pulsing.tick {
    transform: scale(1.08);
  }

  .tempo.pulsing.and {
    transform: scale(1.015);
  }

  .bpm-value {
    font-family: var(--mono);
    font-size: 72px;
    line-height: 1;
    letter-spacing: -2px;
    color: var(--text-h);
  }

  .bpm-unit {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--accent);
  }

  .slider,
  .duration,
  .measure {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  .slider-label {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text);
  }

  .slider input {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .slider input:disabled,
  .duration input:disabled,
  .toggle input:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }

  .slider-range {
    display: flex;
    justify-content: space-between;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--text);
  }

  .duration-field {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text);
  }

  .duration input {
    width: 6.5rem;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text-h);
    font: inherit;
    font-family: var(--mono);
    text-align: center;
  }

  .measure select {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text-h);
    font-family: 'Noto Music', var(--sans);
    font-size: 22px;
    letter-spacing: 0.18em;
    text-align: center;
    cursor: pointer;
  }

  .measure select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-h);
    cursor: pointer;
  }

  .toggle input {
    width: 1.1rem;
    height: 1.1rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .play {
    min-width: 9.5rem;
    padding: 14px 28px;
    border: 2px solid transparent;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 0.2s,
      border-color 0.2s,
      transform 0.15s;
  }

  .play:hover {
    transform: translateY(-1px);
  }

  .play:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .play.playing {
    background: var(--accent-bg);
    border-color: var(--accent-border);
    color: var(--text-h);
  }

  @media (max-width: 1024px) {
    .bpm-value {
      font-size: 56px;
    }
  }
</style>
