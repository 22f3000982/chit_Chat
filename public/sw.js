// Service worker: installable app + push notifications.
// Pages always come from the network (chat must be live); the cache is only an offline fallback.
const CACHE = 'chitchat-v2'
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/']))) })
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
  await self.clients.claim()
})()))
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

// ---------- push notifications ----------
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data && e.data.text() } }
  e.waitUntil((async () => {
    // app already open and in front → no popup needed
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return
    await self.registration.showNotification(d.title || 'Chit Chat', {
      body: d.body || 'New message',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: d.tag || 'chitchat',
      renotify: true,
      vibrate: [80, 40, 80],
      data: { url: d.url || '/' },
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (wins.length) return wins[0].focus()
    return self.clients.openWindow(e.notification.data?.url || '/')
  })())
})
