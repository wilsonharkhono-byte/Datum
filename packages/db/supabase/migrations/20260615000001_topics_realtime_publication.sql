-- 20260615000001_topics_realtime_publication.sql
-- Add topics (= board columns) to the Realtime publication so a column added by
-- one user propagates to other open boards. Mirrors 20260601000016, which added
-- cards/card_events/card_comments.

begin;

-- Idempotent: ignore if already in publication
do $$
begin
  begin
    alter publication supabase_realtime add table public.topics;
  exception when duplicate_object then null;
  end;
end $$;

commit;
