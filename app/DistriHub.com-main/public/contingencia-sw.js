const cacheName = 'distrihub-contingencia-v1';
const shell = '/contingencia/index.html';
const assets = [shell, '/contingencia/app.js', '/contingencia/storage.js', '/contingencia/style.css'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('distrihub-contingencia-') && key !== cacheName).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function navigate(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try { return await fetch(request, { signal: controller.signal }); }
  catch {
    const fallback = await (await caches.open(cacheName)).match(shell);
    return fallback ?? Response.error();
  } finally { clearTimeout(timeout); }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (assets.includes(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(url.pathname)).then(cached => cached ?? fetch(request)));
  } else if (request.mode === 'navigate' && url.pathname === '/' && !url.search) {
    event.respondWith(navigate(request));
  }
});
