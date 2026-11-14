# Proposal: Minimal Offline Navigation Shell Service Worker

## 1. Overview & Objective
This proposal documents the minimal architecture required to handle **cold-start offline navigation** in Campus Canteen.

Currently, Campus Canteen operates service-worker-free to strictly avoid caching authenticated pages, live order tokens, cart items, or API credentials. However, when an Android APK (via Trusted Web Activity / WebView) or installed PWA opens while disconnected *before* any page has been cached by the browser, the browser cannot display the static `/offline` page and instead shows a raw browser connectivity error (`net::ERR_INTERNET_DISCONNECTED`).

A minimal navigation-only Service Worker can eliminate this issue without risking any data leakage or stale-session bugs.

---

## 2. Minimal Implementation Specification

### Scope & Constraints
1. **Navigation Requests Only (`request.mode === 'navigate'`)**:
   - The Service Worker must **only** intercept top-level navigation requests.
   - It must **never** intercept or cache API requests (`/api/*`), Supabase requests (`*.supabase.co/*`), or Server Actions (POST requests with `next-action` headers).
2. **Network-First with Fallback**:
   - For all navigation requests, try the network first (`fetch(event.request)`).
   - If the network fails (offline / DNS resolution error), serve the pre-cached static `/offline` HTML shell.
3. **Pre-Cache Allow-list (Installation Phase)**:
   - On install (`self.addEventListener('install', ...)`), cache **only**:
     - `/offline` (static offline shell HTML)
     - `/icons/icon-192.png`
     - `/brand/campbite-logo.png`
     - Minimal CSS bundle required for the offline shell.
4. **Cache Invalidation & Activation**:
   - On service worker activate (`self.addEventListener('activate', ...)`), clear any previous cache versions.
   - Call `self.clients.claim()` so the active service worker takes control immediately.

---

## 3. Risks & Mitigations

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Stale Auth / Role Leakage** | A student logs out or switches accounts, but the Service Worker serves a cached student layout or cart. | **Strictly prohibit caching any authenticated route.** The service worker cache must contain *only* `/offline` and static public icons. No wildcard caching. |
| **Zombie Service Worker in WebView** | Android WebView sometimes delays fetching service worker updates, leaving users on old application code. | Set HTTP caching headers on `sw.js` to `Cache-Control: no-cache, no-store, must-revalidate`. Call `registration.update()` on app resume. |
| **Vercel Dynamic Header Interference** | Caching SSR responses could cache `Set-Cookie` headers or Supabase session tokens. | Because the Service Worker **never caches navigation responses dynamically** (only serves the pre-cached static `/offline` shell when network throws), SSR headers are never stored. |
| **Cart & Order State Corruption** | In-flight mutations or orders might get intercepted or retried incorrectly. | Service Worker ignores all non-GET requests (`event.request.method !== 'GET'`) and passes them directly to the network. |

---

## 4. Architectural Recommendation
Do **not** install third-party PWA wrapper libraries (such as `next-pwa` or `@ducanh2912/next-pwa`) which inject broad, aggressive workbox caching strategies. If cold-start offline support is desired in the future, implement a single, hand-crafted, 30-line `public/sw.js` that strictly adheres to the navigation-fallback-only model outlined above.
