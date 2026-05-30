-- DATUM Slice 0 — core schema
-- All tables in public schema; RLS added in a separate migration.

------------------------------------------------------------------------
-- Helper: updated_at trigger
------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

------------------------------------------------------------------------
-- Staff (links to auth.users)
------------------------------------------------------------------------
create type public.staff_role as enum
  ('principal','designer','pic','site_supervisor','admin','estimator');

create table public.staff (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null,
  role            public.staff_role not null,
  cost_visible    boolean not null default false,
  whatsapp_number text unique,
  email           text unique,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_staff_updated_at
  before update on public.staff
  for each row execute function public.set_updated_at();
create index staff_role_idx on public.staff(role) where active;

------------------------------------------------------------------------
-- Projects
------------------------------------------------------------------------
create type public.project_status as enum
  ('design','construction','finishing','handover','closed');

create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  project_code       text not null unique,
  project_name       text not null,
  client_name        text,
  site_address       text,
  location           text,
  status             public.project_status not null default 'finishing',
  kickoff_date       date,
  target_handover    date,
  principal_id       uuid references public.staff(id),
  pic_id             uuid references public.staff(id),
  search_aliases     jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
create index projects_status_idx on public.projects(status);
create index projects_search_idx on public.projects using gin (search_aliases);

------------------------------------------------------------------------
-- Project-staff assignments (m:n)
------------------------------------------------------------------------
create table public.project_staff (
  project_id     uuid not null references public.projects(id) on delete cascade,
  staff_id       uuid not null references public.staff(id) on delete cascade,
  role_on_project text not null,
  cost_visible   boolean not null default false,
  active_from    date not null default current_date,
  active_until   date,
  created_at     timestamptz not null default now(),
  primary key (project_id, staff_id)
);
create index project_staff_staff_idx on public.project_staff(staff_id);

------------------------------------------------------------------------
-- Areas (rooms / zones)
------------------------------------------------------------------------
create type public.area_type as enum
  ('bathroom','kitchen','bedroom','living','dining','garden','circulation','utility','general');

create table public.areas (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  area_code   text not null,
  area_name   text not null,
  floor       text,
  area_type   public.area_type not null default 'general',
  area_sqm    numeric(8,2),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, area_code)
);
create trigger trg_areas_updated_at
  before update on public.areas
  for each row execute function public.set_updated_at();
create index areas_project_idx on public.areas(project_id);

------------------------------------------------------------------------
-- Gates (config: immutable 8 rows seeded in migration 003)
------------------------------------------------------------------------
create type public.gate_code as enum ('A','B','C','D','E','F','G','H');

create table public.gates (
  code         public.gate_code primary key,
  name         text not null,
  description  text,
  sort_order   integer not null,
  active_weeks int4range,
  created_at   timestamptz not null default now()
);

------------------------------------------------------------------------
-- Gate checkpoint templates (Lampiran A items)
------------------------------------------------------------------------
create table public.gate_checkpoint_templates (
  id            uuid primary key default gen_random_uuid(),
  gate_code     public.gate_code not null references public.gates(code),
  item_text     text not null,
  sort_order    integer not null default 0,
  required      boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (gate_code, sort_order)
);
create index gate_checkpoint_templates_gate_idx on public.gate_checkpoint_templates(gate_code);

------------------------------------------------------------------------
-- Project gates (per-project instance of each gate with target dates)
------------------------------------------------------------------------
create table public.project_gates (
  project_id        uuid not null references public.projects(id) on delete cascade,
  gate_code         public.gate_code not null references public.gates(code),
  target_start_date date,
  target_end_date   date,
  actual_start_date date,
  actual_end_date   date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (project_id, gate_code)
);
create trigger trg_project_gates_updated_at
  before update on public.project_gates
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------
-- Area × Gate cell — the matrix
-- Summary fields only; full readiness derived from checkpoints/blockers/materials/decisions on read
------------------------------------------------------------------------
create type public.readiness_state as enum
  ('not_started','in_progress','ready_for_handoff','blocked','passed','not_applicable');

create table public.area_gate_status (
  project_id            uuid not null references public.projects(id) on delete cascade,
  area_id               uuid not null references public.areas(id) on delete cascade,
  gate_code             public.gate_code not null references public.gates(code),
  status                public.readiness_state not null default 'not_started',
  readiness_score       numeric(3,2),
  blocking_reason       text,
  current_owner_id      uuid references public.staff(id),
  target_start_date     date,
  target_end_date       date,
  actual_start_date     date,
  actual_end_date       date,
  last_recomputed_at    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (project_id, area_id, gate_code)
);
create trigger trg_area_gate_status_updated_at
  before update on public.area_gate_status
  for each row execute function public.set_updated_at();
create index area_gate_status_project_idx on public.area_gate_status(project_id, gate_code);
create index area_gate_status_status_idx on public.area_gate_status(status) where status <> 'not_applicable';
create index area_gate_status_owner_idx on public.area_gate_status(current_owner_id) where current_owner_id is not null;

------------------------------------------------------------------------
-- Append-only project event timeline
------------------------------------------------------------------------
create table public.project_events (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  event_type      text not null,
  title           text not null,
  body            text,
  actor_staff_id  uuid references public.staff(id),
  source_type     text,
  source_id       uuid,
  related_area_id uuid references public.areas(id),
  related_gate    public.gate_code,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index project_events_project_created_idx on public.project_events(project_id, created_at desc);
create index project_events_cell_idx on public.project_events(project_id, related_area_id, related_gate) where related_area_id is not null;

------------------------------------------------------------------------
-- Append-only record correction history
------------------------------------------------------------------------
create type public.revision_type as enum
  ('created','corrected','superseded','approved','rejected');

create table public.record_revisions (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  entity_type        text not null,
  entity_id          uuid not null,
  revision_type      public.revision_type not null,
  previous_payload   jsonb,
  new_payload        jsonb,
  actor_staff_id     uuid references public.staff(id),
  reason             text,
  created_at         timestamptz not null default now()
);
create index record_revisions_entity_idx on public.record_revisions(entity_type, entity_id, created_at desc);
