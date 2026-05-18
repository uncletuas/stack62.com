/**
 * Stack62 service worker — v4 (2026-05-18).
 *
 * The previous version cached every successful GET response, including
 * index.html. After a deploy the browser would receive a fresh SW, but
 * users still saw the OLD app because the cached index.html pointed at
 * the OLD content-hashed bundles. The "deploy worked but nothing
 * changed" loop.
 *
 * Strategy now:
 *   - HTML / navigation requests: NETWORK-ONLY with `cache: 'no-store'`
 *     so neither the SW cache nor the browser HTTP cache can serve a
 *     stale shell. This is the one rule that actually makes deploys
 *     visible.
 *   - Hashed static assets (JS, CSS, fonts, images under /assets/):
 *     cache-first. Their filenames change on every build, so a cached
 *     copy is always correct for its URL.
 *   - Everything else: network-first, no caching.
 *
 * Bump CACHE_NAME on any change to this file so old SWs evict their
 * caches the moment the new one activates.
 */
const CACHE_NAME = "stack62-shell-v4";

self.addEventListener("install", () => {
  // Take over the page on first install without waiting for tabs to
  // close. The activate handler below evicts any prior version's cache.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Evict every cache that isn't this version's, including the
      // legacy `stack62-shell-v1` that's been serving you stale HTML.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/v1/")) return; // API — never cache.

  // NAVIGATION / HTML — always network, never cache. This is the fix.
  const accept = req.headers.get("accept") || "";
  const isNavigation =
    req.mode === "navigate" ||
    req.destination === "document" ||
    accept.includes("text/html");

  if (isNavigation) {
    event.respondWith(
      fetch(req, { cache: "no-store" }).catch(
        () =>
          new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title><body style=font:14px system-ui;padding:24px>Stack62 is offline. Reconnect and refresh.</body>",
            { headers: { "Content-Type": "text/html" }, status: 503 },
          ),
      ),
    );
    return;
  }

  // HASHED STATIC ASSETS — cache-first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Everything else — network with no caching.
  event.respondWith(fetch(req).catch(() => caches.match(req) as Promise<Response>));
});
