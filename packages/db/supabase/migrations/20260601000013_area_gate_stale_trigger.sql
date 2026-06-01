-- 20260601000013_area_gate_stale_trigger.sql
-- Slice 1.3.1: mark area_gate_status rows stale when underlying card_events change.

begin;

alter table public.area_gate_status
  add column if not exists stale boolean not null default false;

-- Helper: mark all (area, gate) pairs stale for the areas linked to a given card.
create or replace function public.mark_areas_stale_for_card(p_card_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.area_gate_status ags
     set stale = true
   where ags.area_id in (
     select ca.area_id from public.card_areas ca where ca.card_id = p_card_id
   );
$$;

revoke all on function public.mark_areas_stale_for_card(uuid) from public;
grant execute on function public.mark_areas_stale_for_card(uuid) to authenticated;

-- Trigger: any card_event insert/update marks the parent card's areas stale.
create or replace function public.card_events_mark_stale() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mark_areas_stale_for_card(new.card_id);
  return new;
end;
$$;

drop trigger if exists card_events_mark_stale on public.card_events;
create trigger card_events_mark_stale
  after insert or update on public.card_events
  for each row execute function public.card_events_mark_stale();

-- Trigger: card_areas insert/delete also marks areas stale.
create or replace function public.card_areas_mark_stale() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.area_gate_status
     set stale = true
   where area_id = coalesce(new.area_id, old.area_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists card_areas_mark_stale_ins on public.card_areas;
create trigger card_areas_mark_stale_ins
  after insert or delete on public.card_areas
  for each row execute function public.card_areas_mark_stale();

-- Backfill: mark all existing rows stale so the first recompute refreshes everything.
update public.area_gate_status set stale = true;

commit;
