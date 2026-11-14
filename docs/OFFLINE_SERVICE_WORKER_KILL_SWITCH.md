# Service Worker Kill Switch Procedure

This document provides the emergency procedure to deactivate, unregister, and purge the Campus Canteen service worker (`/sw.js`) from all user devices (including installed PWAs and Android TWAs).

---

## 1. When to Use

Deploy this tombstone worker if:
- A regression or bug is identified in `/sw.js`.
- Navigation caching behavior causes unintended side effects.
- Complete deactivation of all offline service workers is required across production clients.

---

## 2. Emergency Tombstone Worker Content

To kill the service worker, replace the contents of `public/sw.js` with the following tombstone script:

```javascript
/**
 * Campus Canteen Service Worker Tombstone (Kill Switch)
 *
 * Immediately unregisters the active service worker registration and deletes all caches.
 */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 1. Delete all existing caches
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));

      // 2. Unregister this service worker registration
      await self.registration.unregister();

      // 3. Take control to force clients to unhook
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
});
```

---

## 3. Deployment Steps

1. Replace `public/sw.js` with the tombstone script above.
2. Commit and deploy to production (Vercel).
3. Because `next.config.ts` enforces `Cache-Control: no-cache, no-store, must-revalidate` on `/sw.js`, user browsers and TWAs will fetch the updated `sw.js` on their next visit.
4. As soon as the tombstone activates:
   - All offline caches (`campbite-offline-v2` and earlier versions) are deleted.
   - `self.registration.unregister()` permanently removes the worker from the browser.
   - Any open tabs are refreshed to run cleanly without a service worker.
