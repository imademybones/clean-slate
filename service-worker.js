// Gym Tracker offline app shell — same pattern as Library Tracker v15.
// Caches only same-origin shell assets. Airtable / Cloudflare Worker requests
// always go straight to the network and are never cached.
// Bump CACHE_NAME on every future deploy so old caches are cleared automatically.
const CACHE_NAME = 'gym-tracker-shell-v10';

const SHELL_ASSETS = [
  './',
  './index.html',
  './clean-slate-v11.html',
  './manifest.json',
  './icon-16.png',
  './icon-32.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests for shell assets.
  // Airtable, the Cloudflare Worker proxy, and any other cross-origin call
  // is left completely alone — never intercepted, never cached.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // cache: 'no-cache' makes the browser check with the server every time
  // (a quick 304 when nothing changed). Without it, the HTTP cache keeps
  // handing back the copy GitHub Pages marked fresh for 10 minutes, so a new
  // deploy didn't reach the installed app however often it was reopened.
  const fresh = new Request(event.request.url, { cache: 'no-cache', credentials: 'same-origin' });
  event.respondWith(
    fetch(fresh)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./clean-slate-v11.html')))
  );
});
