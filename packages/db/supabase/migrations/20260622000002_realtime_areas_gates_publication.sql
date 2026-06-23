-- 20260622000002_realtime_areas_gates_publication.sql
-- Add area_gate_status / areas / card_areas to the Realtime publication so the
-- schedule & rooms surfaces get live gate-status + area updates (web + mobile).
-- Mirrors 20260601000016 (cards/events/comments) and 20260615000001 (topics).
-- These tables already have RLS, so realtime postgres_changes stay RLS-scoped.

begin;

-- Idempotent: ignore if already in publication.
do $$
begin
  begin
    alter publication supabase_realtime add table public.area_gate_status;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.areas;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.card_areas;
  exception when duplicate_object then null;
  end;
end $$;

commit;
