/* PolPoll service worker - the whole app is static, so it can run fully offline.
   Bump CACHE_VERSION whenever the shell or the question base changes. */
const CACHE_VERSION = 'polpoll-v3-6';

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

/* index.html, app.js, style.css, questions.js, timeline.js - everything that has
   to stay in step with everything else. */
const SHELL_PATTERN = /(?:\.(?:html|js|css|webmanifest)|\/)$/;

function cachePut(request, response) {
    if (!response || !response.ok) return response;
    const copy = response.clone();
    caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
    return response;
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    const isShell = request.mode === 'navigate' || SHELL_PATTERN.test(url.pathname);

    if (isShell) {
        /* Network-first. Serving the shell from cache handed out a mix of
           versions after a deploy - a fresh index.html next to a stale app.js -
           which left newly added buttons wired to nothing. Keeping the files in
           step matters more than shaving milliseconds off the load. */
        event.respondWith(
            fetch(request)
                .then(response => cachePut(request, response))
                .catch(() => caches.match(request)
                    .then(cached => cached || caches.match('./index.html')))
        );
        return;
    }

    // Fonts and icons never change without a new filename - cache-first is safe.
    event.respondWith(
        caches.match(request).then(cached =>
            cached || fetch(request).then(response => cachePut(request, response))
        )
    );
});
