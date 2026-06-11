-- 20260611000003_lifecycle_status_catchup.sql
-- Catch-up for rows created in the gap between the lifecycle backfill
-- (20260611000001) and the Zod-default fix in @datum/types: until that fix,
-- new decisions/client_requests could be inserted without payload.status,
-- making them invisible to the brief's contains-queries. Re-runs the two
-- status backfills (both idempotent: guarded on `not payload ? 'status'`).

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

commit;
