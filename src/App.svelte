<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Metronome } from './lib/metronome'

  const MIN_BPM = 40
  const MAX_BPM = 240

  const metronome = new Metronome()

  let bpm = $state(120)
  let playing = $state(false)
  let pulsing = $state(false)
  let beatKind = $state<'boom' | 'tick'>('boom')
  let beatGeneration = 0
  let pulseTimer: ReturnType<typeof setTimeout> | null = null

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
      }, kind === 'boom' ? 140 : 80)
    }, delayMs)
  }

  $effect(() => {
    metronome.bpm = bpm
  })

  async function togglePlayback(): Promise<void> {
    if (playing) {
      stopPlayback()
      return
    }

    await metronome.start()
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
    <p>Boom on odd beats, tick on even beats.</p>
  </header>

  <div class="tempo" class:pulsing class:boom={beatKind === 'boom'} class:tick={beatKind === 'tick'} aria-live="polite">
    <span class="bpm-value">{bpm}</span>
    <span class="bpm-unit">BPM</span>
  </div>

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
    width: min(28rem, calc(100% - 48px));
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
    transform: scale(1.08);
  }

  .tempo.pulsing.tick {
    transform: scale(1.03);
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

  .slider {
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

  .slider-range {
    display: flex;
    justify-content: space-between;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--text);
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
