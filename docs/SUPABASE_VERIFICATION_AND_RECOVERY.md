# Kiran DMS — Supabase Production Architecture, Verification & Recovery Guide

## 1. Executive Summary & Authoritative System of Record

The **Kiran Company Supabase PostgreSQL project** is the single authoritative system of record for Kiran DMS (formerly KH Salon). All business logic, authorization, double-entry ledgers, and transactions run strictly against the comprehensive database schema (`app.*` and `public.*` objects).

- **Frontend Runtime**: Vite + React 19 + TypeScript (`/app/applet`).
- **Server Runtime**: Express 4 serving static assets, health checks (`/api/health`), and public config discovery (`/api/auth/config`, `/api/maps/config`, `/api/auth/google-url`, `/auth/callback`).
- **Authentication**: Real Supabase Auth (Email/Password, Email OTP, Google OAuth PKCE, and AAL2 TOTP MFA + Device Binding). Quick Test Demo and demo accounts are completely removed.
- **Database**: PostgreSQL with 47 versioned migrations (`supabase/20261024*` through `supabase/20261116*`), 72 tables, 324 RPC functions in `app` schema.

---

## 2. PostgREST & Supabase Configuration Verification

### Exposing the `app` Schema in Supabase Dashboard
The Kiran Company database isolates business transactions inside the `app` schema (e.g. `app.office_create_order`, `app.rep_submit_delivery`, `app.salon_catalogue`). By default, Supabase PostgREST exposes the `public` schema.

To ensure authenticated client RPC calls execute without permission errors:
1. Open the **Supabase Dashboard** -> **Project Settings** -> **API**.
2. Under **PostgREST Configuration**, locate **Exposed schemas** (or **Extra search path** in SQL editor).
3. Ensure `app` is added to exposed schemas:
   ```text
   public, storage, app
   ```
4. Or run via Supabase SQL Editor if configuring role search path:
   ```sql
   ALTER ROLE authenticated SET search_path = public, app, storage;
   ALTER ROLE anon SET search_path = public, app, storage;
   ```

### Google OAuth Configuration (Client ID & Secret)
- **Google Cloud OAuth Client ID**:
  ```text
  1086170951681-kglfrouqo38t3tlf9upc5lrr89gl7hah.apps.googleusercontent.com
  ```
- **Configuration in Supabase Auth**:
  1. Open **Supabase Dashboard** -> **Authentication** -> **Providers** -> **Google**.
  2. Enable Google provider.
  3. Enter the Client ID above.
  4. Paste the matching Google Cloud Client Secret into the secret field (never check secrets into client code).
  5. Add your authorized redirect URI in Google Cloud Console:
     `https://<your-project-ref>.supabase.co/auth/v1/callback`

---

## 3. Database Schema Inventory & Core Entities

| Domain Area | Tables & Entities | Primary RPC Functions (`app.*`) |
| :--- | :--- | :--- |
| **User & Device Security** | `user_profile`, `device_registration`, `device_audit`, `invitation` | `register_device`, `approve_device`, `revoke_device`, `office_invite` |
| **Salon Registry & Accounts** | `salon`, `area`, `territory`, `salon_contact`, `salon_credit`, `salon_membership`, `salon_note` | `create_salon`, `office_decide_salon`, `salon_me`, `salon_my_account`, `salon_apply` |
| **Catalog & Products** | `product`, `product_group`, `sku`, `sku_price`, `salon_sku_price` | `office_upsert_product`, `office_upsert_sku`, `office_set_salon_price`, `salon_catalogue` |
| **Stock & Warehouses** | `stock_location`, `stock_movement`, `stock_issue`, `stock_count`, `stock_adjustment` | `office_issue_stock`, `rep_confirm_stock_issue`, `owner_adjust_stock`, `record_count`, `my_bag` |
| **Field Rep Workflows** | `rep_day`, `visit`, `route`, `route_stop`, `lost_demand` | `rep_check_in`, `rep_check_out`, `log_visit`, `record_demand`, `rep_reorder_route` |
| **Orders & Intake** | `order_intake_card`, `order_intake_card_line`, `sales_order`, `sales_order_line` | `rep_create_card`, `salon_submit_request`, `office_create_order`, `office_dismiss_card` |
| **Delivery & Signatures** | `delivery_submission`, `delivery_submission_line`, `delivery`, `delivery_signature` | `rep_submit_delivery`, `rep_attach_signature`, `office_approve_delivery`, `office_reject_delivery` |
| **Billing & Payments** | `invoice`, `invoice_installment`, `payment`, `receipt`, `payment_allocation`, `payment_reversal` | `office_record_payment`, `office_record_cash`, `office_reverse_payment`, `salon_my_invoices` |
| **Commissions** | `commission_tier`, `rep_commission_rate`, `salon_rep_rate`, `commission_payment` | `my_commission`, `office_commission_report`, `office_record_commission_payment` |
| **Investor Ledger** | `investor`, `investment`, `investor_profit_decision`, `investor_payout` | `office_create_investor`, `office_add_investment`, `office_decide_profit`, `office_record_payout` |
| **Restock Advisory** | `salon_restock_recommendation`, `forecast_scheduler_run` | `refresh_restock_forecasts` |

