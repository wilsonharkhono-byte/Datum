-- 20260601000008_card_comments.sql
-- Slice 1.1.3: Trello-style comments per card with @mention array.
-- Casual back-and-forth thread, separate from the structured card_events timeline.

begin;

create table public.card_comments (
  id                  uuid primary key default gen_random_uuid(),
  card_id             uuid not null references public.cards(id) on delete cascade,
  project_id          uuid not null references public.projects(id) on delete cascade,
  body                text not null,
  mentions            uuid[] not null default '{}',    -- staff_id[] mentioned with @
  edited_at           timestamptz,
  deleted_at          timestamptz,
  created_by_staff_id uuid references public.staff(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index card_comments_card_time_idx
  on public.card_comments (card_id, created_at)
  where deleted_at is null;

alter table public.card_comments enable row level security;

-- Read: anyone who can read the comment's project
create policy card_comments_select on public.card_comments
  for select using (public.current_can_read_project(project_id));

-- Insert: active project_staff (current_can_read_project covers cross-role read too,
-- which means principals/admins can comment on any project — desirable for coordination)
create policy card_comments_insert on public.card_comments
  for insert with check (public.current_can_read_project(project_id));

-- Update: only the author can edit (sets edited_at) or soft-delete (sets deleted_at)
create policy card_comments_update on public.card_comments
  for update using (created_by_staff_id = public.current_staff_id());

-- No delete policy: comments are soft-deleted (set deleted_at) only.

commit;
