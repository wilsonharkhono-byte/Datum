-- 20260613000001_area_target_date.sql
-- R4 (gate-readiness redesign): honest dates.
-- Adds an optional single TARGET DATE per area. When set, the app derives that
-- area's gate windows backward from this date (gate H ends here), instead of the
-- deterministic kickoff-derived template. NULL = fall back to kickoff-derived
-- dates from compute_project_schedule(). "Overdue" then means an area is at risk
-- vs its real target, not that a gate slipped a fictional template.
--
-- Additive + reversible: one nullable column, no data migration, no policy
-- change. areas UPDATE is already allowed for project members under RLS
-- (current_can_read_project — see 20260612000001_areas_staff_write_rls.sql),
-- so setAreaTargetDate writes under session RLS with no new policy.

begin;

alter table public.areas
  add column if not exists target_date date;

comment on column public.areas.target_date is
  'R4: optional PM-set handover target for THIS area. When set, the app derives '
  'the area''s 8 gate windows backward from it (gate H ends on target_date), '
  'preserving the gates'' relative active_weeks spacing. NULL falls back to the '
  'kickoff-derived deterministic schedule. Re-baselining an area = editing this '
  'one date.';

commit;
