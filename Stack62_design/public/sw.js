/**
 * Stack62 service worker.
 *
 * Strategy:
 *   - Cache the app shell (index.html + initial bundle) on install
 *     so the workspace boots even if the network is briefly down.
 *   - Network-first for everything else, falling back to the cache
 *     only when the request actually fails. We deliberately don't
 *     stale-while-revalidate API responses — Stack62 is real-time and
 *     showing stale data would be worse than a refused request.
 *   - Skip-waiting + clients.claim so a deploy takes effect on the
 *     next reload without the user having to close every tab.
 *
 * Versioning: bump CACHE_NAME on breaking deploys to force a refetch.
 */
const CACHE_NAME = "stack62-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle GETs; never cache API mutations.
  if (req.method !== "GET") return;
  // Don't touch cross-origin or API requests.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/v1/")) return;

  event.respondWith(
    fetch(req)
      .then((response) => {
        // Cache successful shell responses opportunistically.
        if (response.ok && req.destination !== "video") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then(
          (cached) => cached ?? caches.match("/index.html") as Promise<Response>,
        ),
      ),
  );
});
