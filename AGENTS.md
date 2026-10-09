# AGENTS.md

## Project Summary
Campus Canteen is a campus-focused digital food pre-ordering and smart pickup platform designed to eliminate crowded queues during short break periods. Students and authorized campus members can pre-order meals and snacks before their breaks and collect their freshly prepared items with minimal waiting using an order ID or token. The system optimizes the physical canteen workflow into a streamlined Digital Pre-Order → Preparation → Quick Pickup model.

## Technology Stack
- **Framework**: Next.js (App Router, React 19, TypeScript)
- **Styling & UI**: Tailwind CSS (v4), shadcn/ui (Button, Card, Input, Sonner), Lucide React
- **Backend & Database**: Supabase (PostgreSQL, Auth, SSR, Realtime)
- **Validation & Utilities**: Zod, date-fns
- **Hosting & Deployment**: Vercel

## Folder Conventions
- `src/app`: Next.js App Router routes, layouts, and page views
- `src/components`: Reusable client and server UI components (including `src/components/ui` for shadcn primitives)
- `src/lib`: Shared helper utilities, libraries, and Supabase client initializers (`src/lib/supabase`)
- `src/server`: Server-only logic, data access, actions, and server-side business workflows
- `supabase/migrations`: Supabase schema definitions, database migrations, and SQL scripts
- `docs`: Architecture documentation, specifications, and PRD references

## Core Rules & Guidelines
1. **Validate every mutation on the server with Zod**: All inputs to Server Actions and API route handlers must be rigorously validated using Zod schemas.
2. **Never trust the frontend**: The client is completely untrusted for business logic, pricing calculations, item availability, and state management.
3. **Role checks happen on the server**: Enforce role-based access control (Student, Staff, Admin) strictly on the server layer before performing any operation.
4. **Order status changes only through defined server functions**: Order lifecycle transitions (PLACED → ACCEPTED → PREPARING → READY → COLLECTED / CANCELLED) must strictly occur via explicit, audited server-side functions.
5. **Mobile-first**: Design and build every screen and interaction with smartphone touch targets and responsive mobile layouts prioritized first.
6. **No features beyond the current phase**: Strictly implement features scoped to the active phase. Do not add future or out-of-scope capabilities prematurely.
7. **Never commit secrets**: Keep environment variables and secret credentials out of source control. Use `.env.example` as a template.
8. **Keep everything Vercel-compatible**: No local filesystem writes (`fs`), and no long-running background daemon processes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
