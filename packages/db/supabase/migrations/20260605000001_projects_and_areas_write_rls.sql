-- 20260605000001_projects_and_areas_write_rls.sql
-- Fix two RLS gaps surfaced in the slice 1.10 review:
--
-- 1. public.projects had only a SELECT policy. updateProject() ran under the
--    user session and silently affected 0 rows (no error), so the new
--    kickoff_date editor in ProjectInfoForm and the existing ProjectEditDialog
--    were no-ops. Add INSERT/UPDATE/DELETE policies gated to principal/admin.
--
-- 2. The areas write policies introduced in 20260604000001 used
--    current_can_read_project — letting any project member (designer, PIC,
--    site_supervisor) or any estimator (cross-project read) wipe the area
--    roster. Narrow to principal/admin only by tightening the predicates.

begin;

------------------------------------------------------------------------
-- Helper: current caller can manage project rosters / write project state
------------------------------------------------------------------------
create or replace function public.current_can_manage_projects()
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
      and s.role in ('principal', 'admin')
  );
$$;

revoke all on function public.current_can_manage_projects() from public;
grant execute on function public.current_can_manage_projects() to authenticated;

------------------------------------------------------------------------
-- projects: principal/admin can insert/update/delete; everyone else
-- keeps the existing SELECT visibility.
------------------------------------------------------------------------
create policy projects_insert on public.projects
  for insert with check (public.current_can_manage_projects());

create policy projects_update on public.projects
  for update using (public.current_can_manage_projects())
  with check  (public.current_can_manage_projects());

create policy projects_delete on public.projects
  for delete using (public.current_can_manage_projects());

------------------------------------------------------------------------
-- areas: narrow the existing write policies from current_can_read_project
-- to current_can_manage_projects. SELECT remains unchanged (any reader).
------------------------------------------------------------------------
drop policy if exists areas_insert on public.areas;
drop policy if exists areas_update on public.areas;
drop policy if exists areas_delete on public.areas;

create policy areas_insert on public.areas
  for insert with check (
    public.current_can_manage_projects()
    and public.current_can_read_project(project_id)
  );

create policy areas_update on public.areas
  for update using (
    public.current_can_manage_projects()
    and public.current_can_read_project(project_id)
  ) with check (
    public.current_can_manage_projects()
    and public.current_can_read_project(project_id)
  );

create policy areas_delete on public.areas
  for delete using (
    public.current_can_manage_projects()
    and public.current_can_read_project(project_id)
  );

-- card_areas_delete keeps the read-project predicate (any project member can
-- unlink a card from an area as part of normal card editing). That matches
-- the pre-existing card_areas INSERT policy.

commit;
