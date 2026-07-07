-- packages/db/supabase/migrations/20260702000001_kind_agnostic_inference.sql
-- Widen the card->step inference bridge from event_kind='work' to any event
-- carrying textual field-progress signal. In practice the team logs notes far
-- more than dedicated work events (roughly 89 notes/month vs ~1 work event/month),
-- so restricting the claim RPC + partial index to 'work' starved the bridge of
-- almost all real-world signal. The application layer (apps/web/lib/steps/infer.ts
-- summarizeEventText + is_progress verdict gate) is responsible for skipping
-- non-progress chatter (design discussion, scheduling, client small talk) that
-- happens to arrive on an inferable kind.
-- Additive only (live DB -> supabase db push).

begin;

-- 1. Recreate the partial index with the widened kind predicate. Same shape,
--    same columns — only the event_kind filter changes.
drop index if exists card_events_ai_step_pending_idx;

create index if not exists card_events_ai_step_pending_idx
  on public.card_events (ai_step_status, created_at)
  where ai_step_status in ('pending','failed')
    and event_kind in ('work','note','document','photo','client_request');

-- 2. Atomic claim: flip up to p_limit eligible events (any inferable kind) to
--    'processing'. Signature unchanged (same args/returns) — no client/type
--    regeneration needed.
create or replace function public.claim_card_events_for_step_inference(p_limit int default 5)
returns setof public.card_events
language sql
security definer
set search_path = public
as $$
  update public.card_events
     set ai_step_status = 'processing',
         ai_step_attempts = ai_step_attempts + 1
   where id in (
     select id
       from public.card_events
      where ai_step_status in ('pending','failed')
        and event_kind in ('work','note','document','photo','client_request')
        and ai_step_attempts < 3
      order by created_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning *;
$$;

revoke all on function public.claim_card_events_for_step_inference(int) from public;
revoke all on function public.claim_card_events_for_step_inference(int) from anon;
revoke all on function public.claim_card_events_for_step_inference(int) from authenticated;

commit;
