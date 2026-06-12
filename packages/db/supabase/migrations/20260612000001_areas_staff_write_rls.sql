-- 20260612000001_areas_staff_write_rls.sql
-- Open area CREATE + EDIT/REORDER to any project member (all staff roles).
-- Previously all area writes required current_can_manage_projects()
-- (principal/admin) — see 20260605000001_projects_and_areas_write_rls.sql.
-- DELETE stays principal/admin-only because removing an area can break gate
-- history and card_areas links.

begin;

-- INSERT: any member who can read the project may add an area.
drop policy if exists areas_insert on public.areas;
create policy areas_insert on public.areas
  for insert with check (public.current_can_read_project(project_id));

-- UPDATE: any project member may edit / reorder areas. reorder_project_areas()
-- runs security invoker, so loosening this also enables staff reordering.
drop policy if exists areas_update on public.areas;
create policy areas_update on public.areas
  for update using (public.current_can_read_project(project_id))
  with check (public.current_can_read_project(project_id));

-- areas_delete intentionally left unchanged: still gated by
-- current_can_manage_projects() (principal/admin only).

commit;
