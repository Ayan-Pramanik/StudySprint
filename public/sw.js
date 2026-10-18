// Lets StudySprint open without a connection. Pages are network-first (a fresh deploy always wins when online) with
// the last copy as fallback; content-hashed /_next/static files never change, so they are served from cache first.
// API requests are never cached here: the app keeps its own offline copy of the workspace and outbox.
const CACHE = 'studysprint-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', event => {
    const request = event.request, url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    if (url.pathname.startsWith('/_next/static/')) {
        event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
            if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
            return response;
        })));
        return;
    }
    const key = request.mode === 'navigate' ? '/' : request;
    event.respondWith(fetch(request).then(response => {
        if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
        return response;
    }).catch(() => caches.match(key).then(hit => hit || Response.error())));
});
