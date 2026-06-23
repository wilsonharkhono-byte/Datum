-- Append-only log of step status changes / progress updates. Steps belong to an
-- area (not a card), so this is a dedicated log rather than card_events. The pure
-- projectStepStatus reads a generic {occurred_at, created_at, payload} shape over it.
create table public.area_step_events (
  id                 uuid primary key default gen_random_uuid(),
  area_step_id       uuid not null references public.area_steps(id) on delete cascade,
  project_id         uuid not null references public.projects(id) on delete cascade,
  status             text not null check (status in ('not_started','in_progress','blocked','done')),
  note               text,
  percent_complete   numeric(5,2),
  occurred_at        timestamptz not null default now(),
  logged_by_staff_id uuid references public.staff(id),
  created_at         timestamptz not null default now()
);
create index area_step_events_step_idx on public.area_step_events(area_step_id);
create index area_step_events_project_idx on public.area_step_events(project_id);

alter table public.area_step_events enable row level security;
create policy area_step_events_read on public.area_step_events
  for select to authenticated using (public.current_can_read_project(project_id));
create policy area_step_events_insert on public.area_step_events
  for insert to authenticated with check (public.current_can_read_project(project_id));
