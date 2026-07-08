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
-- Fix: a narrow additional SELECT policy that lets any authenticated *active*
-- staff member read other staff rows. This only widens ROW visibility (RLS
-- can't restrict columns); app code continues the existing convention of
-- selecting just `(id, full_name, role)` off `staff` for these joins (see
-- getCardComments/getCardMembers/getTimelineEvents in
-- packages/core/src/cards/queries.ts) so day-to-day reads stay narrow in
-- practice. Sensitive columns (email, whatsapp_number, cost_visible) remain
-- selectable at the Postgres privilege layer for any matching row (GRANT is
-- table-wide, same limitation the material_items fix
-- (20260704000005) called out) — that is a pre-existing gap this migration
-- does not attempt to close, since column-level lockdown here would also need
-- to keep self-reads of email/whatsapp_number/cost_visible working
-- (getCurrentStaffRow does `select("*")` on the caller's own row) and is a
-- separate, larger security change. Flagged for a follow-up if Wilson wants
-- comparable column-level hardening on `staff`.

begin;

create policy staff_read_active_colleagues on public.staff
  for select using (
    public.current_staff_id() is not null and active
  );

commit;
