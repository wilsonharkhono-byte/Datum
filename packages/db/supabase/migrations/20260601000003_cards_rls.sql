-- 20260601000003_cards_rls.sql
-- Slice 1.1: RLS for cards layer.
-- Read: any active staff assigned to the project (via project_staff).
-- Cost-visible card_events: gated additionally by current_cost_visible_for(project_id).
-- Write: any active staff on the project (drafts handle high-risk routing).

begin;

alter table public.cards            enable row level security;
alter table public.card_areas       enable row level security;
alter table public.card_events      enable row level security;
alter table public.card_attachments enable row level security;
alter table public.card_links       enable row level security;

-- Helper: is the calling user an active staff on this project?
-- (Slice 1.0 already defined current_staff_id() and current_cost_visible_for(); reuse.)

create policy cards_select on public.cards
  for select using (
    exists (
      select 1 from public.project_staff ps
       where ps.project_id = cards.project_id
         and ps.staff_id   = public.current_staff_id()
         and ps.active_until is null
    )
  );

create policy cards_insert on public.cards
  for insert with check (
    exists (
      select 1 from public.project_staff ps
       where ps.project_id = cards.project_id
         and ps.staff_id   = public.current_staff_id()
         and ps.active_until is null
    )
  );

create policy cards_update on public.cards
  for update using (
    exists (
      select 1 from public.project_staff ps
       where ps.project_id = cards.project_id
         and ps.staff_id   = public.current_staff_id()
         and ps.active_until is null
    )
  );

create policy card_areas_select on public.card_areas
  for select using (
    exists (select 1 from public.cards c
             where c.id = card_areas.card_id
               and exists (select 1 from public.project_staff ps
                            where ps.project_id = c.project_id
                              and ps.staff_id   = public.current_staff_id()
                              and ps.active_until is null))
  );

create policy card_areas_write on public.card_areas
  for all using (
    exists (select 1 from public.cards c
             where c.id = card_areas.card_id
               and exists (select 1 from public.project_staff ps
                            where ps.project_id = c.project_id
                              and ps.staff_id   = public.current_staff_id()
                              and ps.active_until is null))
  );

-- card_events: select rule includes cost-visibility branch.
create policy card_events_select on public.card_events
  for select using (
    exists (
      select 1 from public.project_staff ps
       where ps.project_id = card_events.project_id
         and ps.staff_id   = public.current_staff_id()
         and ps.active_until is null
    )
    and (
      card_events.cost_visible = false
      or public.current_cost_visible_for(card_events.project_id) = true
    )
  );

create policy card_events_insert on public.card_events
  for insert with check (
    exists (
      select 1 from public.project_staff ps
       where ps.project_id = card_events.project_id
         and ps.staff_id   = public.current_staff_id()
         and ps.active_until is null
    )
  );

-- card_attachments: read iff parent event is readable.
create policy card_attachments_select on public.card_attachments
  for select using (
    exists (
      select 1 from public.card_events e
       where e.id = card_attachments.card_event_id
         and (
           e.cost_visible = false
           or public.current_cost_visible_for(e.project_id) = true
         )
         and exists (select 1 from public.project_staff ps
                      where ps.project_id = e.project_id
                        and ps.staff_id   = public.current_staff_id()
                        and ps.active_until is null)
    )
  );

create policy card_attachments_write on public.card_attachments
  for all using (
    exists (
      select 1 from public.card_events e
       where e.id = card_attachments.card_event_id
         and exists (select 1 from public.project_staff ps
                      where ps.project_id = e.project_id
                        and ps.staff_id   = public.current_staff_id()
                        and ps.active_until is null)
    )
  );

create policy card_links_rw on public.card_links
  for all using (
    exists (select 1 from public.cards c
             where c.id = card_links.from_card_id
               and exists (select 1 from public.project_staff ps
                            where ps.project_id = c.project_id
                              and ps.staff_id   = public.current_staff_id()
                              and ps.active_until is null))
  );

commit;
