export type NowPlayingLabel = {
  title: string
  artist: string
  album: string
}

type AudioSessionType = 'auto' | 'playback'

type AudioSession = EventTarget & {
  type: AudioSessionType
  state: 'inactive' | 'active' | 'interrupted'
  onstatechange: ((this: AudioSession, ev: Event) => void) | null
}

type ArtworkWorker = ServiceWorker

let playHandler: (() => void) | null = null
let pauseHandler: (() => void) | null = null
let blobUrl: string | null = null
let artworkVersion = 0
let workerPromise: Promise<ArtworkWorker | null> | null = null

function session(): AudioSession | null {
  return (navigator as Navigator & { audioSession?: AudioSession }).audioSession ?? null
}

export function activateAudioSession(): void {
  const audio = session()
  if (audio) audio.type = 'playback'
}

export function releaseAudioSession(): void {
  const audio = session()
  if (audio) audio.type = 'auto'
}

export function setPlaybackHandlers(onPlay: () => void, onPause: () => void): void {
  playHandler = onPlay
  pauseHandler = onPause
  if (!('mediaSession' in navigator)) return
  const media = navigator.mediaSession
  try {
    media.setActionHandler('play', () => playHandler?.())
    media.setActionHandler('pause', () => pauseHandler?.())
    media.setActionHandler('stop', () => pauseHandler?.())
  } catch {
    // A browser without lock-screen actions leaves playback on the page.
  }
}

export function markPlaybackPlaying(): void {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.playbackState = 'playing'
}

export function markPlaybackPaused(): void {
  releaseAudioSession()
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.playbackState = 'paused'
}

export function clearPlaybackSession(): void {
  playHandler = null
  pauseHandler = null
  releaseAudioSession()
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'none'
    try {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('stop', null)
    } catch {
      // Ignore browsers that reject clearing an action.
    }
  }
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    blobUrl = null
  }
}

export function watchPlaybackInterrupt(onInterrupt: () => void): () => void {
  const audio = session()
  if (!audio) return () => {}
  const previous = audio.onstatechange
  audio.onstatechange = () => {
    if (audio.state === 'interrupted') onInterrupt()
  }
  return () => {
    audio.onstatechange = previous
  }
}

export async function updateNowPlaying(blob: Blob, label: NowPlayingLabel): Promise<void> {
  if (!('mediaSession' in navigator)) return
  const src = await artworkUrl(blob)
  navigator.mediaSession.metadata = new MediaMetadata({
    title: label.title,
    artist: label.artist,
    album: label.album,
    artwork: [{ src, sizes: '512x512', type: 'image/png' }],
  })
}

async function artworkUrl(blob: Blob): Promise<string> {
  const worker = await ensureArtworkWorker()
  if (worker && navigator.serviceWorker.controller) {
    const posted = await postArtwork(worker, blob)
    if (posted) {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
        blobUrl = null
      }
      artworkVersion += 1
      return new URL(
        `${import.meta.env.BASE_URL}lock-artwork.png?v=${artworkVersion}`,
        location.origin,
      ).toString()
    }
  }
  if (blobUrl) URL.revokeObjectURL(blobUrl)
  blobUrl = URL.createObjectURL(blob)
  return blobUrl
}

function ensureArtworkWorker(): Promise<ArtworkWorker | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  if (!workerPromise) {
    workerPromise = registerArtworkWorker().catch(() => {
      workerPromise = null
      return null
    })
  }
  return workerPromise
}

async function registerArtworkWorker(): Promise<ArtworkWorker | null> {
  const registration = await navigator.serviceWorker.register(
    `${import.meta.env.BASE_URL}lock-artwork-sw.js`,
    { scope: import.meta.env.BASE_URL },
  )
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => window.setTimeout(resolve, 1500)),
  ])
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 1500)
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          window.clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
    })
  }
  return registration.active ?? navigator.serviceWorker.controller
}

function postArtwork(worker: ArtworkWorker, blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timeout = window.setTimeout(() => resolve(false), 500)
    channel.port1.onmessage = () => {
      window.clearTimeout(timeout)
      resolve(true)
    }
    blob
      .arrayBuffer()
      .then((buffer) => {
        worker.postMessage({ type: 'artwork', buffer }, [buffer, channel.port2])
      })
      .catch(() => {
        window.clearTimeout(timeout)
        resolve(false)
      })
  })
}
