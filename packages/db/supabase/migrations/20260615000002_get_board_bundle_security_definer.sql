-- get_board_bundle: switch from SECURITY INVOKER to SECURITY DEFINER with an
-- explicit access gate.
--
-- Why: the INVOKER version failed for authenticated users. Evaluating the
-- cards-layer RLS policies for every sub-select inside ONE bundled query raised
-- an error for the authenticated role (the old multi-query path tolerated a
-- failing sub-query via `?? []`, so the board still rendered). Running the read
-- as DEFINER avoids per-table RLS evaluation inside the function.
--
-- Access is still enforced:
--   * the whole result is gated on current_can_read_project(project_id), the
--     same rule that governs whether the caller can see the project at all
--     (cross-project read for principal/admin/estimator, OR project assignment);
--   * cost-restricted loop events are filtered with current_cost_visible_for(),
--     mirroring the card_events_select policy, so non-cost-visible staff never
--     receive cost_visible events.
-- Net effect vs the old per-table RLS: senior cross-project roles can now read a
-- board even on a project they aren't explicitly assigned to (consistent with
-- their existing project-level visibility); cost protection is unchanged.
create or replace function public.get_board_bundle(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with proj as (
    select * from public.projects
    where upper(project_code) = upper(p_code)
    limit 1
  )
  select jsonb_build_object(
    'project', (select to_jsonb(p) from proj p),
    'topics', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'sort_order', t.sort_order)
        order by t.sort_order asc)
      from public.topics t where t.project_id = (select id from proj)
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id, 'slug', c.slug, 'title', c.title, 'topic_id', c.topic_id,
          'status', c.status, 'last_event_at', c.last_event_at,
          'current_summary', c.current_summary, 'properties', c.properties)
        order by c.last_event_at desc nulls last)
      from public.cards c where c.project_id = (select id from proj)
    ), '[]'::jsonb),
    'loop_events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id, 'card_id', e.card_id, 'event_kind', e.event_kind,
          'payload', e.payload, 'occurred_at', e.occurred_at, 'created_at', e.created_at))
      from public.card_events e
      where e.project_id = (select id from proj)
        and e.event_kind in ('decision', 'client_request', 'work')
        and (e.cost_visible = false
             or public.current_cost_visible_for((select id from proj)))
    ), '[]'::jsonb),
    'card_areas', coalesce((
      select jsonb_agg(jsonb_build_object('card_id', ca.card_id, 'area_id', ca.area_id))
      from public.card_areas ca
      where ca.card_id in (select id from public.cards where project_id = (select id from proj))
    ), '[]'::jsonb),
    'gate_status', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'area_id', g.area_id, 'gate_code', g.gate_code, 'status', g.status,
          'target_start_date', g.target_start_date, 'target_end_date', g.target_end_date))
      from public.area_gate_status g
      where g.project_id = (select id from proj)
        and g.status in ('not_started', 'in_progress')
        and g.target_start_date is not null
    ), '[]'::jsonb)
  )
  where exists (select 1 from proj)
    and public.current_can_read_project((select id from proj));
$$;

-- anon can never satisfy the gate (no auth.uid()); keep execute to authenticated.
revoke execute on function public.get_board_bundle(text) from anon;
grant execute on function public.get_board_bundle(text) to authenticated;
