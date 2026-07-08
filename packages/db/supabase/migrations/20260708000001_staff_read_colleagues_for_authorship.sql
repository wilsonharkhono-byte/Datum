-- 20260708000001_staff_read_colleagues_for_authorship.sql
-- Task A (comment & event authors) — RLS gap found while wiring the
-- staff join onto card_comments/card_events.
--
-- staff_read_self_or_cross (20260531000002_rls_policies.sql:114) only lets a
-- caller read their own staff row, or ANY staff row if they hold a
-- cross-project-read role (principal/admin/estimator). A regular assigned
-- staff member (e.g. supervisor/worker) reading a card's comments or events
-- would get `author`/`logger: null` for every OTHER person's comment/event,
-- because the join target row is invisible to them under RLS — even though
-- they can plainly see the comment/event row itself, which already names the
-- author's staff_id in a column.
--
-- Fix: an additional SELECT policy scoped to SHARED-PROJECT colleagues — a
-- caller may read the staff row of anyone who shares (or has EVER shared) a
-- project_staff assignment with them. Deliberately no active_from/active_until
-- filtering: past co-membership keeps an ex-colleague's name renderable on
-- their old comments/events. The helper is SECURITY DEFINER with a locked
-- search_path, matching current_is_assigned / current_has_cross_project_read
-- in 20260531000002 — it bypasses RLS internally, so there is no
-- policy-recursion concern reading project_staff here.
--
-- Scope note: RLS is row-level only, so email/whatsapp_number/cost_visible on
-- those SAME-PROJECT rows remain readable at the Postgres privilege layer
-- (GRANT is table-wide) — narrowed from the firm-wide exposure an
-- all-active-staff policy would have created, but not name-only. App code
-- keeps the existing convention of selecting just `(id, full_name, role)` off
-- `staff` for these joins (see getCardComments/getCardMembers/
-- getTimelineEvents in packages/core/src/cards/queries.ts). If Wilson wants
-- true name-only exposure, the follow-up is column-level grants, precedent:
-- 20260704000005_protect_material_items_cost_columns.sql (with care: self
-- reads via getCurrentStaffRow's `select("*")` need full columns).

begin;

create or replace function public.current_shares_project_with(target_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.project_staff a
    join public.project_staff b on a.project_id = b.project_id
    where a.staff_id = auth.uid()
      and b.staff_id = target_staff_id
  );
$$;

revoke all on function public.current_shares_project_with(uuid) from public;
grant execute on function public.current_shares_project_with(uuid) to authenticated;

create policy staff_read_shared_project_colleagues on public.staff
  for select using (public.current_shares_project_with(id));

commit;
