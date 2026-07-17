-- Trello-style unique @handles for staff.
--
-- Mentions previously resolved by first name, which is ambiguous once two
-- people share one. `handle` is a unique, lowercase username used for
-- @mention resolution and autocomplete. Nullable on purpose: seed/import
-- paths that don't set it keep working (resolution falls back to first name),
-- and the staff-creation API generates one for every new account.

alter table public.staff add column if not exists handle text;

-- Backfill: lowercase first word of full_name, stripped to [a-z0-9_], with a
-- numeric suffix for duplicates (budi, budi2, budi3 …). Names that sanitize to
-- nothing (or don't start with a letter) fall back to a 'staf' prefix.
with base as (
  select
    id,
    created_at,
    coalesce(
      nullif(regexp_replace(lower(split_part(trim(full_name), ' ', 1)), '[^a-z0-9_]', '', 'g'), ''),
      'staf'
    ) as raw
  from public.staff
  where handle is null
), ranked as (
  select
    id,
    case when raw ~ '^[a-z]' then raw else 'staf' || raw end as base_handle,
    row_number() over (
      partition by (case when raw ~ '^[a-z]' then raw else 'staf' || raw end)
      order by created_at, id
    ) as rn
  from base
)
update public.staff s
set handle = case when r.rn = 1 then r.base_handle else r.base_handle || r.rn::text end
from ranked r
where s.id = r.id;

-- Handles are stored lowercase, start with a letter, and must be unique.
alter table public.staff
  add constraint staff_handle_format
  check (handle is null or handle ~ '^[a-z][a-z0-9_]{0,30}$');

create unique index if not exists staff_handle_key on public.staff (handle);
