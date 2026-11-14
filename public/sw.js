// Kiran DMS Rep App Service Worker
// Cache static assets cache-first, navigation network-first with fallback,
// and runtime-cache OpenStreetMap tiles for offline route tracking.
// Never cache /office, /salon, auth or RPC endpoints.

const CACHE_NAME = "kiran-dms-pwa-v2";
const MAP_TILE_CACHE = "kiran-map-tiles-v1";
const MAX_MAP_TILES = 300;
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
  const keepCaches = new Set([CACHE_NAME, MAP_TILE_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => !keepCaches.has(key)).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

async function enforceTileCacheLimit(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length > MAX_MAP_TILES) {
      const overflow = keys.length - MAX_MAP_TILES;
      await Promise.all(keys.slice(0, overflow).map((req) => cache.delete(req)));
    }
  } catch {
    // Ignore eviction errors
  }
}

self.addEventListener("message", (event) => {
  const payload = event.data;
  if (!payload || payload.type !== "PREFETCH_MAP_TILES" || !Array.isArray(payload.urls)) {
    return;
  }

  event.waitUntil(
    caches.open(MAP_TILE_CACHE).then(async (cache) => {
      await Promise.all(
        payload.urls.map(async (tileUrl) => {
          if (typeof tileUrl !== "string") return;
          try {
            const existing = await cache.match(tileUrl);
            if (existing) return;
            const res = await fetch(tileUrl, { mode: "cors", credentials: "omit" });
            if (res.ok) {
              await cache.put(tileUrl, res);
            }
          } catch {
            // Ignore transient network failures during background prefetch
          }
        })
      );
      await enforceTileCacheLimit(cache);
    })
  );
});

function isMapTileRequest(url) {
  return (
    url.hostname === "tile.openstreetmap.org" ||
    url.hostname.endsWith(".tile.openstreetmap.org")
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  // Map tile requests: CacheFirst so previously loaded routes work completely offline
  if (isMapTileRequest(url)) {
    event.respondWith(
      caches.open(MAP_TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const response = await fetch(event.request);
          if (response.ok) {
            await cache.put(event.request, response.clone());
            await enforceTileCacheLimit(cache);
          }
          return response;
        } catch {
          return new Response("", { status: 504, statusText: "Offline tile miss" });
        }
      })
    );
    return;
  }

  // Security rule: Never cache office, salon portal, API routes, rpc calls, or auth mutations
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/office") ||
    url.pathname.startsWith("/salon") ||
    url.pathname.includes("/rpc") ||
    url.pathname.includes("/auth")
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
