# Phase 9: Mobile Polish & Installable PWA Notes

## 1. Web Push Notification Roadmap

### Current Architecture
Currently, Campus Canteen handles real-time updates through:
- **Supabase Realtime**: Postgres change listeners on `orders` and `notifications` tables.
- **Client polling / SWR**: Fallback interval queries when tabs regain focus.
- **In-app UI Toasts & Badges**: Accessible Sonner toasts and unread count badges in the student header.

### Future Web Push Requirements & Implementation Plan
When browser push notifications are implemented in a future phase, the following architecture must be maintained:

1. **Dedicated Push-Only Service Worker**:
   - Must be strictly limited to handling push events (`self.addEventListener('push', ...)` and `notificationclick`).
   - **Crucial Security & Privacy Constraint**: The service worker **MUST NOT** cache authenticated HTML pages, user cart items, order tokens, or API responses.
   - Service worker registration will only occur after explicit user consent.

2. **VAPID Key Generation & Management**:
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: Client-facing public key for subscription generation.
   - `VAPID_PRIVATE_KEY`: Server-side secret stored in environment variables (never committed to repository or exposed to frontend).

3. **Database Schema Additions**:
   - A `push_subscriptions` table mapping `user_id`, `endpoint`, `keys.p256dh`, `keys.auth`, and device metadata, with strict RLS policies allowing users to insert/delete only their own subscriptions.

4. **Server Trigger Integration**:
   - Order lifecycle transitions (e.g., transition to `READY` status in `src/server/actions/order-status.ts`) will dispatch Web Push messages using `web-push` library.

5. **Platform Constraints & Safari Considerations**:
   - **iOS Safari**: Web Push is supported on iOS 16.4+ **only when the app is installed to the home screen** (Standalone PWA mode). The student install prompt and iOS hint introduced in Phase 9 directly prepare students for this prerequisite.
   - **Android Chrome**: Supports Web Push in both browser and standalone PWA modes.

---

## 2. Lighthouse Audit & Verification Checklist

> **Real Output Disclosure**: A live Lighthouse audit was **not run** during this automated build phase in the headless CLI environment. In accordance with project instructions, no synthetic or fabricated scores are reported. The steps below document the verification checklist for running Lighthouse against the application.

### How to Run Lighthouse
1. Start the production build or local preview server:
   ```bash
   npm run build
   npm run start
   ```
2. Open Google Chrome in **Incognito Mode** (to disable extensions that interfere with performance and accessibility).
3. Navigate to `http://localhost:3000` (or the deployed Vercel URL).
4. Open Chrome DevTools (`F12` or `Ctrl+Shift+I` / `Cmd+Option+I`).
5. Select the **Lighthouse** tab.
6. Configure the audit:
   - **Mode**: Navigation (Default)
   - **Device**: Mobile
   - **Categories**: Performance, Accessibility, Best Practices, Progressive Web App (PWA)
7. Click **Analyze page load**.

### What to Verify
- **PWA Criteria**:
  - Valid web app manifest linked via `/manifest.webmanifest`.
  - Service-worker-free standalone configuration: `start_url`, `display: standalone`, `theme_color`, and `background_color`.
  - Icon requirements met: PNG 192x192, 512x512, and maskable 512x512 with safe-zone logo centering.
  - Apple touch icon configured in root `<head>`.
- **Accessibility Criteria**:
  - Touch targets: All buttons, navigation items, steppers, and interactive controls are $\ge 44 \times 44\text{ px}$.
  - Interactive element nesting: No interactive elements (e.g. `<button>`, `<a>`, `<input>`) nested inside other interactive elements or clickable cards. Notification items and menu items are structured with isolated accessible buttons.
  - ARIA attributes: Proper `aria-label` tags on icon-only buttons (bell, close, search, steppers, trash).
  - Color contrast: High-contrast ratios on active/inactive states and badges.
- **Performance Criteria**:
  - Lazy loading: Recharts loaded via isolated dynamic client wrapper (`LazyHourlyOrdersChart`).
  - QR Scanner: Html5Qrcode scanner loaded via dynamic client wrapper (`LazyQrScanner`).
  - No horizontal layout overflow (`overflow-x: hidden` enforced on `html` and `body` at 375px and 768px).
