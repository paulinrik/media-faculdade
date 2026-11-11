/* Cache offline do Média da Univali — versão atualizada */
const CACHE_NAME = 'media-univali-v4';
const APP_FILES = ['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icons/favicon.png','./icons/apple-touch-icon.png','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  const isAppCode = /\.(?:js|css|html)$/.test(url.pathname);
  if (request.mode === 'navigate' || isAppCode) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request.mode === 'navigate' ? './index.html' : request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
    return response;
  })));
});
