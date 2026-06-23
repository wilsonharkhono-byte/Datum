-- 20260622000001_push_tokens.sql
-- Device push tokens for mobile push notifications (expo-notifications fan-out).
-- A staff member owns only their own tokens (RLS). The server-side producer reads
-- all recipients' tokens via the service-role client (bypasses RLS) to fan out a push
-- alongside the existing in-app `notifications` insert.

begin;

create table if not exists public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff(id) on delete cascade,
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android', 'web')),
  device_name  text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_tokens_staff_id_idx on public.push_tokens(staff_id);

alter table public.push_tokens enable row level security;

-- staff.id == auth.users.id (see core_schema), so self-ownership is staff_id = auth.uid().
drop policy if exists push_tokens_select_own on public.push_tokens;
create policy push_tokens_select_own on public.push_tokens
  for select to authenticated using (staff_id = auth.uid());

drop policy if exists push_tokens_insert_own on public.push_tokens;
create policy push_tokens_insert_own on public.push_tokens
  for insert to authenticated with check (staff_id = auth.uid());

drop policy if exists push_tokens_update_own on public.push_tokens;
create policy push_tokens_update_own on public.push_tokens
  for update to authenticated using (staff_id = auth.uid()) with check (staff_id = auth.uid());

drop policy if exists push_tokens_delete_own on public.push_tokens;
create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated using (staff_id = auth.uid());

commit;
