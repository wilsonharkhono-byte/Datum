-- 20260611000001_lifecycle_backfill.sql
-- Card taxonomy redesign step 1: backfill explicit lifecycle state.
-- Idempotent: every statement guards on the key it adds.

begin;

-- decision: explicit status. A decision with approval evidence is decided;
-- everything else is still open.
update public.card_events
   set payload = payload || jsonb_build_object(
         'status',
         case when payload ? 'approved_by' then 'decided' else 'needs_decision' end
       )
 where event_kind = 'decision'
   and not payload ? 'status';

-- client_request: explicit open status. We cannot know which legacy requests
-- were answered; they start open and staff resolve them via the timeline UI.
update public.card_events
   set payload = payload || jsonb_build_object('status', 'open')
 where event_kind = 'client_request'
   and not payload ? 'status';

-- Ex-defect work events: only defect payloads carried `severity` at
-- migration time (slice 1.9 set them to work/status=blocked). Mark them as
-- defects so quality issues are distinguishable from stalled work again.
update public.card_events
   set payload = payload || jsonb_build_object('issue', 'defect')
 where event_kind = 'work'
   and payload ? 'severity'
   and not payload ? 'issue';

-- Legacy pending notes → structured blocked work events. Slice 1.9 folded
-- `pending` blockers into free-text notes ("(menunggu) …" +
-- pending_blocked_on), which made them invisible to readiness/brief logic.
update public.card_events
   set event_kind = 'work',
       payload = jsonb_strip_nulls(jsonb_build_object(
         'status', 'blocked',
         'description', nullif(replace(coalesce(payload->>'body', ''), '(menunggu) ', ''), ''),
         'blocked_on', payload->>'pending_blocked_on'
       ))
 where event_kind = 'note'
   and payload ? 'pending_blocked_on';

commit;
