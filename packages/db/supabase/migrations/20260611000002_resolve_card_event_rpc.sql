-- 20260611000002_resolve_card_event_rpc.sql
-- Resolve an open-loop event (decision decided, client_request answered)
-- by updating payload.status and recording the correction in
-- record_revisions — atomically, under security definer, because
-- card_events intentionally has no UPDATE RLS policy.

create or replace function public.resolve_card_event(
  p_event_id uuid,
  p_new_status text,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.card_events%rowtype;
  v_old jsonb;
  v_new jsonb;
begin
  select * into v_event from public.card_events where id = p_event_id;
  if not found then
    raise exception 'card_event % not found', p_event_id;
  end if;

  if not public.current_can_read_project(v_event.project_id) then
    raise exception 'not authorized for this project';
  end if;

  if v_event.event_kind = 'decision' then
    if p_new_status not in ('needs_decision', 'decided', 'superseded') then
      raise exception 'invalid decision status: %', p_new_status;
    end if;
  elsif v_event.event_kind = 'client_request' then
    if p_new_status not in ('open', 'answered') then
      raise exception 'invalid client_request status: %', p_new_status;
    end if;
  else
    raise exception 'event kind % has no resolvable lifecycle', v_event.event_kind;
  end if;

  v_old := v_event.payload;
  v_new := v_old || jsonb_build_object('status', p_new_status);

  update public.card_events set payload = v_new where id = p_event_id;

  insert into public.record_revisions
    (project_id, entity_type, entity_id, revision_type,
     previous_payload, new_payload, actor_staff_id, reason)
  values
    (v_event.project_id, 'card_event', p_event_id, 'corrected',
     v_old, v_new, auth.uid(), p_reason);
end;
$$;

revoke all on function public.resolve_card_event(uuid, text, text) from public;
grant execute on function public.resolve_card_event(uuid, text, text) to authenticated;
