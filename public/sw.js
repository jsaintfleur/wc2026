/* ------------------------------------------------------------------
 * Compet 2026 — Service Worker
 * Strategy: network-only for API/live data, cache-first for static
 * assets. Match data must never be served from Cache Storage.
 * ---------------------------------------------------------------- */

const CACHE_NAME = "compet-v7";

/* Static assets to pre-cache on install — the app shell. */
const PRECACHE = [
  "/icons/favicon-16.png",
  "/icons/favicon-32.png",
  "/icons/compet-icon-48.png",
  "/icons/compet-icon-72.png",
  "/icons/compet-icon-96.png",
  "/icons/compet-icon-128.png",
  "/icons/compet-icon-192.png",
  "/icons/compet-icon-512.png",
  "/icons/compet-icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/wc26-logo.svg",
  "/world-cup-26-mark.png",
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
    ).then(() => caches.open(CACHE_NAME))
      .then((cache) => cache.keys())
      .then((requests) => Promise.all(
        requests
          .filter((request) => new URL(request.url).pathname.startsWith("/api/"))
          .map((request) => caches.open(CACHE_NAME).then((cache) => cache.delete(request)))
      ))
  );
  self.clients.claim();
});

/* ---- Fetch: network-only for API, network-first for pages,
 *      cache-first for immutable assets ---- */
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  /* Skip non-GET and cross-origin */
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  /* API routes — always network-only. Do not cache match data. */
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
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

  /* App shell/pages — network-first so installed PWAs pick up leaderboard
     and live-data fixes immediately, with cached fallback for offline use. */
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
