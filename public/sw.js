/**
 * Campus Canteen Minimal Offline Navigation Shell Service Worker
 *
 * SCOPE & INVARIANTS:
 * 1. Handles ONLY navigation requests (request.mode === "navigate" && GET).
 * 2. Strictly bypasses all API (/api/*), auth (/auth/*, /login, /signup, /forgot-password, /set-password) paths.
 * 3. Never caches any live application response, session, token, or dynamic page.
 * 4. Precaches ONLY /offline.html on install with strict marker and redirect validation.
 * 5. Serves /offline.html only when the network fetch throws (offline / disconnected).
 */

const CACHE_NAME = "campbite-offline-v1";
const OFFLINE_URL = "/offline.html";
const MARKER = "CAMPBITE_OFFLINE_SHELL_V1";

const INLINE_FALLBACK_HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Offline • C@mpBite</title><style>:root{--bg:#f5efe4;--fg:#181513;--card:#eae2d2;--border:#d4c7b0;--primary:#d9531e;--primary-fg:#fff;}@media(prefers-color-scheme:dark){:root{--bg:#0b0d12;--fg:#e2e8f0;--card:#151720;--border:#2a2e3d;--primary:#d9531e;--primary-fg:#fff;}}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;margin:0;padding:1rem;text-align:center;box-sizing:border-box;}.card{width:100%;max-width:375px;background:var(--card);border:1px solid var(--border);border-radius:1.25rem;padding:2rem 1.25rem;box-shadow:0 10px 25px -5px rgba(0,0,0,0.08);}h1{font-size:1.25rem;font-weight:800;margin:0 0 0.5rem;}p{font-size:0.8125rem;margin:0 0 1.25rem;opacity:0.85;line-height:1.4;}button{width:100%;min-height:44px;background:var(--primary);color:var(--primary-fg);border:none;border-radius:0.75rem;font-size:0.8125rem;font-weight:700;cursor:pointer;touch-action:manipulation;}</style></head><body><div class="card"><h1>You\'re offline</h1><p>Orders you have already placed are safe.</p><button type="button" onclick="window.location.reload()">Retry Connection</button></div></body></html>';

// -----------------------------------------------------------------------------
// 1. Install Phase: Precache /offline.html with strict content validation
// -----------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(OFFLINE_URL, { cache: "reload" });

      // Precache safety: reject if response is not ok, redirected, or wrong content type
      if (!response.ok) {
        throw new Error(`Precache failed: status ${response.status}`);
      }
      if (response.redirected) {
        throw new Error("Precache rejected: response was redirected");
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) {
        throw new Error(`Precache rejected: invalid content-type ${contentType}`);
      }

      // Clone response to verify marker string in body
      const text = await response.clone().text();
      if (!text.includes(MARKER)) {
        throw new Error("Precache rejected: missing marker string");
      }

      const cache = await caches.open(CACHE_NAME);
      await cache.put(OFFLINE_URL, response);

      // Safe here because zero app chunks or scripts are cached
      await self.skipWaiting();
    })()
  );
});

// -----------------------------------------------------------------------------
// 2. Activate Phase: Purge stale caches and claim clients
// -----------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
      // Safe here to immediately provide offline navigation fallback on reload
      await self.clients.claim();
    })()
  );
});

// -----------------------------------------------------------------------------
// 3. Path Bypass Evaluation
// -----------------------------------------------------------------------------
function isBypassedPath(pathname) {
  const p = pathname.toLowerCase();
  return (
    p === "/login" ||
    p.startsWith("/login/") ||
    p === "/signup" ||
    p.startsWith("/signup/") ||
    p === "/forgot-password" ||
    p.startsWith("/forgot-password/") ||
    p === "/set-password" ||
    p.startsWith("/set-password/") ||
    p === "/auth" ||
    p.startsWith("/auth/") ||
    p === "/api" ||
    p.startsWith("/api/")
  );
}

// -----------------------------------------------------------------------------
// 4. Fetch Phase: Navigation fallback only, network-first, no dynamic caching
// -----------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") {
    return;
  }

  // Only handle top-level document navigations
  if (event.request.mode !== "navigate") {
    return;
  }

  const url = new URL(event.request.url);

  // Strictly ignore auth, password recovery, and API navigations
  if (isBypassedPath(url.pathname)) {
    return;
  }

  // Network-first: try network, fallback to offline shell when network throws
  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request);
      } catch {
        try {
          const cached = await caches.match(OFFLINE_URL);
          if (cached) {
            return cached;
          }
        } catch {
          // Ignore cache match errors and fall through to inline fallback
        }
        return new Response(INLINE_FALLBACK_HTML, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    })()
  );
});
