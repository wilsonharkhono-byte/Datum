-- One round-trip board read: bundles project, topics, cards, open-loop events,
-- card_areas, and active gate-status rows as a single JSON object. Label and
-- deadline computation stays in TypeScript (mapBoardBundle); this function only
-- fetches. SECURITY INVOKER so the caller's RLS still applies.
create or replace function public.get_board_bundle(p_code text)
returns jsonb
language sql
stable
security invoker
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
  where exists (select 1 from proj);

grant execute on function public.get_board_bundle(text) to anon, authenticated;
