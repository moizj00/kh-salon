# Implementation Plan: Cashless Sales Rep Workflow & Territory Performance Dashboard

This plan updates the **Kiran DMS** system to transition Sales Representatives to a cashless field workflow and provide reps with a territory sales performance dashboard approved by the Office Manager.

---

## 1. User Intent & Business Requirements

- **Cashless Sales Rep Workflow**: Sales Reps will no longer collect or handle cash payments in the field. Reps focus exclusively on salon visits (with GPS coordinates verification), taking wholesale orders, and providing customer support.
- **Direct Bank Transfer & Office Payments**: Salons pay for orders via direct bank transfer, mobile banking, or central office deposits. Payment verification is handled strictly by the Office Manager / Owner.
- **Territory Performance Dashboard**: Reps will have a dedicated dashboard in the Rep View showing:
  1. Total Territory Sales Volume (PKR)
  2. Completed Orders Count
  3. Verified Salon Visit Count
  4. Estimated & Manager-Approved Commission Payout
- **Manager Approval Flow**: Commission payouts and territory sales summaries require explicit review and approval by the Office Manager before being finalized.

---

## 2. Proposed Architecture & Code Changes

### A. Workspace Preview Applet (`/src`)

1. **Rep View Updates (`src/components/rep-view.tsx`)**:
   - Remove "Record Cash Collection" form from the Rep Action panel.
   - Add **Territory Performance Dashboard** tab showing:
     - Total Sales Volume (PKR) for assigned territory
     - Completed Orders Count & Visit Count
     - Manager-Approved Commission Status & Payout Summary
   - Update Rep Check-In to focus on territory route and sample bag verification without requiring cash float handovers.

2. **Office View Updates (`src/components/office-view.tsx`)**:
   - Add **Bank Transfer & Deposit Processing** panel for office staff to record and verify salon payments received via bank transfer or office deposit.
   - Add **Rep Commission & Territory Performance Review** tab allowing managers to review rep sales summaries and approve monthly/weekly commission payouts.

3. **Navigation & Navigation Badges (`src/components/navigation.tsx`)**:
   - Update quick-action badges to reflect cashless workflow and territory metrics.

---

### B. Cloned Repository (`/tmp/kiran-dms`)

1. **Database Migration (`supabase/migrations/20261110000001_cashless_rep_workflow.sql`)**:
   - Create `public.bank_transfer_receipt` table to store direct salon bank transfer references and deposit receipts.
   - Create `public.rep_commission_approval` table to track manager-approved territory sales summaries and commission payouts.
   - Update RPC `app.rep_record_payment` or deprecate direct rep cash collection RPCs in favor of `office_record_bank_transfer()`.
   - Add `app.rep_territory_dashboard(p_rep_id)` `SECURITY DEFINER` function to return manager-approved sales volume, completed orders, visit count, and approved commission.

2. **Web Application Pages (`apps/web/`)**:
   - Update Rep Portal pages to display territory metrics instead of cash ledger.
   - Update Office Portal pages with bank transfer reconciliation and rep commission approval drawer.

---

## 3. Verification Plan

- **Applet Compilation**: Run `compile_applet` and `lint_applet` to verify React UI compilation and TypeScript safety.
- **Typecheck**: Run `pnpm typecheck` in `/tmp/kiran-dms` across all workspace packages.
- **Preflight & Activity Log**: Run `node scripts/activity-log-check.mjs origin/main HEAD` and `pnpm agent:preflight` to ensure governance rules H-01 through H-27 are satisfied.
