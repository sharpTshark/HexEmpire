const CACHE = 'hexempire-v1'

// Pre-cache the shell on install
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['./']))
  )
  self.skipWaiting()
})

// Activate: drop old caches
self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch: cache-first for same-origin assets, network-first for everything else
self.addEventListener('fetch', evt => {
  if (evt.request.method !== 'GET') return
  evt.respondWith(
    caches.match(evt.request).then(cached => {
      if (cached) return cached
      return fetch(evt.request).then(response => {
        if (response.ok && new URL(evt.request.url).origin === location.origin) {
          const clone = response.clone()
          caches.open(CACHE).then(c => c.put(evt.request, clone))
        }
        return response
      }).catch(() => cached)   // offline fallback: return stale if any
    })
  )
})
