-- 20260601000012_polish_rls_and_schema.sql
-- Slice 1.3c: small polish items from earlier code reviews.

begin;

-- (1) cards_update needs WITH CHECK to prevent moving a card to a project the user can't read.
drop policy if exists cards_update on public.cards;
create policy cards_update on public.cards
  for update
  using (public.current_can_read_project(project_id))
  with check (public.current_can_read_project(project_id));

-- (2) card_attachments insert/update should inherit the cost gate from the parent event.
drop policy if exists card_attachments_insert on public.card_attachments;
create policy card_attachments_insert on public.card_attachments
  for insert with check (
    exists (
      select 1 from public.card_events e
       where e.id = card_attachments.card_event_id
         and public.current_can_read_project(e.project_id)
         and (e.cost_visible = false or public.current_cost_visible_for(e.project_id))
    )
  );

drop policy if exists card_attachments_update on public.card_attachments;
create policy card_attachments_update on public.card_attachments
  for update
  using (
    exists (
      select 1 from public.card_events e
       where e.id = card_attachments.card_event_id
         and public.current_can_read_project(e.project_id)
         and (e.cost_visible = false or public.current_cost_visible_for(e.project_id))
    )
  );

commit;
