-- Kiran DMS — External Supabase PostgreSQL Schema
-- Run this script once in your Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

-- 1. Rep & Manager Profiles (linked to Supabase Auth users)
create table if not exists public.rep_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null default 'rep' check (role in ('rep', 'manager')),
  territory text not null default 'Karachi Central',
  monthly_visit_target integer not null default 50,
  created_at timestamptz not null default now()
);

-- 2. Salons Roster
create table if not exists public.salons (
  id text primary key,
  name text not null,
  area text not null,
  address text not null,
  phone text not null,
  contact_person text not null,
  stage text not null default 'prospect' check (stage in ('prospect', 'trial', 'regular', 'vip')),
  approval_status text not null default 'approved' check (approval_status in ('approved', 'pending_review', 'rejected')),
  outstanding_balance integer not null default 0,
  credit_limit integer not null default 25000,
  last_visited_at timestamptz,
  notes_count integer not null default 0,
  open_cards_count integer not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);

-- 3. Product SKUs & Bag Inventory
create table if not exists public.skus (
  id text primary key,
  sku_code text not null unique,
  name text not null,
  category text not null check (category in ('Treatment', 'Styling', 'Color', 'Shampoo')),
  price integer not null,
  bag_qty integer not null default 0,
  unit text not null
);

-- 4. Daily Scheduled Route Stops
create table if not exists public.route_stops (
  id text primary key,
  salon_id text not null references public.salons(id) on delete cascade,
  salon_name text not null,
  area text not null,
  stop_number integer not null,
  due_reason text not null check (due_reason in ('weekly_cycle', 'low_stock', 'payment_due', 'order_delivery')),
  status text not null default 'pending' check (status in ('pending', 'visited', 'skipped')),
  balance integer not null default 0,
  route_date date not null default current_date
);

-- 5. Rep Daily Shifts & Bag Stock Counts
create table if not exists public.rep_shifts (
  id text primary key,
  rep_id text not null,
  rep_name text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  opening_bag_count integer not null default 0,
  closing_bag_count integer,
  expected_bag_count integer,
  variance_units integer not null default 0,
  count_record_id text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'flagged'))
);

-- 6. Field Visits & Notes (GPS Evidence)
create table if not exists public.visits (
  id text primary key,
  rep_id text not null,
  salon_id text not null references public.salons(id) on delete cascade,
  notes text not null default '',
  lat double precision,
  lng double precision,
  captured_at timestamptz not null default now()
);

-- 7. Cash Payments Collected
create table if not exists public.payments (
  id text primary key,
  rep_id text not null,
  salon_id text not null references public.salons(id) on delete cascade,
  amount integer not null check (amount > 0),
  method text not null default 'cash',
  captured_at timestamptz not null default now()
);

-- 8. Order Intake Cards (Field Rep -> Office Dispatch Approval)
create table if not exists public.order_cards (
  id text primary key,
  rep_id text not null,
  salon_id text not null references public.salons(id) on delete cascade,
  sku_id text not null references public.skus(id),
  sku_name text not null,
  qty integer not null check (qty > 0),
  total_amount integer not null,
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected')),
  captured_at timestamptz not null default now()
);

