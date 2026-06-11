-- 20260604000001_areas_and_card_areas_write_rls.sql
-- Slice 1.10: enable the in-app areas admin + card→area linking flows.
--
-- areas had only a SELECT policy (same gap that bit area_gate_status). To let
-- principals/admins manage area rosters per project from /settings, we need
-- INSERT/UPDATE/DELETE. We mirror the SELECT predicate: anyone who can read
-- the project can also write its areas — schedules are derived data and
-- principals are the only role that uses the UI today; tighter gating can
-- come later if other roles get the UI.
--
-- card_areas had SELECT + INSERT but no DELETE, so "unlink card from area"
-- was impossible without service-role. Add DELETE under the same predicate.

begin;

create policy areas_insert on public.areas
  for insert with check (
    public.current_can_read_project(project_id)
  );

create policy areas_update on public.areas
  for update using (
    public.current_can_read_project(project_id)
  ) with check (
    public.current_can_read_project(project_id)
  );

create policy areas_delete on public.areas
  for delete using (
    public.current_can_read_project(project_id)
  );

create policy card_areas_delete on public.card_areas
  for delete using (
    exists (
      select 1 from public.cards c
       where c.id = card_areas.card_id
         and public.current_can_read_project(c.project_id)
    )
  );

commit;
