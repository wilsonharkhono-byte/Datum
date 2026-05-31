-- 20260601000002_cards_layer_fixes.sql
-- Slice 1.1: Fixes from code review on 20260601000001_cards_layer.sql.
--   1. Add missing trg_cards_updated_at trigger (matches every other mutable table).
--   2. Make staff-FK audit columns nullable to match established pattern
--      (topic_notes, drawings, data_drafts all have nullable created_by_staff_id).
--   3. Add index on card_attachments(card_event_id) for the "fetch attachments by event" path.
--   4. Default card_events.payload to '{}'::jsonb for consistency with other not-null jsonb cols.

begin;

-- 1. updated_at trigger on cards
create trigger trg_cards_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

-- 2. Make staff-FK audit columns nullable
alter table public.cards            alter column created_by_staff_id drop not null;
alter table public.card_events      alter column logged_by_staff_id  drop not null;
alter table public.card_links       alter column created_by_staff_id drop not null;

-- 3. Index for attachment lookup by event
create index card_attachments_event_idx on public.card_attachments (card_event_id);

-- 4. Default payload to empty object for inserts that omit it
alter table public.card_events alter column payload set default '{}'::jsonb;

commit;