-- 9. Delivery Orders & Digital Signatures
create table if not exists public.delivery_orders (
  id text primary key,
  order_number text not null unique,
  salon_id text not null references public.salons(id) on delete cascade,
  salon_name text not null,
  items jsonb not null default '[]'::jsonb,
  total_amount integer not null,
  status text not null default 'pending_delivery' check (status in ('pending_delivery', 'delivered')),
  delivery_submission_id text,
  signature_data text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

-- 10. Lost Demand Ledger
create table if not exists public.lost_demand (
  id text primary key,
  rep_id text not null,
  sku_name text not null,
  qty integer not null check (qty > 0),
  captured_at timestamptz not null default now()
);

-- 11. Public Storefront Orders (khsalon.com)
create table if not exists public.public_shop_orders (
  id text primary key,
  order_number text not null unique,
  product_id text not null,
  product_name text not null,
  shade_code text not null,
  shade_variant text not null,
  qty integer not null check (qty > 0),
  unit_price_pkr integer not null,
  total_pkr integer not null,
  customer_name text not null,
  customer_phone text not null,
  delivery_address text not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dispatched')),
  created_at timestamptz not null default now()
);

-- Enable Row Level Security (Service Role bypasses RLS on Express backend; authenticated users get read access)
alter table public.rep_profiles enable row level security;
alter table public.salons enable row level security;
alter table public.skus enable row level security;
alter table public.route_stops enable row level security;
alter table public.rep_shifts enable row level security;
alter table public.visits enable row level security;
alter table public.payments enable row level security;
alter table public.order_cards enable row level security;
alter table public.delivery_orders enable row level security;
alter table public.lost_demand enable row level security;
alter table public.public_shop_orders enable row level security;

-- Seed initial Karachi pilot roster, SKUs, route, and delivery orders
insert into public.salons (id, name, area, address, phone, contact_person, stage, approval_status, outstanding_balance, credit_limit, last_visited_at, notes_count, open_cards_count)
values
  ('sal-clifton-01', 'Toni&Guy Clifton Branch', 'Clifton Block 4, Karachi', 'Plot 12-C, 7th Zamzama Commercial Lane', '0300-8234190', 'Rashid Ali (Master Stylist)', 'vip', 'approved', 45000, 150000, '2026-11-08T09:30:00Z', 4, 1),
  ('sal-dha-02', 'Peng''s Hair Studio DHA', 'DHA Phase 5, Karachi', '14-C Khayaban-e-Seher, Badar Commercial', '0321-9876543', 'Peng Sun / Madam Farida', 'regular', 'approved', 28500, 80000, '2026-11-07T11:15:00Z', 2, 0),
  ('sal-saddar-03', 'Karachi Looks Beauty Lounge', 'Saddar, Karachi', 'Shop 14, Rainbow Centre, Preedy Street', '0333-2145698', 'Babar Hussain', 'regular', 'approved', 14000, 50000, '2026-11-05T14:40:00Z', 1, 1),
  ('sal-gulshan-04', 'Saba''s Herbal & Hair Care', 'Gulshan-e-Iqbal Block 6', 'B-21, Main University Road near Disco Bakery', '0312-4455667', 'Saba Tariq', 'trial', 'approved', 0, 30000, '2026-11-09T10:00:00Z', 3, 0),
  ('sal-tariq-05', 'Glamour Zone Tariq Road', 'PECHS Block 2, Tariq Road', 'Mezzanine Floor, Dolmen Centre', '0301-7788990', 'Zeeshan Khan', 'prospect', 'pending_review', 0, 20000, null, 0, 0)
on conflict (id) do nothing;

insert into public.skus (id, sku_code, name, category, price, bag_qty, unit)
values
  ('sku-krt-500', 'KRN-KRT-500', 'Kiran Brazilian Keratin Complex 500ml', 'Treatment', 6800, 8, 'Bottle'),
  ('sku-arg-100', 'KRN-ARG-100', 'Moroccan Argan Elixir Serum 100ml', 'Styling', 2450, 12, 'Dropper'),
  ('sku-shm-1000', 'KRN-SHM-1L', 'Post-Chemical Clarifying Shampoo 1L', 'Shampoo', 3200, 6, 'Dispenser'),
  ('sku-clr-06', 'KRN-CLR-06', 'Salon Professional Hair Color Tube 60ml (Ash Brown 6.1)', 'Color', 850, 24, 'Tube'),
  ('sku-msk-500', 'KRN-MSK-500', 'Collagen & Biotin Intense Hair Mask 500g', 'Treatment', 3800, 5, 'Jar')
on conflict (id) do nothing;

insert into public.route_stops (id, salon_id, salon_name, area, stop_number, due_reason, status, balance)
values
  ('stop-01', 'sal-clifton-01', 'Toni&Guy Clifton Branch', 'Clifton Block 4', 1, 'order_delivery', 'pending', 45000),
  ('stop-02', 'sal-dha-02', 'Peng''s Hair Studio DHA', 'DHA Phase 5', 2, 'payment_due', 'pending', 28500),
  ('stop-03', 'sal-tariq-05', 'Glamour Zone Tariq Road', 'Tariq Road PECHS', 3, 'weekly_cycle', 'pending', 0)
on conflict (id) do nothing;

insert into public.delivery_orders (id, order_number, salon_id, salon_name, items, total_amount, status, delivered_at)
values
  ('ord-8801', 'ORD-KRN-2026-8801', 'sal-clifton-01', 'Toni&Guy Clifton Branch', '[{"sku_name":"Kiran Brazilian Keratin Complex 500ml","qty":2,"price":6800},{"sku_name":"Moroccan Argan Elixir Serum 100ml","qty":4,"price":2450}]'::jsonb, 23400, 'pending_delivery', null),
  ('ord-8802', 'ORD-KRN-2026-8802', 'sal-dha-02', 'Peng''s Hair Studio DHA', '[{"sku_name":"Post-Chemical Clarifying Shampoo 1L","qty":3,"price":3200}]'::jsonb, 9600, 'pending_delivery', null)
on conflict (id) do nothing;
