/* ------------------------------------------------------------------
 * Compet 2026 — Service Worker
 * Strategy: network-first for API/live data, cache-first for static
 * assets. Offline fallback serves cached shell so the app opens even
 * without connectivity (schedule/tables still render from last fetch).
 * ---------------------------------------------------------------- */

const CACHE_NAME = "compet-v1";

/* Static assets to pre-cache on install — the app shell. */
const PRECACHE = [
  "/",
  "/icon-192.svg",
  "/icon-512.svg",
  "/wc26-logo.svg",
  "/trophy.png",
  "/trionda.png",
];

/* ---- Install: pre-cache the app shell ---- */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

/* ---- Activate: purge old cache versions ---- */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ---- Fetch: network-first for API, stale-while-revalidate for pages,
 *      cache-first for immutable assets ---- */
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  /* Skip non-GET and cross-origin */
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  /* API routes — always network-first, cache the latest response */
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  /* Next.js immutable chunks — cache-first (filename-hashed) */
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(e.request).then(
        (cached) =>
          cached ||
          fetch(e.request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
            return res;
          })
      )
    );
    return;
  }

  /* Everything else — stale-while-revalidate */
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
