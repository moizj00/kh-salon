# Kiran DMS — Implementation Plan: P1-09 Offline Rep App (Tasks 6 to 11)

Implement Tasks 6 through 11 of the P1-09 offline-first sales representative PWA plan (`docs/plans/in-progress/2026-11-08-p1-09-offline-rep-app.md`) directly in the cloned `kiran-dms` repository on dedicated feature branches, complete with automated specs, formal `docs/log/` Activity entries, and status board updates.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following parameters were confirmed by MJ (Owner) in Phase 1:
>
> - **Target Plan**: Implement **P1-09 Offline Rep App (Tasks 6 to 11)** from `docs/plans/in-progress/2026-11-08-p1-09-offline-rep-app.md`.
> - **Execution Location**: Commit and verify inside the cloned `kiran-dms` repository on a clean git feature branch (`claude/p1-09-offline-rep-app`).
> - **Protocol & Logging Compliance**: Follow the full Kiran DMS Activity protocol: keep the single log entry in `docs/log/`, execute preflight/checks, update `docs/ACTIVITY.md` status board, and adhere to hard security rules H-01 through H-27.
> - **PR Split Structure**:
>   - **PR B (Task 6)**: Installable shell that opens offline (`sw.js`, `manifest.ts`, `register-sw.ts`, rep layout wiring, and `e2e/offline-shell.spec.ts`).
>   - **PR C (Tasks 7 to 9)**: Encrypted read cache (`cachedRows`), status UI (`components/outbox-status.tsx`), field actions through outbox, and delivery with signature dependencies.
>   - **PR D (Tasks 10 & 11)**: Device registration concurrency fix (B-20), sign-out wipe, activity log entry, and status board update.

---

## 1. Overview & Core Concept

- **What It Does**: Completes the offline field sales application for Kiran Company reps across Karachi salon routes. The app functions as an installable standalone PWA, caches salon rosters and routes locally using Web Crypto AES-GCM encryption, writes all mutations ahead to IndexedDB, and automatically drains them to the database once connectivity is restored.
- **Target Audience**: Salaried sales representatives operating on low-end Android mobile devices with patchy network connectivity in commercial salon areas (Clifton, Saddar, DHA, Gulshan).
- **Key Value**: Zero lost visits, orders, or cash receipts; cryptographic protection of cached salon balances at rest; zero false inventory variances; and atomic delivery verification with digital signatures.

---

## 2. User Experience & Visual Design

### Key Workflows

1. **Standalone PWA Installation & Offline Launch (Task 6)**:
   - Service worker caches core bundle and static assets cache-first.
   - Navigating to `/app` offline renders the shell and cached views seamlessly with zero browser network error pages.
2. **Encrypted Read Cache (Task 7)**:
   - Visiting `/app/salons`, `/app/route`, or `/app/day` fetches latest rows network-first, encrypting and storing a copy in IndexedDB.
   - When offline, data loads from the local encrypted cache with a discreet "Offline copy from {time}" marker.
3. **Outbox Status & Field Action Flow (Task 8)**:
   - Top status banner displays pending items (e.g. `Waiting to send (3)`), sync state, and expandable *Needs Attention* list for server rejections.
   - Rep logs visits, notes, intake cards, payments, and lost demand; each operation saves instantly on the phone.
4. **Offline Delivery with Signature (Task 9)**:
   - On `/app/orders/[id]/deliver`, rep captures customer signature.
   - Delivery submission queues as parent; signature queues with `dependsOn: { itemId: deliveryId, argName: "p_submission_id" }`.
5. **Sign-Out Data Wipe & Device Safety (Task 10)**:
   - Signing out or device revocation securely purges the local outbox and decrypted caches.

### Visual & Touch Ergonomics

- Minimalist, high-contrast design optimized for outdoor daylight glare.
- All touch targets $\ge 44 \times 44\text{px}$.
- No decorative status pills; clean typographic separators (`·`).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Native Service Worker over Legacy Libraries**
  - *Chosen Approach*: Lightweight hand-crafted `public/sw.js` with explicit route exclusions (`/office`, `/salon`, `/auth`, `rpc`).
  - *Why*: Keeps bundle under the strict 300 KB gzipped limit for low-end phones (NFR-02) and avoids brittle bundler plugins.
- **Decision 2: Mutating Exclusively via `submit()`**
  - *Chosen Approach*: Replace direct `rpc()` calls across rep action forms with `submit()`.
  - *Why*: Unifies online and offline handling into one reliable write-ahead path.
- **Decision 3: Non-Blocking Web Locks for Device Registration (B-20)**
  - *Chosen Approach*: Use `navigator.locks.request("kiran.device", ...)` instead of `CLAIM_KEY` in localStorage.
  - *Why*: Completely resolves tab race conditions without 30-second stale claim timeouts if a tab crashes.

---

