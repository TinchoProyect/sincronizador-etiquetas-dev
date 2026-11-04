// Service Worker para PWA LAMDA Móvil
const CACHE_NAME = 'lamda-movil-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Network-first con fallback a cache
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
