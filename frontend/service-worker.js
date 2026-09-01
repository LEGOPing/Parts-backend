const CACHE_NAME = 'lego-parts-v81';
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
            // 清理旧版本缓存，但保留最新的零件图片离线缓存（part-images-cache-v2）
            // 删除 v1（其中存有 data URL 字符串，浏览器无法解析为图片二进制）
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName !== 'part-images-cache-v2') {
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
    
    // POST/PATCH/DELETE: network-first
    if (request.method === 'POST' || 
        request.method === 'PATCH' || 
        request.method === 'DELETE') {
        event.respondWith(fetch(request).catch(() => {
            return caches.match(request);
        }));
        return;
    }
    
    // Gitee Parts-img 零件图片：缓存优先（手动上传 + 自动缓存）
    if (url.hostname.includes('gitee.com') && url.pathname.includes('Parts-img')) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).catch(() => caches.match(request));
            })
        );
        return;
    }
    
    // API (supabase, gitee 非图片): network-first
    if (url.hostname.includes('supabase.co') || url.hostname.includes('gitee.com')) {
        event.respondWith(fetch(request).catch(() => {
            return caches.match(request);
        }));
        return;
    }
    
    if (request.method === 'GET') {
        // 导航请求(HTML页面)和JS/CSS: network-first, 确保界面更新
        const isDynamicResource = request.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
        
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
                    return caches.match(request).then((cached) => cached || caches.match('./index.html'));
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
