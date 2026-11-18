/* PWA kill switch.
 *
 * Emergency rollback for the service worker. To use it, copy this file over
 * public/sw.js and deploy:
 *
 *   cp docs/pwa-killswitch-sw.js public/sw.js
 *
 * Browsers re-check /sw.js (it is served with Cache-Control: no-cache), install
 * this version, and it then deletes every cache, unregisters itself and reloads
 * open tabs so they come back with no service worker in control.
 *
 * Afterwards remove the <script src="/js/pwa.js"> tag from views/layouts/main.hbs,
 * otherwise pwa.js will register a fresh worker on the next page load.
 */
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      clients.forEach(c => c.navigate(c.url))
    })()
  )
})

// No fetch handler: every request goes straight to the network.
