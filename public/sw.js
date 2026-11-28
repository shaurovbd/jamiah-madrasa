/*
 * Service worker: lets the panel and the guardian portal be installed on a
 * phone's home screen and open like an app.
 *
 * It caches only the look of the site — CSS, scripts, icons, fonts — never a
 * page. Pages always come from the server (they hold students' and staff
 * data, and must be current), and without a connection the user gets a short
 * "you are offline" page instead of the browser's error.
 */
const VERSION = 'jsi-v1';
const STATIC = new RegExp('^/(css|js|icons|img)/|\\.(css|js|png|svg|woff2?)$');

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['/offline.html', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com';
  if ((sameOrigin && STATIC.test(url.pathname) && !url.pathname.startsWith('/uploads/')) || isFont) {
    // Show the saved copy at once, and refresh it in the background.
    e.respondWith(caches.open(VERSION).then((cache) => cache.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })));
  }
});
