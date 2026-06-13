-- Indexed text search for card_events payloads.
-- The app previously swept 8 payload->>field ilike filters per search /
-- assistant message — unindexable full scans. A stored generated column
-- concatenating the hot text fields + a pg_trgm GIN index makes it one
-- indexed ilike. Additive only (live DB, supabase db push).

create extension if not exists pg_trgm;

alter table public.card_events
  add column if not exists search_text text generated always as (
    lower(
      coalesce(payload->>'body', '')         || ' ' ||
      coalesce(payload->>'description', '')  || ' ' ||
      coalesce(payload->>'topic', '')        || ' ' ||
      coalesce(payload->>'request_text', '') || ' ' ||
      coalesce(payload->>'what', '')         || ' ' ||
      coalesce(payload->>'notes', '')        || ' ' ||
      coalesce(payload->>'title', '')        || ' ' ||
      coalesce(payload->>'caption', '')
    )
  ) stored;

create index if not exists card_events_search_trgm_idx
  on public.card_events using gin (search_text gin_trgm_ops);

-- Creator lookups (author attribution joins) had no index.
create index if not exists card_events_logged_by_idx
  on public.card_events (logged_by_staff_id);
