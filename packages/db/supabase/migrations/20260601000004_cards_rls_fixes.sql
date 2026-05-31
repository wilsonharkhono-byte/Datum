-- 20260601000004_cards_rls_fixes.sql
-- Slice 1.1: Fixes for cards-layer RLS (follow-up to 20260601000003_cards_rls.sql).
--
-- Replaces all 10 policies with versions that:
--   1. Use public.current_can_read_project() helper (correct cross-role read + future-dated active_until)
--   2. Split FOR ALL policies into insert/update only (append-only — no delete)
--   3. card_links INSERT verifies both endpoint cards are readable (prevent cross-project oracle)

begin;

-- Drop all 10 broken policies
drop policy if exists cards_select               on public.cards;
drop policy if exists cards_insert               on public.cards;
drop policy if exists cards_update               on public.cards;
drop policy if exists card_areas_select          on public.card_areas;
drop policy if exists card_areas_write           on public.card_areas;
drop policy if exists card_events_select         on public.card_events;
drop policy if exists card_events_insert         on public.card_events;
drop policy if exists card_attachments_select    on public.card_attachments;
drop policy if exists card_attachments_write     on public.card_attachments;
drop policy if exists card_links_rw              on public.card_links;

-- cards: select/insert/update (no delete — append-only)
create policy cards_select on public.cards
  for select using (public.current_can_read_project(project_id));

create policy cards_insert on public.cards
  for insert with check (public.current_can_read_project(project_id));

create policy cards_update on public.cards
  for update using (public.current_can_read_project(project_id));

-- card_areas: select + insert only (composite PK only; updates not meaningful, deletes denied)
create policy card_areas_select on public.card_areas
  for select using (
    exists (
      select 1 from public.cards c
       where c.id = card_areas.card_id
         and public.current_can_read_project(c.project_id)
    )
  );

create policy card_areas_insert on public.card_areas
  for insert with check (
    exists (
      select 1 from public.cards c
       where c.id = card_areas.card_id
         and public.current_can_read_project(c.project_id)
    )
  );

-- card_events: select gated by project + cost-visibility; insert restricted to project members
create policy card_events_select on public.card_events
  for select using (
    public.current_can_read_project(project_id)
    and (
      cost_visible = false
      or public.current_cost_visible_for(project_id)
    )
  );

create policy card_events_insert on public.card_events
  for insert with check (public.current_can_read_project(project_id));

-- card_attachments: read iff parent event is readable (inherits cost gating)
create policy card_attachments_select on public.card_attachments
  for select using (
    exists (
      select 1 from public.card_events e
       where e.id = card_attachments.card_event_id
         and public.current_can_read_project(e.project_id)
         and (e.cost_visible = false or public.current_cost_visible_for(e.project_id))
    )
  );

create policy card_attachments_insert on public.card_attachments
  for insert with check (
    exists (
      select 1 from public.card_events e
       where e.id = card_attachments.card_event_id
         and public.current_can_read_project(e.project_id)
    )
  );

create policy card_attachments_update on public.card_attachments
  for update using (
    exists (
      select 1 from public.card_events e
       where e.id = card_attachments.card_event_id
         and public.current_can_read_project(e.project_id)
    )
  );

-- card_links: select via from-card project; insert requires BOTH endpoints readable; update via from-card project; no delete
create policy card_links_select on public.card_links
  for select using (
    exists (
      select 1 from public.cards c
       where c.id = card_links.from_card_id
         and public.current_can_read_project(c.project_id)
    )
  );

create policy card_links_insert on public.card_links
  for insert with check (
    exists (
      select 1 from public.cards cf
       where cf.id = card_links.from_card_id
         and public.current_can_read_project(cf.project_id)
    )
    and exists (
      select 1 from public.cards ct
       where ct.id = card_links.to_card_id
         and public.current_can_read_project(ct.project_id)
    )
  );

create policy card_links_update on public.card_links
  for update using (
    exists (
      select 1 from public.cards c
       where c.id = card_links.from_card_id
         and public.current_can_read_project(c.project_id)
    )
  );

commit;
