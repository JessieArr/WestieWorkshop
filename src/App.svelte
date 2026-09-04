<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Metronome, type PhraseLength, type SkipUnit } from './lib/metronome'
  import MeasureWheel from './lib/MeasureWheel.svelte'
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
  const MIN_SKIP = 1
  const MAX_SKIP = 32

  const SWING_PRESETS = [
    { id: '50', label: '1/2', value: 50 },
    { id: '54', label: '54%', value: 54 },
    { id: '60', label: '3/5', value: 60 },
    { id: '62.5', label: '5/8', value: 62.5 },
    { id: '66.67', label: '2/3', value: 200 / 3 },
    { id: '75', label: '3/4', value: 75 },
    { id: 'custom', label: 'Custom' },
  ] as const

  const BPM_PRESETS = [
    { id: '80', label: '80', value: 80 },
    { id: '90', label: '90', value: 90 },
    { id: '100', label: '100', value: 100 },
    { id: '110', label: '110', value: 110 },
    { id: '120', label: '120', value: 120 },
    { id: 'custom', label: 'Custom' },
  ] as const

  const DRILLS = [
    {
      id: 'metronome',
      label: 'Metronome',
      description:
        'Steady beats at a fixed tempo. Pick a preset or set a custom BPM to practice timing, footwork, or patterns.',
    },
    {
      id: 'tempo-change',
      label: 'Tempo Change',
      description:
        'Gradually ramps from a starting tempo to an ending tempo over a set duration. Builds speed and stamina while you stay in time.',
    },
    {
      id: 'skip-measures',
      label: 'Skip Measures',
      description:
        'Plays for a fixed interval, then goes silent for a fixed skip interval, repeating. Keeps you counting through gaps in the click.',
    },
    {
      id: 'random-skip',
      label: 'Random Skip',
      description:
        'Plays 4–16 beats at random, then skips a random number of beats within your range, repeating. Unpredictable silence trains internal timing.',
    },
  ] as const

  const PHRASE_STRUCTURES = [
    { id: 'none', label: 'None', bars: 0 },
    { id: '8', label: '8 Bars', bars: 8 },
    { id: '12', label: '12 Bars', bars: 12 },
  ] as const

  type DrillId = (typeof DRILLS)[number]['id']
  type SwingPresetId = (typeof SWING_PRESETS)[number]['id']
  type BpmPresetId = (typeof BPM_PRESETS)[number]['id']
  type PhraseId = (typeof PHRASE_STRUCTURES)[number]['id']

  const metronome = new Metronome()

  let bpm = $state(120)
  let startBpm = $state(80)
  let endBpm = $state(140)
  let rampSeconds = $state(30)
  let drill = $state<DrillId>('metronome')
  let skipEvery = $state(2)
  let skipAmount = $state(2)
  let skipUnit = $state<SkipUnit>('measures')
  let randomSkipMin = $state(2)
  let randomSkipMax = $state(8)
  let measureStructure = $state<MeasureStructureId>('quarters')
  let phraseId = $state<PhraseId>('none')
  let swingPreset = $state<SwingPresetId>('50')
  let swingPercent = $state(50)
  let bpmPreset = $state<BpmPresetId>('120')
  let startBpmPreset = $state<BpmPresetId>('80')
  let endBpmPreset = $state<BpmPresetId>('custom')
  let playing = $state(false)
  let pulsing = $state(false)
  let beatKind = $state<BeatKind>('boom')
  let pulseBeat = $state<number | null>(null)
  let liveBpm = $state(120)
  let liveBar = $state(1)
  let measureProgress = $state(0)
  let beatGeneration = 0
  let pulseTimer: ReturnType<typeof setTimeout> | null = null
  let drillHelpOpen = $state(false)

  const activeDrill = $derived(DRILLS.find((entry) => entry.id === drill) ?? DRILLS[0])

  const tempoChange = $derived(drill === 'tempo-change')
  const displayedBpm = $derived(playing ? liveBpm : tempoChange ? startBpm : bpm)
  const swingEnabled = $derived(structureHasAnd(measureStructure))
  const phraseActive = $derived(phraseId !== 'none')
  const displayedBar = $derived(playing ? liveBar : 1)

  $effect(() => {
    if (!drillHelpOpen) {
      return
    }

    const close = () => {
      drillHelpOpen = false
    }
    const id = window.setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('touchstart', close)
    }, 0)

    return () => {
      window.clearTimeout(id)
      window.removeEventListener('click', close)
      window.removeEventListener('touchstart', close)
    }
  })

  metronome.onBeat = (time, kind, beat, audible) => {
    const generation = beatGeneration
    const delayMs = Math.max(0, (time - metronome.currentTime) * 1000)
    setTimeout(() => {
      if (generation !== beatGeneration) {
        return
      }
      beatKind = kind
      pulseBeat = beat
      metronome.hearBeat(beat)
      measureProgress = beat / 4
      if (!audible) {
        pulsing = false
        if (pulseTimer !== null) {
          clearTimeout(pulseTimer)
          pulseTimer = null
        }
        return
      }
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
    metronome.setStructure(measureStructure)
    beatGeneration += 1
  })

  $effect(() => {
    metronome.setSwing(Number(swingPercent) / 100)
  })

  $effect(() => {
    const option = PHRASE_STRUCTURES.find((entry) => entry.id === phraseId)
    metronome.setPhraseLength((option?.bars ?? 0) as PhraseLength)
  })

  $effect(() => {
    if (playing && tempoChange) {
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
      liveBar = metronome.currentBar
      measureProgress = metronome.measureProgress
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  })

  function setDrill(next: DrillId): void {
    if (next === drill) {
      return
    }
    if (tempoChange && next !== 'tempo-change') {
      bpm = startBpm
      bpmPreset = bpmPresetFor(startBpm)
    }
    if (next === 'tempo-change') {
      startBpm = bpm
      startBpmPreset = bpmPresetFor(startBpm)
      if (endBpm === startBpm) {
        endBpm = Math.min(MAX_BPM, startBpm + 20)
      }
      endBpmPreset = bpmPresetFor(endBpm)
    }
    drill = next
    drillHelpOpen = false
  }

  function toggleDrillHelp(event: MouseEvent): void {
    event.stopPropagation()
    drillHelpOpen = !drillHelpOpen
  }

  function closeDrillHelp(): void {
    drillHelpOpen = false
  }

  async function togglePlayback(): Promise<void> {
    if (playing) {
      stopPlayback()
      return
    }

    if (tempoChange) {
      const duration = clamp(Number(rampSeconds) || MIN_RAMP_SECONDS, MIN_RAMP_SECONDS, MAX_RAMP_SECONDS)
      rampSeconds = duration
      liveBpm = startBpm
      await metronome.start({
        ramp: {
          from: clamp(Number(startBpm) || MIN_BPM, MIN_BPM, MAX_BPM),
          to: clamp(Number(endBpm) || MIN_BPM, MIN_BPM, MAX_BPM),
          duration,
        },
      })
    } else if (drill === 'skip-measures') {
      skipEvery = clamp(Number(skipEvery) || MIN_SKIP, MIN_SKIP, MAX_SKIP)
      skipAmount = clamp(Number(skipAmount) || MIN_SKIP, MIN_SKIP, MAX_SKIP)
      liveBpm = bpm
      await metronome.start({
        skip: {
          every: skipEvery,
          skip: skipAmount,
          unit: skipUnit,
        },
      })
    } else if (drill === 'random-skip') {
      randomSkipMin = clamp(Number(randomSkipMin) || MIN_SKIP, MIN_SKIP, MAX_SKIP)
      randomSkipMax = clamp(Number(randomSkipMax) || MIN_SKIP, MIN_SKIP, MAX_SKIP)
      if (randomSkipMin > randomSkipMax) {
        randomSkipMax = randomSkipMin
      }
      liveBpm = bpm
      await metronome.start({
        randomSkip: {
          minSkip: randomSkipMin,
          maxSkip: randomSkipMax,
        },
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
    pulseBeat = null
    measureProgress = 0
    liveBar = 1
    beatGeneration += 1
    if (pulseTimer !== null) {
      clearTimeout(pulseTimer)
      pulseTimer = null
    }
  }

  function setSwingPreset(id: SwingPresetId): void {
    swingPreset = id
    const preset = SWING_PRESETS.find((option) => option.id === id)
    if (preset && 'value' in preset) {
      swingPercent = preset.value
    }
  }

  function setBpmPreset(id: BpmPresetId): void {
    bpmPreset = id
    const preset = BPM_PRESETS.find((option) => option.id === id)
    if (preset && 'value' in preset) {
      bpm = preset.value
    }
  }

  function setStartBpmPreset(id: BpmPresetId): void {
    startBpmPreset = id
    const preset = BPM_PRESETS.find((option) => option.id === id)
    if (preset && 'value' in preset) {
      startBpm = preset.value
    }
  }

  function setEndBpmPreset(id: BpmPresetId): void {
    endBpmPreset = id
    const preset = BPM_PRESETS.find((option) => option.id === id)
    if (preset && 'value' in preset) {
      endBpm = preset.value
    }
  }

  function bpmPresetFor(value: number): BpmPresetId {
    const preset = BPM_PRESETS.find((option) => 'value' in option && option.value === value)
    return preset?.id ?? 'custom'
  }

  function clampRandomSkipRange(): void {
    randomSkipMin = clamp(Number(randomSkipMin) || MIN_SKIP, MIN_SKIP, MAX_SKIP)
    randomSkipMax = clamp(Number(randomSkipMax) || MIN_SKIP, MIN_SKIP, MAX_SKIP)
    if (randomSkipMin > randomSkipMax) {
      randomSkipMax = randomSkipMin
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
  <div class="hero">
    <div class="stage">
      <div class="wheel-frame">
        <MeasureWheel
          structure={measureStructure}
          swing={Number(swingPercent) / 100}
          progress={measureProgress}
          pulsing={pulsing}
          pulseKind={beatKind}
          pulseBeat={pulseBeat}
          playing={playing}
        />
      </div>
      <div class="tempo" class:pulsing class:boom={beatKind === 'boom'} class:tick={beatKind === 'tick'} class:and={beatKind === 'and'} aria-live="polite">
        <div class="tempo-bpm">
          <span class="bpm-value">{displayedBpm}</span>
          <span class="bpm-unit">BPM</span>
        </div>
        {#if phraseActive}
          <span class="bar-readout">Bar: {displayedBar}</span>
        {/if}
      </div>
    </div>

    <button
      type="button"
      class="play"
      class:playing
      aria-pressed={playing}
      onclick={togglePlayback}
    >
      {playing ? 'Stop' : 'Play'}
    </button>
  </div>

  <div class="field-row">
    <label class="field">
      <span class="slider-label">Measure structure</span>
      <select bind:value={measureStructure} aria-label="Measure structure">
        {#each MEASURE_STRUCTURES as option (option.id)}
          <option value={option.id}>{option.label}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span class="slider-label">Phrase structure</span>
      <select bind:value={phraseId} aria-label="Phrase structure">
        {#each PHRASE_STRUCTURES as option (option.id)}
          <option value={option.id}>{option.label}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if swingEnabled}
    <fieldset class="choices">
      <legend class="slider-label">Swing</legend>
      <div class="choice-list segmented swing-presets" role="radiogroup" aria-label="Swing amount">
        {#each SWING_PRESETS as option (option.id)}
          <label class="choice">
            <input
              type="radio"
              name="swing-preset"
              value={option.id}
              checked={swingPreset === option.id}
              onchange={() => setSwingPreset(option.id)}
            />
            {option.label}
          </label>
        {/each}
      </div>
    </fieldset>

    {#if swingPreset === 'custom'}
      <label class="slider">
        <span class="slider-label">Custom · {swingPercent}%</span>
        <input
          type="range"
          min={MIN_SWING}
          max={MAX_SWING}
          step="0.5"
          bind:value={swingPercent}
          aria-valuemin={MIN_SWING}
          aria-valuemax={MAX_SWING}
          aria-valuenow={swingPercent}
          aria-label="Custom swing amount for and notes"
        />
        <span class="slider-range">
          <span>{MIN_SWING}%</span>
          <span>{MAX_SWING}%</span>
        </span>
      </label>
    {/if}
  {/if}

  <div class="field drill-field">
    <div class="field-label-row">
      <span class="slider-label">Drill</span>
      <div class="help-anchor">
        <button
          type="button"
          class="help-trigger"
          aria-label="About {activeDrill.label}"
          aria-expanded={drillHelpOpen}
          aria-controls="drill-help-text"
          onclick={toggleDrillHelp}
        >
          ?
        </button>
        {#if drillHelpOpen}
          <div id="drill-help-text" class="help-bubble" role="tooltip">
            <p>{activeDrill.description}</p>
          </div>
        {/if}
      </div>
    </div>
    <select
      value={drill}
      disabled={playing}
      aria-label="Drill"
      onchange={(event) => setDrill(event.currentTarget.value as DrillId)}
    >
      {#each DRILLS as option (option.id)}
        <option value={option.id}>{option.label}</option>
      {/each}
    </select>
  </div>

  {#if tempoChange}
    <fieldset class="choices">
      <legend class="slider-label">Start · {startBpm} BPM</legend>
      <div class="choice-list segmented" role="radiogroup" aria-label="Starting tempo in beats per minute">
        {#each BPM_PRESETS as option (option.id)}
          <label class="choice">
            <input
              type="radio"
              name="start-bpm-preset"
              value={option.id}
              checked={startBpmPreset === option.id}
              disabled={playing}
              onchange={() => setStartBpmPreset(option.id)}
            />
            {option.label}
          </label>
        {/each}
      </div>
    </fieldset>

    {#if startBpmPreset === 'custom'}
      <label class="slider">
        <span class="slider-label">Custom start · {startBpm} BPM</span>
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
          aria-label="Custom starting tempo in beats per minute"
        />
        <span class="slider-range">
          <span>{MIN_BPM}</span>
          <span>{MAX_BPM}</span>
        </span>
      </label>
    {/if}

    <fieldset class="choices">
      <legend class="slider-label">End · {endBpm} BPM</legend>
      <div class="choice-list segmented" role="radiogroup" aria-label="Ending tempo in beats per minute">
        {#each BPM_PRESETS as option (option.id)}
          <label class="choice">
            <input
              type="radio"
              name="end-bpm-preset"
              value={option.id}
              checked={endBpmPreset === option.id}
              disabled={playing}
              onchange={() => setEndBpmPreset(option.id)}
            />
            {option.label}
          </label>
        {/each}
      </div>
    </fieldset>

    {#if endBpmPreset === 'custom'}
      <label class="slider">
        <span class="slider-label">Custom end · {endBpm} BPM</span>
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
          aria-label="Custom ending tempo in beats per minute"
        />
        <span class="slider-range">
          <span>{MIN_BPM}</span>
          <span>{MAX_BPM}</span>
        </span>
      </label>
    {/if}

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
    <fieldset class="choices">
      <legend class="slider-label">Tempo</legend>
      <div class="choice-list segmented" role="radiogroup" aria-label="Tempo in beats per minute">
        {#each BPM_PRESETS as option (option.id)}
          <label class="choice">
            <input
              type="radio"
              name="bpm-preset"
              value={option.id}
              checked={bpmPreset === option.id}
              onchange={() => setBpmPreset(option.id)}
            />
            {option.label}
          </label>
        {/each}
      </div>
    </fieldset>

    {#if bpmPreset === 'custom'}
      <label class="slider">
        <span class="slider-label">Custom · {bpm} BPM</span>
        <input
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          step="1"
          bind:value={bpm}
          aria-valuemin={MIN_BPM}
          aria-valuemax={MAX_BPM}
          aria-valuenow={bpm}
          aria-label="Custom metronome tempo in beats per minute"
        />
        <span class="slider-range">
          <span>{MIN_BPM}</span>
          <span>{MAX_BPM}</span>
        </span>
      </label>
    {/if}
  {/if}

  {#if drill === 'skip-measures'}
    <div class="skip-row">
      <span>Every</span>
      <input
        type="number"
        min={MIN_SKIP}
        max={MAX_SKIP}
        step="1"
        bind:value={skipEvery}
        disabled={playing}
        onblur={() => {
          skipEvery = clamp(Number(skipEvery) || MIN_SKIP, MIN_SKIP, MAX_SKIP)
        }}
        aria-label="Play this many beats or measures before skipping"
      />
      <select
        bind:value={skipUnit}
        disabled={playing}
        aria-label="Skip unit"
      >
        <option value="measures">Measures</option>
        <option value="beats">Beats</option>
      </select>
      <span>skip</span>
      <input
        type="number"
        min={MIN_SKIP}
        max={MAX_SKIP}
        step="1"
        bind:value={skipAmount}
        disabled={playing}
        onblur={() => {
          skipAmount = clamp(Number(skipAmount) || MIN_SKIP, MIN_SKIP, MAX_SKIP)
        }}
        aria-label="Number of beats or measures to skip"
      />
    </div>
  {/if}

  {#if drill === 'random-skip'}
    <div class="skip-row">
      <span>Skip</span>
      <input
        type="number"
        min={MIN_SKIP}
        max={MAX_SKIP}
        step="1"
        bind:value={randomSkipMin}
        disabled={playing}
        onblur={clampRandomSkipRange}
        aria-label="Minimum beats to skip"
      />
      <span>to</span>
      <input
        type="number"
        min={MIN_SKIP}
        max={MAX_SKIP}
        step="1"
        bind:value={randomSkipMax}
        disabled={playing}
        onblur={clampRandomSkipRange}
        aria-label="Maximum beats to skip"
      />
      <span>beats</span>
    </div>
  {/if}
</main>

<style>
  .player {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 24px;
    flex-grow: 1;
    width: min(32rem, calc(100% - 48px));
    margin: 0 auto;
    padding: 16px 0 48px;
    text-align: center;
  }

  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    width: 100%;
  }

  .stage {
    position: relative;
    width: min(20rem, 100%);
    aspect-ratio: 1;
    display: grid;
    place-items: center;
  }

  .wheel-frame {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }

  .tempo {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    z-index: 1;
    transition: transform 80ms ease-out;
  }

  .tempo-bpm {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 10px;
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

  .bar-readout {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--text);
  }

  .slider,
  .duration,
  .field,
  .choices {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    width: 100%;
  }

  .field-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .help-anchor {
    position: relative;
    flex-shrink: 0;
  }

  .help-trigger {
    display: grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
  }

  .help-trigger:hover {
    border-color: var(--accent-border);
    color: var(--accent);
  }

  .help-trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .help-trigger[aria-expanded='true'] {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent);
  }

  .help-bubble {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 22;
    width: min(18rem, calc(100vw - 48px));
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 8px 24px rgba(8, 6, 13, 0.12);
    text-align: left;
  }

  .help-bubble p {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
    color: var(--text-h);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }

  .choices {
    margin: 0;
    padding: 0;
    border: 0;
    min-inline-size: 0;
  }

  .slider-label {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text);
  }

  .choices legend.slider-label {
    float: left;
    width: 100%;
    padding: 0;
    margin-bottom: 10px;
  }

  .choices::after {
    content: '';
    display: table;
    clear: both;
  }

  .choice-list {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .choice-list.segmented {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0;
    justify-content: stretch;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    background: var(--bg);
  }

  .choice-list.segmented.swing-presets {
    grid-template-columns: repeat(8, minmax(0, 1fr));
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-h);
    cursor: pointer;
  }

  .segmented .choice {
    position: relative;
    justify-content: center;
    gap: 0;
    padding: 10px 4px;
    border: 0;
    border-radius: 0;
    box-shadow: 1px 0 0 var(--border);
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0;
    white-space: nowrap;
  }

  .choice:has(input:checked) {
    border-color: var(--accent);
    background: var(--accent-bg);
  }

  .segmented .choice:has(input:checked) {
    border-color: transparent;
    background: var(--accent-bg);
    font-weight: 700;
  }

  .choice:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .segmented .choice:has(input:focus-visible) {
    outline-offset: -2px;
    z-index: 1;
  }

  .choice input {
    accent-color: var(--accent);
    margin: 0;
    cursor: pointer;
  }

  .segmented .choice input {
    appearance: none;
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .choice:has(input:disabled) {
    cursor: not-allowed;
    opacity: 0.65;
  }

  .slider input {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .slider input:disabled,
  .duration input:disabled,
  .field select:disabled,
  .skip-row input:disabled,
  .skip-row select:disabled,
  .choice input:disabled {
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

  .duration input,
  .skip-row input {
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

  .skip-row input {
    width: 4.5rem;
  }

  .field select,
  .skip-row select {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text-h);
    font: inherit;
    font-size: 18px;
    text-align: center;
    cursor: pointer;
  }

  .skip-row select {
    width: auto;
    min-width: 9rem;
  }

  .field select:focus-visible,
  .skip-row select:focus-visible,
  .skip-row input:focus-visible,
  .duration input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .skip-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px 10px;
    width: 100%;
    color: var(--text-h);
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
