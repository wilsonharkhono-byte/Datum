-- 20260601000010_card_members.sql
-- Slice 1.2a: card_members — subscribe DATUM staff to a card for notification fan-out.
-- Distinct from worker_assigned event (site workers) and project_staff (project-level assignment).

begin;

create type public.card_member_role as enum ('owner','watcher','assignee');

create table public.card_members (
  card_id            uuid not null references public.cards(id) on delete cascade,
  staff_id           uuid not null references public.staff(id) on delete cascade,
  role               public.card_member_role not null default 'watcher',
  added_by_staff_id  uuid references public.staff(id) on delete set null,
  added_at           timestamptz not null default now(),
  removed_at         timestamptz,
  primary key (card_id, staff_id, role)
);

create index card_members_staff_active_idx
  on public.card_members (staff_id)
  where removed_at is null;

create index card_members_card_active_idx
  on public.card_members (card_id)
  where removed_at is null;

alter table public.card_members enable row level security;

-- Read: anyone who can read the card's project
create policy card_members_select on public.card_members
  for select using (
    exists (
      select 1 from public.cards c
       where c.id = card_members.card_id
         and public.current_can_read_project(c.project_id)
    )
  );

-- Insert: anyone in the project can add members (Trello-style)
create policy card_members_insert on public.card_members
  for insert with check (
    exists (
      select 1 from public.cards c
       where c.id = card_members.card_id
         and public.current_can_read_project(c.project_id)
    )
  );

-- Update: anyone in the project can soft-remove (set removed_at) or change role
create policy card_members_update on public.card_members
  for update using (
    exists (
      select 1 from public.cards c
       where c.id = card_members.card_id
         and public.current_can_read_project(c.project_id)
    )
  );

commit;
