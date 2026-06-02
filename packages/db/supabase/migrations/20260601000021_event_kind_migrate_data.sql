-- 20260601000020b_event_kind_migrate_data.sql
-- Slice 1.9-taxonomy step 2: migrate 503 existing events to the consolidated taxonomy.
-- Old kinds remain in the enum (Postgres can't safely drop enum values that may have
-- been used historically) but the app stops using them.

begin;

-- vendor_quote → vendor (interaction='quote')
update public.card_events
   set event_kind = 'vendor',
       payload    = payload || jsonb_build_object('interaction', 'quote')
 where event_kind = 'vendor_quote';

-- vendor_pick → vendor (interaction='pick')
update public.card_events
   set event_kind = 'vendor',
       payload    = payload || jsonb_build_object('interaction', 'pick')
 where event_kind = 'vendor_pick';

-- survey → vendor (interaction='survey')
update public.card_events
   set event_kind = 'vendor',
       payload    = payload || jsonb_build_object('interaction', 'survey')
 where event_kind = 'survey';

-- worker_assigned → work (status='assigned'); preserve existing payload fields
update public.card_events
   set event_kind = 'work',
       payload    = payload || jsonb_build_object('status', 'assigned')
 where event_kind = 'worker_assigned';

-- progress → work; if percent_complete=100 then status='done', else 'in_progress'
update public.card_events
   set event_kind = 'work',
       payload    = payload || jsonb_build_object(
         'status',
         case when (payload->>'percent_complete')::int = 100 then 'done' else 'in_progress' end
       )
 where event_kind = 'progress';

-- defect → work (status='blocked', severity preserved as-is)
update public.card_events
   set event_kind = 'work',
       payload    = payload || jsonb_build_object('status', 'blocked')
 where event_kind = 'defect';

-- pending → note; preserve original `what` as body, preserve blocked_on as a payload field
update public.card_events
   set event_kind = 'note',
       payload    = jsonb_build_object(
         'body', '(menunggu) ' || coalesce(payload->>'what', ''),
         'pending_blocked_on', payload->>'blocked_on'
       )
 where event_kind = 'pending';

commit;
