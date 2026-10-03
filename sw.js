// Caches the app shell so the app opens offline.
// Bump VERSION here and APP_VERSION in js/core.js together on every release.
// Files come from the versioned cache, so files of two releases never mix; only a file the cache
// lacks (for example after the browser cleared it) goes to the network and is kept from then on.
// A new release arrives only once the new service worker is installed.
// List every file the app loads in SHELL, so the first launch already works offline. A listed file that
// does not exist makes the install fail.
const VERSION = 'kantar-v20';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/core.js', 'js/views.js', 'js/plan.js', 'js/db.js', 'js/ai.js', 'js/exif.js', 'js/export.js', 'js/picture.js', 'js/backup.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' bypasses the browser's HTTP cache and the version in the address stops a host's CDN from
  // answering with the previous release's file
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(`${u}?v=${VERSION}`, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  // Only this app's caches: other apps on the same host share the origin
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('kantar-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // leave API calls alone
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) e.waitUntil(c.put(e.request, res.clone()));
      return res;
    } catch (err) {
      const shell = e.request.mode === 'navigate' && await c.match('index.html', { ignoreSearch: true });
      if (shell) return shell;
      throw err;
    }
  })());
});
