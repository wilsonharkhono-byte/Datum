-- DATUM Slice 1.0 — readiness inputs (checkpoints, blockers, decisions, materials, milestones)
-- These tables feed area_gate_status's computed readiness on read.

------------------------------------------------------------------------
-- decision_priority enum (referenced by decisions below)
-- Declare first so decisions.priority can use it directly.
------------------------------------------------------------------------
create type public.decision_priority as enum ('P1','P2','P3');

------------------------------------------------------------------------
-- Area × Gate × Checkpoint (instances of gate_checkpoint_templates per cell)
------------------------------------------------------------------------
create type public.checkpoint_status as enum
  ('pending','passed','failed','not_applicable');

create table public.area_gate_checkpoints (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  area_id                uuid not null references public.areas(id) on delete cascade,
  gate_code              public.gate_code not null references public.gates(code),
  template_id            uuid not null references public.gate_checkpoint_templates(id),
  status                 public.checkpoint_status not null default 'pending',
  notes                  text,
  passed_by_staff_id     uuid references public.staff(id),
  passed_at              timestamptz,
  evidence_attachment_id uuid references public.attachments(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (project_id, area_id, gate_code, template_id),
  foreign key (project_id, area_id, gate_code)
    references public.area_gate_status(project_id, area_id, gate_code) on delete cascade
);
create trigger trg_area_gate_checkpoints_updated_at
  before update on public.area_gate_checkpoints
  for each row execute function public.set_updated_at();
create index area_gate_checkpoints_cell_idx
  on public.area_gate_checkpoints(project_id, area_id, gate_code);
create index area_gate_checkpoints_status_idx
  on public.area_gate_checkpoints(status) where status <> 'not_applicable';

------------------------------------------------------------------------
-- Area × Gate × Blocker (typed blockers per cell)
------------------------------------------------------------------------
create type public.blocker_type as enum
  ('decision_pending','material_not_arrived','prior_gate_not_passed',
   'area_occupied','approval_pending','quality_failed','shop_drawing_pending','other');

create type public.blocker_status as enum
  ('open','resolved','cancelled');

create table public.area_gate_blockers (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  area_id              uuid not null references public.areas(id) on delete cascade,
  gate_code            public.gate_code not null references public.gates(code),
  blocker_type         public.blocker_type not null,
  description          text,
  status               public.blocker_status not null default 'open',
  related_record_type  text,
  related_record_id    uuid,
  opened_by_staff_id   uuid references public.staff(id),
  owner_staff_id       uuid references public.staff(id),
  opened_at            timestamptz not null default now(),
  resolved_at          timestamptz,
  resolved_by_staff_id uuid references public.staff(id),
  resolution_notes     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (project_id, area_id, gate_code)
    references public.area_gate_status(project_id, area_id, gate_code) on delete cascade
);
create trigger trg_area_gate_blockers_updated_at
  before update on public.area_gate_blockers
  for each row execute function public.set_updated_at();
create index area_gate_blockers_cell_idx
  on public.area_gate_blockers(project_id, area_id, gate_code);
create index area_gate_blockers_open_idx
  on public.area_gate_blockers(project_id, status) where status = 'open';
create index area_gate_blockers_owner_idx
  on public.area_gate_blockers(owner_staff_id) where owner_staff_id is not null and status = 'open';

------------------------------------------------------------------------
-- Decisions (client/design decisions with P1/P2/P3 priority)
------------------------------------------------------------------------
create type public.decision_category as enum
  ('material','vendor','approval','change_order','scope','schedule','design','other');

create type public.decision_status as enum
  ('pending','approved','rejected','superseded');

create table public.decisions (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  area_id              uuid references public.areas(id) on delete cascade,
  gate_code            public.gate_code,
  category             public.decision_category not null,
  item_label           text not null,
  proposed_options     jsonb not null default '[]'::jsonb,
  chosen_option        jsonb,
  priority             public.decision_priority,
  status               public.decision_status not null default 'pending',
  decision_deadline    date,
  proposed_by_staff_id uuid references public.staff(id),
  approved_by_staff_id uuid references public.staff(id),
  confirmed_at         timestamptz,
  source_topic_note_id uuid references public.topic_notes(id) on delete set null,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_decisions_updated_at
  before update on public.decisions
  for each row execute function public.set_updated_at();
create index decisions_project_status_idx on public.decisions(project_id, status);
create index decisions_cell_idx on public.decisions(project_id, area_id, gate_code) where area_id is not null;
create index decisions_deadline_idx on public.decisions(decision_deadline) where status = 'pending';

------------------------------------------------------------------------
-- Material items (selections that become physical things with lead times)
------------------------------------------------------------------------
create type public.material_status as enum
  ('decided','shop_drawing_pending','ordered','in_fabrication',
   'arrived_on_site','installed','rejected');

create table public.material_items (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  area_id          uuid references public.areas(id) on delete set null,
  gate_code        public.gate_code,
  category         text not null,
  spec             text,
  status           public.material_status not null default 'decided',
  lead_time_weeks  numeric(4,1),
  order_by_date    date,
  expected_arrival date,
  actual_arrival   date,
  decision_id      uuid references public.decisions(id) on delete set null,
  vendor_id        uuid,     -- FK added in cost-layer migration (Task 3)
  quantity         numeric(10,2),
  unit             text,
  unit_price       numeric(14,2),
  currency         text default 'IDR',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_material_items_updated_at
  before update on public.material_items
  for each row execute function public.set_updated_at();
create index material_items_project_idx on public.material_items(project_id, status);
create index material_items_cell_idx on public.material_items(project_id, area_id, gate_code)
  where area_id is not null;
create index material_items_order_by_idx on public.material_items(order_by_date)
  where status in ('decided','shop_drawing_pending');

------------------------------------------------------------------------
-- Material milestones (sub-states on the order-to-install path)
------------------------------------------------------------------------
create type public.material_milestone_type as enum
  ('po_sent','deposit_paid','shop_drawing_approved','production_start','dispatch','arrived','installed','rejected');

create table public.material_milestones (
  id                   uuid primary key default gen_random_uuid(),
  material_item_id     uuid not null references public.material_items(id) on delete cascade,
  milestone_type       public.material_milestone_type not null,
  occurred_at          timestamptz not null default now(),
  recorded_by_staff_id uuid references public.staff(id),
  notes                text,
  attachment_id        uuid references public.attachments(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (material_item_id, milestone_type)
);
create index material_milestones_item_idx on public.material_milestones(material_item_id, occurred_at desc);
