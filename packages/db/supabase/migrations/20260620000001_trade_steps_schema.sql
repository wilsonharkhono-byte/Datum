-- Readiness Pilot Phase 1 — trade-step model schema (template + instance).
-- Mirrors gates/gate_checkpoint_templates (template) and area_gate_status (instance).

-- 0. Finish profile on areas (drives step applicability alongside area_type).
alter table public.areas
  add column if not exists finish_profile jsonb not null default '{}'::jsonb;

------------------------------------------------------------------------
-- Template layer (firm standard; seeded by migration, global config)
------------------------------------------------------------------------
create table public.trade_steps (
  code                  text primary key,
  gate_code             text not null references public.gates(code),
  name                  text not null,
  step_type             text not null check (step_type in ('decision','procurement','site_work','inspection')),
  trade_role            text,
  typical_duration_days numeric(6,2) not null default 1,
  lead_time_days        numeric(6,2) not null default 0,
  sort_order            integer not null default 0,
  applicability         jsonb not null default '{}'::jsonb,
  active                boolean not null default true
);

create table public.trade_step_deps (
  step_code        text not null references public.trade_steps(code) on delete cascade,
  predecessor_code text not null references public.trade_steps(code) on delete cascade,
  primary key (step_code, predecessor_code)
);

create table public.trade_step_checkpoints (
  id               uuid primary key default gen_random_uuid(),
  step_code        text not null references public.trade_steps(code) on delete cascade,
  item_text        text not null,
  default_severity text not null check (default_severity in ('kritis','mayor','minor')),
  required         boolean not null default true,
  sort_order       integer not null default 0
);

------------------------------------------------------------------------
-- Instance layer (one real bathroom)
------------------------------------------------------------------------
create table public.area_steps (
  id              uuid primary key default gen_random_uuid(),
  area_id         uuid not null references public.areas(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  step_code       text not null references public.trade_steps(code),
  status          text not null default 'not_started'
                    check (status in ('not_started','in_progress','blocked','stalled','done_with_defects','accepted','not_applicable')),
  planned_start   date,
  planned_end     date,
  actual_start    date,
  actual_end      date,
  assigned_trade  text,
  blocking_reason text,
  last_progress_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (area_id, step_code)
);
create index area_steps_area_idx on public.area_steps(area_id);
create index area_steps_project_idx on public.area_steps(project_id);
create trigger trg_area_steps_updated_at
  before update on public.area_steps
  for each row execute function public.set_updated_at();

create table public.area_step_checkpoints (
  id            uuid primary key default gen_random_uuid(),
  area_step_id  uuid not null references public.area_steps(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  item_text     text not null,
  severity      text not null check (severity in ('kritis','mayor','minor')),
  required      boolean not null default true,
  result        text not null default 'pending' check (result in ('pending','pass','fail')),
  checked_by    uuid references public.staff(id),
  checked_at    timestamptz,
  sort_order    integer not null default 0
);
create index area_step_checkpoints_step_idx on public.area_step_checkpoints(area_step_id);

create table public.punch_items (
  id                 uuid primary key default gen_random_uuid(),
  area_step_id       uuid not null references public.area_steps(id) on delete cascade,
  project_id         uuid not null references public.projects(id) on delete cascade,
  description        text not null,
  severity           text not null check (severity in ('kritis','mayor','minor')),
  caused_by_trade    text,
  fix_owner_trade    text,
  status             text not null default 'open' check (status in ('open','fixing','closed')),
  sano_work_item_ref text,
  created_at         timestamptz not null default now(),
  closed_at          timestamptz
);
create index punch_items_step_idx on public.punch_items(area_step_id);

------------------------------------------------------------------------
-- RLS — template tables readable by all authenticated; instance tables
-- gated by project membership (mirror area_gate_status policies).
------------------------------------------------------------------------
alter table public.trade_steps enable row level security;
alter table public.trade_step_deps enable row level security;
alter table public.trade_step_checkpoints enable row level security;
alter table public.area_steps enable row level security;
alter table public.area_step_checkpoints enable row level security;
alter table public.punch_items enable row level security;

create policy trade_steps_read on public.trade_steps
  for select to authenticated using (true);
create policy trade_step_deps_read on public.trade_step_deps
  for select to authenticated using (true);
create policy trade_step_checkpoints_read on public.trade_step_checkpoints
  for select to authenticated using (true);

create policy area_steps_read on public.area_steps
  for select to authenticated using (public.current_can_read_project(project_id));
create policy area_steps_write on public.area_steps
  for all to authenticated
  using (public.current_can_read_project(project_id))
  with check (public.current_can_read_project(project_id));

create policy area_step_checkpoints_rw on public.area_step_checkpoints
  for all to authenticated
  using (public.current_can_read_project(project_id))
  with check (public.current_can_read_project(project_id));

create policy punch_items_rw on public.punch_items
  for all to authenticated
  using (public.current_can_read_project(project_id))
  with check (public.current_can_read_project(project_id));