---

## 4. Key Architectural Safeguards

1. **Advisory Restock Alerts Only**:
   - `app.refresh_restock_forecasts()` and `SalonRestockAlerts` are advisory planning tools.
   - They strictly analyze delivered orders (`delivery.status = 'delivered'`) and never auto-create sales orders, invoices, or receivables.
   - Conversion to an official order requires explicit action by an Office Manager or Owner (`createOfficialOrderFromForecast` calling `app.office_create_order`).

2. **Manual Investor Governance**:
   - Investor capital contributions, profit decisions, and payouts are discretionary manual entries.
   - Automatic percentage returns, automatic ROI formulas, and automated profit splitting are strictly prohibited.

3. **Separate Salon Partner Portal**:
   - Public showcase (`khsalon.com`) provides product browsing and showroom information.
   - Salon Partners authenticate separately via Email OTP and active `salon_membership`, accessing contracted wholesale prices, submit order requests, and view invoices.

4. **Field Rep Security & Blind Counts**:
   - Reps check in and check out each day shift with GPS evidence.
   - Stock issues between warehouse and rep bags require blind physical counts by the recipient before reconciliation.
   - In-app payment collection by reps is disabled; all settlements are recorded and verified by Office Management.

---

## 5. Adding Products & Stock (Mocheqi & Lumex)

To add new SKUs (e.g. Mocheqi Hair Masks, Colors, or Shampoos) and adjust warehouse inventory:

1. **Via Office Operations Workbench**:
   - Log in as **Manager** or **Owner**.
   - Navigate to **Warehouse & Stock Issues** (or open **Product Catalog Drawer**).
   - Click **+ Add SKU**: enter SKU code, product name, brand (e.g., `Mocheqi Musk`), unit (`ml`/`g`/`pack`), price (PKR), and category.
   - The SKU is saved through `app.office_upsert_sku` with audit-logged price tier.

2. **Initializing Warehouse Stock**:
   - In **Warehouse & Stock Issues**, an Owner can use **Owner Adjust Stock** (`app.owner_adjust_stock`), selecting the Central Warehouse, the SKU, and entering the quantity delta with an audit reason (e.g., `Initial shipment container arrival`).
   - Managers can then issue stock to Field Rep bags using **Issue Stock to Bag** (`app.office_issue_stock`), which the rep confirms via Blind Count on their phone.

---

## 6. Point-in-Time Recovery & Migration Reconciliation

### Safeguards Against Data Loss
- **NEVER** run `DROP SCHEMA public CASCADE` or destructive truncate scripts against the connected database.
- Historical financial records (`invoice`, `payment`, `receipt`, `investment`, `investor_payout`) have append-only audit constraints.
- Erroneous financial entries must be corrected via authorized reversal RPCs (`app.office_reverse_payment`, `app.office_reverse_investor_entry`), which write compensating entries with full audit trails.

### Restoring from Backup
If an operational rollback is required:
1. Use Supabase PITR (Point-in-Time Recovery) to restore to a clean timestamp before the incident.
2. Review migration history against `supabase/2026*.sql`.
3. Verify table counts and function signatures before opening frontend access.
