const CACHE_NAME = 'lego-parts-v60';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
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
            // 清理所有旧版本缓存（包括v41/v43等遗留缓存）
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('删除旧缓存:', cacheName);
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
    
    // POST/PATCH/DELETE requests or API calls: always go to network
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
        // JS/CSS files: network-first strategy to ensure updates
        const isDynamicResource = (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'));
        
        if (isDynamicResource) {
            event.respondWith(
                fetch(request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseToCache);
                        });
                        return networkResponse;
                    }
                    return caches.match(request);
                }).catch(() => {
                    return caches.match(request);
                })
            );
        } else {
            // Static assets (images, etc.): cache-first strategy
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
                        return caches.match('./index.html');
                    });
                })
            );
        }
    }
});
