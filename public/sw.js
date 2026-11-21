// Minimal service worker so the site can be installed as an app.
// Always goes to the network (chat must be live), falls back to cache for the app shell.
const CACHE = 'chitchat-v1'
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/']))) })
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  e.respondWith(
    fetch(req).then((res) => {
      if (req.mode === 'navigate' && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)) }
      return res
    }).catch(() => caches.match(req).then((r) => r || caches.match('/')))
  )
})
