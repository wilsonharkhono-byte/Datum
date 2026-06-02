-- 20260601000017_project_staff_write_rls.sql
-- Slice 1.8b-fix: allow principals/admins/estimators to manage project_staff
-- so the members UI works end-to-end.
--
-- Read policy was added in Slice 0; this migration adds INSERT + UPDATE.
-- Delete is intentionally NOT permitted — removal is via active_until
-- soft-delete (append-only audit principle).

begin;

create policy project_staff_insert on public.project_staff
  for insert with check (
    public.current_has_cross_project_read()
  );

create policy project_staff_update on public.project_staff
  for update using (
    public.current_has_cross_project_read()
  );

commit;
