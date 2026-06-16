-- 20260616000001_attachment_ai_state.sql
-- AI attachment understanding, Phase 1: processing-state for card_attachments
-- so a background runner can describe images/PDFs into ai_caption.
-- ai_caption / ai_extracted already exist (20260601000001_cards_layer.sql).
-- Additive only (live DB → supabase db push).

begin;

-- 1. Processing lifecycle for a single attachment.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attachment_ai_status') then
    create type public.attachment_ai_status as enum
      ('pending','processing','done','failed','skipped');
  end if;
end $$;

alter table public.card_attachments
  add column if not exists ai_status       public.attachment_ai_status not null default 'pending',
  add column if not exists ai_error        text,
  add column if not exists ai_model        text,
  add column if not exists ai_processed_at timestamptz,
  add column if not exists ai_attempts     int not null default 0;

-- 2. Work-queue index: rows the runner should pick up.
create index if not exists card_attachments_ai_pending_idx
  on public.card_attachments (ai_status, created_at)
  where ai_status in ('pending','failed');

-- 3. Atomic claim: flip up to p_limit eligible rows to 'processing' and return
--    them. `for update skip locked` lets overlapping cron ticks not collide.
--    Service-role only (revoked from anon/authenticated).
create or replace function public.claim_attachments_for_analysis(p_limit int default 5)
returns setof public.card_attachments
language sql
security definer
set search_path = public
as $$
  update public.card_attachments
     set ai_status = 'processing',
         ai_attempts = ai_attempts + 1
   where id in (
     select id
       from public.card_attachments
      where ai_status in ('pending','failed')
        and ai_attempts < 3
      order by created_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning *;
$$;

revoke all on function public.claim_attachments_for_analysis(int) from public;
revoke all on function public.claim_attachments_for_analysis(int) from anon;
revoke all on function public.claim_attachments_for_analysis(int) from authenticated;

-- 4. Realtime so the open card view swaps "Menganalisis…" for the caption live.
do $$
begin
  begin
    alter publication supabase_realtime add table public.card_attachments;
  exception when duplicate_object then null;
  end;
end $$;

commit;
