const CACHE_NAME = 'lego-parts-v87';
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

// 判断是否 API 请求（supabase REST / auth / gitee API）
function isApiRequest(url) {
    if (url.hostname.includes('supabase.co')) {
        // Supabase REST /auth/v1 /rest/v1
        return url.pathname.startsWith('/auth/') ||
               url.pathname.startsWith('/rest/') ||
               url.pathname.startsWith('/storage/');
    }
    if (url.hostname.includes('gitee.com')) {
        return url.pathname.includes('/api/');
    }
    return false;
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // RB 图片：完全绕过 Service Worker
    if (url.hostname === 'cdn.rebrickable.com') {
        return;
    }

    // Gitee Parts-img 零件图片：缓存优先
    if (url.hostname.includes('gitee.com') && url.pathname.includes('Parts-img')) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).catch(() => caches.match(request));
            })
        );
        return;
    }

    // API 请求（supabase auth/rest + gitee API）：network-first
    // fetch 失败时返回错误 Response，而不是 undefined
    if (isApiRequest(url)) {
        event.respondWith(
            fetch(request).then(response => {
                // 克隆一下，返回原 response（不缓存 API 响应）
                return response;
            }).catch(err => {
                console.warn('[SW] API fetch 失败:', url.pathname, err.message);
                // 构造一个失败的 Response，respondWith 不能返回 undefined
                return new Response(
                    JSON.stringify({ error: 'network_error', message: err.message }),
                    { status: 503, headers: { 'Content-Type': 'application/json' } }
                );
            })
        );
        return;
    }

    // 非 API 的 POST/PATCH/DELETE：直接 fetch，失败返回 503
    if (request.method !== 'GET') {
        event.respondWith(
            fetch(request).catch(err => {
                return new Response(
                    JSON.stringify({ error: 'network_error', message: err.message }),
                    { status: 503, headers: { 'Content-Type': 'application/json' } }
                );
            })
        );
        return;
    }

    // GET: 动态资源（HTML/JS/CSS）network-first
    const isDynamicResource = request.mode === 'navigate' ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css');

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
        // 静态资源（图片等）：cache-first
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
});
