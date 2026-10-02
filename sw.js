// Uygulama kabuğunu önbelleğe alır; çevrimdışı açılır.
// Her yayında VERSION ve js/app.js içindeki APP_VERSION birlikte artırılır.
// Dosyalar yalnızca sürümlü önbellekten sunulur: bir sürümün dosyaları birbirine karışmaz,
// yeni sürüm ancak yeni service worker kurulunca gelir.
const VERSION = 'kantar-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/views.js', 'js/plan.js', 'js/db.js', 'js/ai.js', 'js/exif.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' tarayıcının HTTP önbelleğini atlar; eski dosya yeni sürüme sızmaz
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // API çağrılarına dokunma
  e.respondWith(
    caches.open(VERSION)
      .then((c) => c.match(e.request, { ignoreSearch: true }))
      .then((hit) => hit || fetch(e.request)),
  );
});
