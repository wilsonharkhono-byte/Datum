-- 20260601000014_notifications.sql
-- Slice 1.4a: in-app notification queue per staff.
-- Producers (insert sites) come in a follow-up to avoid mutations.ts conflicts.

begin;

create type public.notification_kind as enum (
  'mention',           -- @mentioned in a comment
  'watcher_event',     -- watched card had a key event (decision/defect/pending/client_request)
  'card_status',       -- watched card status changed
  'draft_pending',     -- you created a draft that's now waiting
  'draft_approved',    -- your draft was approved
  'draft_rejected',    -- your draft was rejected
  'review_assigned'    -- a draft is assigned to you to review
);

create table public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  recipient_staff_id  uuid not null references public.staff(id) on delete cascade,
  kind                public.notification_kind not null,
  project_id          uuid references public.projects(id) on delete cascade,
  card_id             uuid references public.cards(id) on delete cascade,
  card_event_id       uuid references public.card_events(id) on delete cascade,
  card_comment_id     uuid references public.card_comments(id) on delete cascade,
  draft_id            uuid references public.data_drafts(id) on delete cascade,
  actor_staff_id      uuid references public.staff(id) on delete set null,
  summary             text not null,                  -- 1-line Bahasa preview
  link                text not null,                  -- in-app URL like /project/CODE/cards/SLUG
  read_at             timestamptz,
  created_at          timestamptz not null default now()
);

create index notifications_recipient_unread_idx
  on public.notifications (recipient_staff_id, created_at desc)
  where read_at is null;

create index notifications_recipient_all_idx
  on public.notifications (recipient_staff_id, created_at desc);

alter table public.notifications enable row level security;

-- Read: only the recipient can see their notifications
create policy notifications_select on public.notifications
  for select using (recipient_staff_id = public.current_staff_id());

-- Update: only the recipient can mark them read (only updates read_at)
create policy notifications_update on public.notifications
  for update using (recipient_staff_id = public.current_staff_id());

-- Insert: any authenticated user (the producer-side code in a follow-up
-- will call this from server actions; refined to per-event predicates later)
create policy notifications_insert on public.notifications
  for insert with check (auth.uid() is not null);

commit;
