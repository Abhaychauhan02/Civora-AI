// Civora Service Worker
const CACHE_NAME = "civora-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/css/styles.css",
  "/js/app.js",
  "/js/api.js",
  "/js/auth.js",
  "/js/citizen.js",
  "/js/admin.js"
];

self.addEventListener("install", (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (evt) => {
  // Let API requests pass straight through to network
  if (evt.request.url.includes("/api/") || evt.request.method !== "GET") {
    return;
  }
  evt.respondWith(
    caches.match(evt.request).then((res) => {
      return res || fetch(evt.request);
    }).catch(() => caches.match("/"))
  );
});
