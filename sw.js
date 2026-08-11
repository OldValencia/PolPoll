/* PolPoll service worker - the whole app is static, so it can run fully offline.
   Bump CACHE_VERSION whenever the shell or the question base changes. */
const CACHE_VERSION = 'polpoll-v2-12';

const SHELL = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './questions.js',
    './timeline.js',
    './manifest.webmanifest',
    './assets/icon.svg',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './assets/outfit-latin.woff2',
    './assets/outfit-latin-ext.woff2'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            // addAll rejects the whole install if one entry 404s; tolerate misses.
            .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    if (new URL(request.url).origin !== self.location.origin) return;

    // Stale-while-revalidate: instant offline start, quiet background refresh.
    event.respondWith(
        caches.match(request).then(cached => {
            const network = fetch(request).then(response => {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
                }
                return response;
            }).catch(() => cached);

            return cached || network;
        })
    );
});
