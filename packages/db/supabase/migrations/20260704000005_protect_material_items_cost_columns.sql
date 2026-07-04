-- 20260704000005_protect_material_items_cost_columns.sql
-- SECURITY FIX (AUDIT_SECURITY.md Finding 5).
--
-- material_items_read (20260531100005_rls_new_tables.sql:105) gates only on
-- current_can_read_project — with NO current_cost_visible_for branch — even
-- though the schema comments (20260531100002:141, 20260531100003:2) promised
-- unit_price would be cost-gated. vendor_quotes / invoices / cost-flagged
-- card_events ARE gated; material_items was the hole. A non-cost-visible member
-- could read every unit price via:
--     GET /rest/v1/material_items?project_id=eq.<id>&select=unit_price
--
-- Postgres RLS cannot filter columns, and a COLUMN-level revoke is a no-op while
-- the role still holds TABLE-level SELECT (table privilege dominates). So we
-- drop the blanket table-level SELECT from the client roles and re-grant SELECT
-- on every column EXCEPT the cost-bearing ones (unit_price, currency). The
-- non-cost fields (category/spec/status/dates/quantity) remain readable by
-- project members — which is what the readiness inputs need. Row visibility is
-- still governed by the existing material_items_read RLS policy on top of this.
--
--   * anon: SELECT fully revoked (RLS already yields it zero rows; no reason to
--     expose material_items to unauthenticated callers at all).
--   * service_role / postgres: untouched (server-side producers unaffected).
--
-- MAINTENANCE NOTE: because SELECT is now column-scoped for `authenticated`, any
-- FUTURE non-cost column added to material_items must also be GRANTed here, or
-- it will be invisible to the app. New cost columns should simply be omitted.
-- When a cost-visible read path is built, expose unit_price/currency through a
-- current_cost_visible_for()-gated view (or a cost-gated child table, mirroring
-- vendor_quotes) rather than re-granting the base columns.

begin;

revoke select on public.material_items from authenticated;
revoke select on public.material_items from anon;

grant select (
  id, project_id, area_id, gate_code, category, spec, status,
  lead_time_weeks, order_by_date, expected_arrival, actual_arrival,
  decision_id, vendor_id, quantity, unit, created_at, updated_at
) on public.material_items to authenticated;

commit;