## 4. Technical Architecture & Task Breakdown

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│               REP PWA CONTAINER (apps/web/app/app)                     │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │   PWA Service Worker (public/sw.js & manifest.ts)            │     │
│   └──────────────────────────────┬───────────────────────────────┘     │
│                                  │                                     │
│   ┌──────────────────────────────▼───────────────────────────────┐     │
│   │   Rep App Layout & OutboxStatus Component                    │     │
│   │   • Pending count badge  • Last sync time  • Needs Attention │     │
│   └──────────────┬───────────────────────────────▲───────────────┘     │
│                  │                               │                     │
│                  ▼ (Mutate via submit)           │ (Read via cache)    │
│   ┌──────────────────────────────┐ ┌─────────────┴─────────────────┐   │
│   │     OUTBOX SYSTEM (Core)     │ │    ENCRYPTED READ CACHE       │   │
│   │  • classify.ts / queue.ts    │ │  • cache.ts                   │   │
│   │  • drain.ts (backoff & deps) │ │  • cachedRows<T>(key, load)   │   │
│   │  • store-idb.ts (AES-GCM)    │ │  • AES-GCM sealed IndexedDB   │   │
│   └──────────────┬───────────────┘ └───────────────────────────────┘   │
│                  │                                                     │
│                  ▼ (RPC calls when online)                             │
└──────────────────┼─────────────────────────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     SUPABASE POSTGRES BACKEND                          │
│   • app.log_visit, app.rep_record_payment, app.create_salon            │
│   • app.rep_submit_delivery & app.rep_attach_signature                 │
│   • app.rep_check_in & app.rep_check_out                               │
└────────────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Task Execution

1. **Git Branch & Preflight**:
   - Create feature branch `claude/p1-09-offline-rep-app` from latest `origin/main` in `/tmp/kiran-dms`.
   - Run baseline preflight and checks.

2. **Task 6 — Installable Shell That Opens Offline**:
   - Create `apps/web/public/sw.js`: cache-first for `/_next/static/*`, network-first navigation fallback for `/app`, strict bypass for `/office`, `/salon`, `/auth`, `rpc`.
   - Create `apps/web/app/manifest.ts`: standard metadata (`name`, `short_name: "Kiran Rep"`, `start_url: "/app"`, `display: "standalone"`, icons).
   - Create `apps/web/lib/register-sw.ts`.
   - Wire registration into `apps/web/app/app/layout.tsx`.
   - Create `apps/web/e2e/offline-shell.spec.ts`.
   - Verify with tests, typecheck, and lint. Commit Task 6.

3. **Task 7 — Encrypted Offline Read Cache**:
   - Create `apps/web/lib/cache.ts`: `cachedRows<T>(key, loadFn)` leveraging `sealJson`/`openJson`.
   - Wire read caching into `salons/page.tsx`, `salons/new/page.tsx`, `components/lost-demand.tsx`, `salons/[id]/page.tsx`, `rep-day.tsx`, and `orders/page.tsx`.
   - Create `apps/web/e2e/cache.spec.ts`.
   - Verify and commit Task 7.

4. **Task 8 — Outbox Status UI & Field Actions**:
   - Create `apps/web/components/outbox-status.tsx`: pending counter, last sync, *Needs Attention* list with Retry and Discard.
   - Mount `<OutboxStatus />` and `startSync` in `apps/web/app/app/layout.tsx`.
   - Wire `log_visit`, `add_salon_note`, `create_salon`, `rep_create_card`, `rep_record_payment`, and `record_demand` through `submit()`.
   - Create `apps/web/e2e-stack/offline.spec.ts` (part 1).
   - Verify and commit Task 8.

5. **Task 9 — Check-In, Check-Out, Delivery & Signature**:
   - Wire `rep_check_in`, `record_count`, and `rep_check_out` in `apps/web/app/app/rep-day.tsx`.
   - Wire `rep_submit_delivery` and `rep_attach_signature` with `dependsOn` in `apps/web/app/app/orders/[id]/deliver/page.tsx`.
   - Complete part 2 of `offline.spec.ts`.
   - Verify and commit Task 9.

6. **Task 10 — Device Registration Concurrency & Sign-Out Wipe (B-20)**:
   - Update `apps/web/lib/supabase/browser.ts` with `navigator.locks.request("kiran.device", ...)` and wipe on revocation.
   - Add sign-out wipe confirmation in `apps/web/app/app/account/page.tsx`.
   - Create `apps/web/e2e/device-lock.spec.ts`.
   - Verify and commit Task 10.

7. **Task 11 — Activity Log Entry & Status Board Update**:
   - Update `docs/ACTIVITY.md`: P1-09 status board row and B-20 blocker resolution.
   - Create Activity log entry in `docs/log/YYYY-MM-DD-claude-p1-09-offline-rep-app.md` with complete evidence and security checklist.
   - Run `pnpm activity:check origin/main HEAD`, `pnpm typecheck`, `pnpm lint`.
