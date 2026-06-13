-- card_links had no DELETE policy (20260601000004 comment: "no delete"),
-- so the Terkait UI's remove action silently deletes 0 rows. Allow project
-- members who can read the from-card's project to remove links, matching
-- the UPDATE policy's scope.

create policy card_links_delete on public.card_links
  for delete using (
    exists (
      select 1 from public.cards c
       where c.id = card_links.from_card_id
         and public.current_can_read_project(c.project_id)
    )
  );
