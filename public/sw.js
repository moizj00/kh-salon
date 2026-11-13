// Kiran DMS Rep App Service Worker (P1-09 Task 6)
// Cache static assets cache-first, navigation network-first with fallback.
// Never cache /office, /salon, auth or RPC endpoints.

const CACHE_NAME = "kiran-dms-pwa-v1";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn("Precache failed partially:", err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Security rule: Never cache office, salon portal, API routes, rpc calls, or auth mutations
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/office") ||
    url.pathname.startsWith("/salon") ||
    url.pathname.includes("/rpc") ||
    url.pathname.includes("/auth") ||
    event.request.method !== "GET"
  ) {
    return;
  }

  // Static assets: Cache First
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".woff2")
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests: Network First with Cache Fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            return cached || caches.match("/index.html") || caches.match("/");
          });
        })
    );
  }
});
