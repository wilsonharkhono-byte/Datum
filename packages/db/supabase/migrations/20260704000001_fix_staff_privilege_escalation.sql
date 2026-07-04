-- 20260704000001_fix_staff_privilege_escalation.sql
-- SECURITY FIX (AUDIT_SECURITY.md Finding 1 — CRITICAL).
--
-- The `staff_update_self` policy (20260531000002_rls_policies.sql:116) lets a
-- staff member UPDATE their own row with only `id = auth.uid()` in the CHECK.
-- It never freezes `role` or `cost_visible` — the two columns that feed
-- current_has_cross_project_read(), current_can_manage_projects() and
-- current_cost_visible_for(). So any authenticated user could:
--     PATCH /rest/v1/staff?id=eq.<self>  { "role":"admin","cost_visible":true }
-- and instantly gain firm-wide read, project/roster/step management, and all
-- cost data — defeating essentially the entire RLS model.
--
-- Fix: a BEFORE UPDATE trigger that rejects any change to role/cost_visible
-- unless the caller is a project/roster manager (principal/admin). The RLS
-- policy itself is left intact (users can still self-edit non-privileged fields
-- like display name). Legitimate role changes for OTHER users already flow
-- through the service-role admin client in /api/staff/create, which has no JWT
-- (auth.uid() is null) and is explicitly trusted here.
--
-- Why a trigger and not a tighter WITH CHECK: a trigger is unambiguous, cannot
-- be disabled by an authenticated user, and avoids self-referential subqueries
-- against the same table inside an RLS policy. It matches the codebase's
-- SECURITY DEFINER + locked search_path convention.

begin;

create or replace function public.enforce_staff_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role / SECURITY DEFINER trigger contexts carry no JWT. They are
  -- server-side and already past application authz, so leave them unrestricted.
  if auth.uid() is null then
    return new;
  end if;

  -- An end-user (JWT present) may not change privilege-bearing columns on any
  -- staff row — including their own — unless they are a principal/admin.
  if (new.role         is distinct from old.role
      or new.cost_visible is distinct from old.cost_visible)
     and not public.current_can_manage_projects() then
    raise exception
      'Tidak diizinkan mengubah role atau cost_visible. Hubungi principal/admin.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_staff_privilege_columns() from public;

drop trigger if exists trg_staff_enforce_privilege_columns on public.staff;
create trigger trg_staff_enforce_privilege_columns
  before update on public.staff
  for each row execute function public.enforce_staff_privilege_columns();

commit;
