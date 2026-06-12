-- 20260612000002_projects_trello_board_id.sql
-- Bulk Trello import: stable idempotency key linking a DATUM project to its Trello board.

begin;

alter table public.projects
  add column if not exists trello_board_id text;

create unique index if not exists projects_trello_board_id_key
  on public.projects (trello_board_id)
  where trello_board_id is not null;

-- Backfill the two pilot projects so re-importing their boards reuses the existing rows
-- instead of creating duplicates.
update public.projects set trello_board_id = '665e984287e87d6665545a17'
  where project_code = 'BDG-H1' and trello_board_id is null;
update public.projects set trello_board_id = '66ce848cf20cce1ccc3cea20'
  where project_code = 'PKW-PC1012' and trello_board_id is null;

commit;
