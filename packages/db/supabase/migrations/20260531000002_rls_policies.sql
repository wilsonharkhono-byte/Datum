-- DATUM Slice 0 — RLS policies and helpers

------------------------------------------------------------------------
-- Helpers — all marked SECURITY DEFINER + search_path locked to public.
-- DEFINER is required because some helpers read project_staff, which
-- itself has an RLS policy that calls these helpers. Without DEFINER
-- we'd get infinite policy recursion. SECURITY DEFINER + STABLE +
-- locked search_path is the canonical Supabase RLS-helper pattern.
------------------------------------------------------------------------

create or replace function public.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.staff s
  where s.id = auth.uid() and s.active
  limit 1;
$$;

create or replace function public.current_has_cross_project_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.staff s
    where s.id = auth.uid()
      and s.active
      and s.role in ('principal','admin','estimator')
  );
$$;

create or replace function public.current_is_assigned(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.project_staff ps
    where ps.project_id = p_project_id
      and ps.staff_id = auth.uid()
      and (ps.active_until is null or ps.active_until >= current_date)
  );
$$;

create or replace function public.current_can_read_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_has_cross_project_read() or public.current_is_assigned(p_project_id);
$$;

create or replace function public.current_cost_visible_for(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.cost_visible from public.staff s where s.id = auth.uid() and s.active),
    false
  )
  or coalesce(
    (select ps.cost_visible from public.project_staff ps
      where ps.project_id = p_project_id and ps.staff_id = auth.uid()),
    false
  );
$$;

-- Lock down EXECUTE so anon/public can't call these helpers ad-hoc.
revoke all on function public.current_staff_id() from public;
revoke all on function public.current_has_cross_project_read() from public;
revoke all on function public.current_is_assigned(uuid) from public;
revoke all on function public.current_can_read_project(uuid) from public;
revoke all on function public.current_cost_visible_for(uuid) from public;
grant execute on function public.current_staff_id() to authenticated;
grant execute on function public.current_has_cross_project_read() to authenticated;
grant execute on function public.current_is_assigned(uuid) to authenticated;
grant execute on function public.current_can_read_project(uuid) to authenticated;
grant execute on function public.current_cost_visible_for(uuid) to authenticated;

------------------------------------------------------------------------
-- Enable RLS on all tables
------------------------------------------------------------------------
alter table public.staff                       enable row level security;
alter table public.projects                    enable row level security;
alter table public.project_staff               enable row level security;
alter table public.areas                       enable row level security;
alter table public.gates                       enable row level security;
alter table public.gate_checkpoint_templates   enable row level security;
alter table public.project_gates               enable row level security;
alter table public.area_gate_status            enable row level security;
alter table public.project_events              enable row level security;
alter table public.record_revisions            enable row level security;

------------------------------------------------------------------------
-- staff
------------------------------------------------------------------------
create policy staff_read_self_or_cross on public.staff
  for select using (
    id = auth.uid() or public.current_has_cross_project_read()
  );

create policy staff_update_self on public.staff
  for update using (id = auth.uid())
  with check (id = auth.uid());

------------------------------------------------------------------------
-- gates + gate_checkpoint_templates (config; readable by all authenticated)
------------------------------------------------------------------------
create policy gates_read_authenticated on public.gates
  for select using (auth.uid() is not null);

create policy gate_checkpoint_templates_read_authenticated on public.gate_checkpoint_templates
  for select using (auth.uid() is not null);

------------------------------------------------------------------------
-- projects
------------------------------------------------------------------------
create policy projects_read_visible on public.projects
  for select using (public.current_can_read_project(id));

------------------------------------------------------------------------
-- project_staff
------------------------------------------------------------------------
create policy project_staff_read_visible on public.project_staff
  for select using (public.current_can_read_project(project_id));

------------------------------------------------------------------------
-- areas
------------------------------------------------------------------------
create policy areas_read_visible on public.areas
  for select using (public.current_can_read_project(project_id));

------------------------------------------------------------------------
-- project_gates
------------------------------------------------------------------------
create policy project_gates_read_visible on public.project_gates
  for select using (public.current_can_read_project(project_id));

------------------------------------------------------------------------
-- area_gate_status
------------------------------------------------------------------------
create policy area_gate_status_read_visible on public.area_gate_status
  for select using (public.current_can_read_project(project_id));

------------------------------------------------------------------------
-- project_events
------------------------------------------------------------------------
create policy project_events_read_visible on public.project_events
  for select using (public.current_can_read_project(project_id));

------------------------------------------------------------------------
-- record_revisions
------------------------------------------------------------------------
create policy record_revisions_read_visible on public.record_revisions
  for select using (public.current_can_read_project(project_id));

------------------------------------------------------------------------
-- DEFAULT DENY for INSERT/UPDATE/DELETE:
-- Slice 0 writes via service-role only (seed script).
-- Slice 1+ adds explicit write policies as features land.
------------------------------------------------------------------------
