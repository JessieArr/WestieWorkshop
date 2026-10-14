let artwork = null

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'artwork' || !(data.buffer instanceof ArrayBuffer)) {
    return
  }
  artwork = new Blob([data.buffer], { type: 'image/png' })
  event.ports[0]?.postMessage({ ok: true })
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (!url.pathname.endsWith('/lock-artwork.png') || !artwork) {
    return
  }
  event.respondWith(
    new Response(artwork, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    }),
  )
})
