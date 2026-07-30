const CACHE_NAME = 'lego-parts-v41';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/style.css',
    './js/api.js',
    './js/ui.js',
    './js/store.js',
    './js/rb-db.js',
    './manifest.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './icons/LOGO.JPEG',
    './icons/blue2.png',
    './icons/orange2.png',
    './icons/green2.png',
    './icons/red2.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE).catch(() => {
                console.log('Some assets failed to cache');
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    
    if (request.method === 'POST' || 
        request.method === 'PATCH' || 
        request.method === 'DELETE' ||
        url.hostname.includes('supabase.co') ||
        url.hostname.includes('gitee.com')) {
        event.respondWith(fetch(request).catch(() => {
            return caches.match(request);
        }));
        return;
    }
    
    if (request.method === 'GET') {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                
                return fetch(request).then((networkResponse) => {
                    if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                        return networkResponse;
                    }
                    
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                    
                    return networkResponse;
                }).catch(() => {
                    console.log('Fetch failed, returning offline fallback');
                    return caches.match('./index.html');
                });
            })
        );
    }
});