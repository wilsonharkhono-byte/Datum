-- DATUM Slice 1.0 — cost layer (vendors, quotes, invoices)
-- These tables (and unit_price column on material_items) are gated by current_cost_visible_for() in Task 5 RLS.

------------------------------------------------------------------------
-- Vendors (catalog; readable by all authenticated, write-restricted)
------------------------------------------------------------------------
create type public.vendor_category as enum
  ('marmer','keramik','sanitair','kusen','cat','duco','ironwork','furniture',
   'wallpaper','lampu','mep','landscape','other');

create table public.vendors (
  id            uuid primary key default gen_random_uuid(),
  vendor_name   text not null unique,
  category      public.vendor_category not null default 'other',
  contact_name  text,
  contact_phone text,
  contact_email text,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_vendors_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();
create index vendors_active_idx on public.vendors(active, category) where active;

------------------------------------------------------------------------
-- Now that vendors exists, add the FK that material_items.vendor_id was deferring
------------------------------------------------------------------------
alter table public.material_items
  add constraint material_items_vendor_fk
  foreign key (vendor_id) references public.vendors(id) on delete set null;

------------------------------------------------------------------------
-- Vendor quotes (COST-SENSITIVE — gated by current_cost_visible_for in Task 5)
------------------------------------------------------------------------
create type public.quote_status as enum
  ('received','selected','superseded','rejected');

create table public.vendor_quotes (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  material_item_id       uuid references public.material_items(id) on delete cascade,
  vendor_id              uuid not null references public.vendors(id),
  amount                 numeric(14,2) not null,
  currency               text not null default 'IDR',
  quote_date             date not null default current_date,
  quoted_lead_time_weeks numeric(4,1),
  status                 public.quote_status not null default 'received',
  attachment_id          uuid references public.attachments(id) on delete set null,
  notes                  text,
  received_by_staff_id   uuid references public.staff(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_vendor_quotes_updated_at
  before update on public.vendor_quotes
  for each row execute function public.set_updated_at();
create index vendor_quotes_project_idx on public.vendor_quotes(project_id);
create index vendor_quotes_item_idx on public.vendor_quotes(material_item_id);
create index vendor_quotes_vendor_idx on public.vendor_quotes(vendor_id);

------------------------------------------------------------------------
-- Invoices (COST-SENSITIVE)
------------------------------------------------------------------------
create type public.invoice_status as enum
  ('received','approved','paid','disputed','rejected');

create table public.invoices (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  material_item_id     uuid references public.material_items(id) on delete set null,
  vendor_id            uuid not null references public.vendors(id),
  amount               numeric(14,2) not null,
  currency             text not null default 'IDR',
  invoice_number       text,
  invoice_date         date not null default current_date,
  due_date             date,
  status               public.invoice_status not null default 'received',
  paid_at              timestamptz,
  attachment_id        uuid references public.attachments(id) on delete set null,
  notes                text,
  recorded_by_staff_id uuid references public.staff(id),
  approved_by_staff_id uuid references public.staff(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();
create index invoices_project_idx on public.invoices(project_id);
create index invoices_status_idx on public.invoices(status) where status in ('received','approved');
