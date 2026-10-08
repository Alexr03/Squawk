// Service worker (production builds only; vite.config.ts fills in the version and the precache list).
// App shell precached; index.html network-first; hashed /assets/* (data packs too) cache-first on first use.
// The Whisper/transformers chunk and model files are left alone: transformers.js caches its models itself.
const SHELL = 'squawk-shell-__VERSION__';
const ASSETS = 'squawk-assets'; // hashed file names, so it can outlive versions
const PRECACHE = __PRECACHE__;
const SKIP = /transformers|ort-wasm|onnx/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('squawk-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || SKIP.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(r => {
        if (r.ok && url.pathname === new URL('./', location).pathname) { const copy = r.clone(); caches.open(SHELL).then(c => c.put('./', copy)); }
        return r;
      })
      .catch(async () => (await caches.match(req)) ?? caches.match('./')));
  } else if (url.pathname.includes('/assets/')) {
    // ponytail: squawk-assets never prunes old hashes; fine at a few MB per release, prune on activate if it grows.
    e.respondWith(caches.match(req).then(hit => hit ?? fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(ASSETS).then(c => c.put(req, copy)); }
      return r;
    })));
  }
});
