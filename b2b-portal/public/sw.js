const CACHE_NAME = 'lamda-b2b-v9-universal';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/isotipo_L_LAMDA.png?v=6'
];

// Install Event: Precachar assets esenciales y activar de inmediato
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch(err => console.warn('SW cache.addAll warning:', err));
    })
  );
});

// Activate Event: Limpiar cachés viejos y tomar control inmediato de los clientes abiertos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('🧹 [SW] Depurando caché obsoleto:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Estrategia híbrida de alto rendimiento y cero retardo de actualización
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. REGLA DE EXCLUSIÓN: APIs, Supabase y métodos no-GET pasan directo por la red
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/auth/') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // 2. DOCUMENTOS HTML Y NAVEGACIÓN: NETWORK-FIRST (Con fallback offline a caché)
  // Garantiza que cualquier cambio de diseño/código impacte INMEDIATAMENTE en los celulares
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Si el celular está sin conexión a internet, entregar la versión en caché
          return caches.match(event.request).then((cached) => cached || caches.match('/index.html'));
        })
    );
    return;
  }

  // 3. ASSETS DE VITE CON HASH (archivos /assets/*.js o /assets/*.css) Y MEDIA
  // Como Vite incluye hashes únicos en el nombre de archivo, pueden servirse con Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Fallback silencioso si no hay red
      });

      return cachedResponse || fetchPromise;
    })
  );
});
