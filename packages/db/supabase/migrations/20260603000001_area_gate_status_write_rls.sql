-- 20260603000001_area_gate_status_write_rls.sql
-- Fix: "Hitung Ulang Readiness" failed with
--   "new row violates row-level security policy for table area_gate_status"
-- even for principals.
--
-- area_gate_status had a SELECT policy (read = anyone who can read the
-- project) but no INSERT/UPDATE policies, so the recompute upsert was
-- blocked for every role — principals included.
--
-- area_gate_status is a derived/snapshot table: it is recomputed from
-- card_events by the rule engine and contains no user-authored content.
-- Therefore the write permission matches the read permission — anyone who
-- can read the project can trigger a recompute that writes its cells.
-- DELETE is intentionally NOT permitted; rows for retired areas are kept
-- as historical state.

begin;

create policy area_gate_status_insert on public.area_gate_status
  for insert with check (
    public.current_can_read_project(project_id)
  );

create policy area_gate_status_update on public.area_gate_status
  for update using (
    public.current_can_read_project(project_id)
  ) with check (
    public.current_can_read_project(project_id)
  );

commit;
