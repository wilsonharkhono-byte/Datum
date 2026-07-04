-- 20260704000004_restrict_project_staff_writes.sql
-- SECURITY FIX (AUDIT_SECURITY.md Finding 4).
--
-- project_staff INSERT/UPDATE (20260601000017_project_staff_write_rls.sql) were
-- gated on current_has_cross_project_read(), which includes the `estimator`
-- role. An estimator could therefore assign anyone (incl. themselves) to any
-- project and set cost_visible=true on that assignment — roster + cost self-
-- grant that should be reserved to project managers.
--
-- The web/mobile "members" flow (lib/projects/member-mutations.ts →
-- core.addProjectMember/removeProjectMember) runs under the session client and
-- relies entirely on these RLS policies for authz, so tightening the policy is
-- the fix. current_can_manage_projects() = role in ('principal','admin').
--
-- BEHAVIOUR CHANGE: estimators can no longer add/remove/edit project members.
-- If that is ever required, grant it explicitly rather than via the broad
-- cross-project-read predicate.
--
-- DELETE remains unpolicied (soft-delete via active_until), unchanged.

begin;

drop policy if exists project_staff_insert on public.project_staff;
drop policy if exists project_staff_update on public.project_staff;

create policy project_staff_insert on public.project_staff
  for insert with check (
    public.current_can_manage_projects()
  );

create policy project_staff_update on public.project_staff
  for update using (
    public.current_can_manage_projects()
  ) with check (
    public.current_can_manage_projects()
  );

commit;
