# Implementation Plan: Storefront Plan A (P1-32) Decisions & Documentation

Implement Plan A (P1-32) of the khsalon.com storefront plan set (`docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-plan-a-decisions.md`), establishing decisions D-51 to D-61, assumption A-23, status board rows P1-32 to P1-38, blockers B-54 to B-61, and context map updates on a dedicated git feature branch.

## User Intent & Requirements
- **Target**: Execute Plan A (P1-32) as specified in `docs/plans/will-be-implemented/`.
- **Branch**: Create and checkout `claude/storefront-p1-32` from `origin/main`.
- **Docs Only**: No database migration or application code in this task; all changes are documentation, status board, decision log, and activity protocol records.

## Proposed Changes

### 1. Git Branch Setup
- Create and checkout feature branch `claude/storefront-p1-32` from `origin/main`.

### 2. Decision Log Updates (`docs/12-decisions-and-open-questions.md`)
- Record decisions D-51 through D-61 verbatim quoting MJ's explicit instructions from chat (2026-11-10):
  - D-51: Public shop added to Phase 1 scope (P1-32 to P1-38).
  - D-52: Public catalogue read access for published SKUs at default price.
  - D-53: Shopify checkout and payment integration.
  - D-54: DMS as single source of truth for catalogue master.
  - D-55: Public brand names (Musk, Lunex, Kemon); KH Enterprises trading name; KH Salon physical salon.
  - D-56: First-party analytics tracking without external third-party tracking scripts.
  - D-57: Two buyers (direct consumer and client salon).
  - D-58: Single default market price; custom per-salon prices shown exclusively inside salon portal.
  - D-59: Single office review queue handling Regular User and Client Salon orders.
  - D-60: Automated delivery timeline tracking and repeated owner/manager email reminders.
  - D-61: Rider delivery for Regular User orders with manager/owner completion marking.
- Add Assumption A-23 regarding salon client order flow from public product pages.

### 3. Status Board & Blockers (`docs/ACTIVITY.md`)
- Add rows P1-32 to P1-38 to the status board (all set to NOT STARTED).
- Add Blockers B-54 through B-61 to the blockers table.
- Update Blocker B-10 status.

### 4. Context Map (`CONTEXT-MAP.md`)
- Add the eighth context, "storefront", defining its domain vocabulary: visitor, visit, published, default price, storefront event.

### 5. Activity Log (`docs/log/2026-11-10-claude-storefront-decisions.md`)
- Create a `DECISION` activity log entry following the Kiran DMS Activity protocol.
- Run `node scripts/activity-log-check.mjs origin/main HEAD` and `pnpm agent:preflight`.
- Commit changes to branch `claude/storefront-p1-32`.

## Verification Plan

### Automated Checks
1. Run `pnpm agent:preflight` from repository root.
2. Run `node scripts/activity-log-check.mjs origin/main HEAD` to verify log protocol compliance.
