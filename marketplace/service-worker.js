/* Public app shell only. Never cache user, checkout, admin, or backend responses. */
const CACHE = "zahara-public-shell-v6";
const BASE = new URL(self.registration.scope);
const SHELL = [
  "index.html",
  "offline.html",
  "manifest.webmanifest",
  "store.css",
  "catalog.js",
  "store.js",
  "pwa.js",
  "icons/app-icon.svg",
  "icons/app-icon-192.png",
  "icons/app-icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/brand-logo.jpeg"
].map((path) => new URL(path, BASE).href);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (response.ok && response.type === "basic") await cache.put(url, response);
      } catch (_) { /* A partial shell still gives users the offline page. */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("zahara-public-shell-") && name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(BASE.href)) return;
  if (url.pathname.includes("/admin") || url.pathname.includes("/functions/") || url.pathname.includes("/rest/v1/")) return;

  if (request.mode === "navigate") {
    const isPlainStoreEntry = url.search === "" && (url.pathname === BASE.pathname || url.pathname === new URL("index.html", BASE).pathname);
    if (!isPlainStoreEntry) {
      event.respondWith(fetch(request).catch(async () => (await caches.match(new URL("offline.html", BASE).href)) || Response.error()));
      return;
    }
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(new URL("index.html", BASE).href, response.clone());
        }
        return response;
      } catch (_) {
        return (await caches.match(new URL("offline.html", BASE).href)) || Response.error();
      }
    })());
    return;
  }

  if (SHELL.includes(url.href)) {
    // Revalidate executable shell files while online so edits do not remain
    // hidden behind a cache-first response. Keep the cached copy for offline use.
    if (/\.(?:js|mjs)$/.test(url.pathname)) {
      event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        try {
          const response = await fetch(new Request(request, { cache: "no-cache" }));
          if (response.ok && response.type === "basic") await cache.put(url.href, response.clone());
          return response;
        } catch (_) {
          return (await cache.match(url.href)) || Response.error();
        }
      })());
      return;
    }
    event.respondWith(caches.match(url.href).then((cached) => cached || fetch(request)));
  }
});
