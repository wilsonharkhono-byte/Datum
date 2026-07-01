-- packages/db/supabase/migrations/20260628000002_card_step_inference.sql
-- Card->step inference bridge: provenance on area_step_events + an outbox on
-- card_events so a background cron can infer step status from work events.
-- Additive only (live DB -> supabase db push).

begin;

-- 1. Provenance on AI-authored step events.
alter table public.area_step_events
  add column if not exists source        text not null default 'human',
  add column if not exists confidence    numeric(4,3),
  add column if not exists card_event_id uuid references public.card_events(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'area_step_events_source_check'
  ) then
    alter table public.area_step_events
      add constraint area_step_events_source_check check (source in ('human','ai'));
  end if;
end $$;

-- One AI event per (card_event, area_step): re-running the cron is idempotent.
create unique index if not exists area_step_events_ai_dedup
  on public.area_step_events (card_event_id, area_step_id)
  where source = 'ai' and card_event_id is not null;

-- 2. Outbox state on card_events (only 'work' events are ever claimed).
alter table public.card_events
  add column if not exists ai_step_status      text not null default 'pending',
  add column if not exists ai_step_error       text,
  add column if not exists ai_step_attempts    int  not null default 0,
  add column if not exists ai_step_processed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'card_events_ai_step_status_check'
  ) then
    alter table public.card_events
      add constraint card_events_ai_step_status_check
      check (ai_step_status in ('pending','processing','done','failed','skipped'));
  end if;
end $$;

create index if not exists card_events_ai_step_pending_idx
  on public.card_events (ai_step_status, created_at)
  where ai_step_status in ('pending','failed') and event_kind = 'work';

-- 3. Atomic claim: flip up to p_limit eligible work events to 'processing'.
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
        and event_kind = 'work'
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
