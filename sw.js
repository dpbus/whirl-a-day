// Service worker: makes the app open offline and keeps updates consistent.
//
// - Install: cache the core files, so the app works offline after a single visit.
// - Each page load picks ONE source for all of its files:
//     * the network, if the page itself arrives within a few seconds (normal case: updates
//       show up right away), or
//     * the cache, if the network is slow or offline.
//   Mixing sources within one page could pair new and old modules, which breaks the app.
// - Every network request uses cache: 'no-cache' (a cheap 304 check when unchanged), so the
//   browser's own HTTP cache can't hand back an old file either.
//
// When you add a file the app needs offline, add it to CORE_FILES.
const CACHE = 'whirl-a-day';
const NETWORK_TIMEOUT_MS = 3000;

const CORE_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'css/fonts.css',
  'fonts/fredoka-latin-wght-normal.woff2',
  'fonts/mountains-of-christmas-latin-700-normal.woff2',
  'fonts/creepster-latin-400-normal.woff2',
  'js/main.js',
  'js/state.js',
  'js/wheel.js',
  'js/effects.js',
  'js/themes.js',
  'js/presets.js',
  'js/dialogs.js',
  'js/icons.js',
  'js/templates.js',
  'js/util.js',
  'js/settings/index.js',
  'js/settings/shared.js',
  'js/settings/wheels-tab.js',
  'js/settings/wheel-tab.js',
  'js/settings/players-tab.js',
  'js/settings/general-tab.js',
  'js/settings/backup-tab.js',
  'js/settings/welcome.js',
  'js/vendor/canvas-confetti-1.9.4.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-512.png',
  'sounds/tick-wood-1.wav',
  'sounds/tick-wood-2.wav',
  'sounds/tick-sleigh.wav',
  'sounds/sleigh-shake.wav',
  'sounds/glock-g5.wav',
  'sounds/glock-c6.wav',
  'sounds/glock-g6.wav',
];

/** Which source each open page (client id) uses: 'network' or 'cache'. */
const pageSources = new Map();
const MAX_TRACKED_PAGES = 20;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One missing file shouldn't stop the rest from being cached.
      .then((cache) => Promise.allSettled(CORE_FILES.map((url) => cache.add(new Request(url, { cache: 'no-cache' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only handle our own files; everything else goes straight to the network.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? loadPage(event) : loadFile(event));
});

/** The page itself: network if it's quick, otherwise the cached copy. Remembers the choice. */
async function loadPage(event) {
  const cache = await caches.open(CACHE);
  const cached = (await cache.match(event.request, { ignoreSearch: true })) ?? (await cache.match('./'));
  const network = fetchAndCache(event, event.request);
  if (!cached) {
    rememberSource(event.resultingClientId, 'network');
    return network;
  }
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  const fresh = await Promise.race([network.catch(() => null), timeout]);
  rememberSource(event.resultingClientId, fresh ? 'network' : 'cache');
  return fresh ?? cached;
}

/** A file used by a page: from the same source as that page, falling back to the other. */
async function loadFile(event) {
  const cache = await caches.open(CACHE);
  if (pageSources.get(event.clientId) === 'cache') {
    const cached = await cache.match(event.request);
    if (cached) return cached;
  }
  try {
    return await fetchAndCache(event, event.request);
  } catch {
    return (await cache.match(event.request)) ?? Response.error();
  }
}

/** Fetch from the network and refresh the cache with a copy. */
function fetchAndCache(event, request) {
  // Keep the worker alive until the cache write finishes. waitUntil must be called now,
  // while the event is being handled, not later from inside a promise callback.
  let cacheWritten;
  event.waitUntil(new Promise((resolve) => (cacheWritten = resolve)));
  return fetch(request, { cache: 'no-cache' }).then(
    (response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {}).finally(cacheWritten);
      } else {
        cacheWritten();
      }
      return response;
    },
    (err) => {
      cacheWritten();
      throw err;
    },
  );
}

function rememberSource(clientId, source) {
  if (!clientId) return;
  pageSources.set(clientId, source);
  if (pageSources.size > MAX_TRACKED_PAGES) pageSources.delete(pageSources.keys().next().value);
}
