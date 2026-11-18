/* TimeOff service worker.
 *
 * Deliberately conservative: leave data is private and per-user, so HTML
 * pages and API responses are NEVER cached. Only static assets are cached,
 * plus an offline fallback page shown when a navigation fails.
 * Bump VERSION to invalidate old caches.
 */
const VERSION = 'v1'
const STATIC_CACHE = `timeoff-static-${VERSION}`
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/img/icon-192.png', '/css/style.css']
const STATIC_PREFIXES = ['/css/', '/js/', '/fonts/', '/img/']

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k.startsWith('timeoff-static-') && k !== STATIC_CACHE)
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Page navigations: always network, fall back to offline page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  // Static assets: stale-while-revalidate.
  if (STATIC_PREFIXES.some(p => url.pathname.startsWith(p))) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache =>
        cache.match(req).then(cached => {
          const network = fetch(req)
            .then(res => {
              if (res.ok) cache.put(req, res.clone())
              return res
            })
            .catch(() => cached)
          return cached || network
        })
      )
    )
  }
  // Everything else (API, feeds, exports): untouched, straight to network.
})
