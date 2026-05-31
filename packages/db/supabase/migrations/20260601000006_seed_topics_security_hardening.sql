-- 20260601000006_seed_topics_security_hardening.sql
-- Slice 1.1: Security hardening for seed_default_topics + seed_topics_on_project_insert
-- (follow-up to 20260601000005_seed_topics_function.sql).
--
-- Aligns with the Slice 1.0 SECURITY DEFINER pattern (see 20260531000002_rls_policies.sql):
--   1. Set search_path = public to prevent schema-hijacking.
--   2. REVOKE ALL from PUBLIC then GRANT EXECUTE to authenticated.
--   3. Document the BYPASSRLS chain via COMMENT ON FUNCTION.

begin;

-- 1. Re-create the trigger function with set search_path = public
create or replace function public.seed_topics_on_project_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_topics(new.id);
  return new;
end;
$$;

-- 2. Lock down EXECUTE permissions on both functions
revoke all on function public.seed_default_topics(uuid)         from public;
revoke all on function public.seed_topics_on_project_insert()   from public;

grant execute on function public.seed_default_topics(uuid)       to authenticated;
grant execute on function public.seed_topics_on_project_insert() to authenticated;

-- 3. Document the security context
comment on function public.seed_topics_on_project_insert() is
  'AFTER INSERT trigger on projects. SECURITY DEFINER so it bypasses RLS on topics during '
  'project creation (the inserting user may not yet be in project_staff). Must be owned by '
  'postgres (BYPASSRLS) — Supabase migrations run as postgres, so this holds in normal deploy '
  'paths. Do not recreate this function as a non-superuser role; the trigger would silently fail '
  'to insert topics and project creation would roll back.';

comment on function public.seed_default_topics(uuid) is
  'Seeds the standard 15-row drawing-code taxonomy into topics for a project. Idempotent '
  '(ON CONFLICT DO NOTHING on (project_id, code)). Called by the seed_topics_on_project_insert '
  'trigger and by manual backfill if ever needed. EXECUTE granted to authenticated.';

commit;
