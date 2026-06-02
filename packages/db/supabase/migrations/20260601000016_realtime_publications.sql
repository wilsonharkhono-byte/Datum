-- 20260601000016_realtime_publications.sql
-- Slice 1.7: enable Realtime on board-level tables so multi-user edits propagate.

begin;

-- Idempotent: ignore if already in publication
do $$
begin
  begin
    alter publication supabase_realtime add table public.cards;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.card_events;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.card_comments;
  exception when duplicate_object then null;
  end;
end $$;

commit;
