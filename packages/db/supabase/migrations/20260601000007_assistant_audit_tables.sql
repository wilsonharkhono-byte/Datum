-- 20260601000007_assistant_audit_tables.sql
-- Slice 1.1: assistant_sessions / assistant_messages / assistant_query_audit tables
-- so chat exchanges and AI-cost telemetry can be recorded.
-- Defers FK from data_drafts.source_assistant_message_id (still nullable; can
-- be backfilled or constrained in a later slice when capture-flow is built).

begin;

create type public.assistant_message_role as enum ('user','assistant','system');

create table public.assistant_sessions (
  id                 uuid primary key default gen_random_uuid(),
  staff_id           uuid references public.staff(id) on delete set null,
  project_id         uuid references public.projects(id) on delete cascade,
  title              text not null default 'Chat',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_message_at    timestamptz
);

create table public.assistant_messages (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.assistant_sessions(id) on delete cascade,
  staff_id            uuid references public.staff(id) on delete set null,
  role                public.assistant_message_role not null,
  content             text not null,
  sources_jsonb       jsonb not null default '{}'::jsonb,
  token_count         integer,
  estimated_cost_usd  numeric(10,6),
  created_at          timestamptz not null default now()
);

create table public.assistant_query_audit (
  id                          uuid primary key default gen_random_uuid(),
  staff_id                    uuid references public.staff(id) on delete set null,
  project_scope_jsonb         jsonb not null default '{}'::jsonb,
  question                    text not null,
  answer_summary              text,
  records_accessed_jsonb      jsonb not null default '{}'::jsonb,
  included_unapproved_drafts  boolean not null default false,
  estimated_cost_usd          numeric(10,6),
  created_at                  timestamptz not null default now()
);

-- Trigger: keep session.last_message_at fresh and bump updated_at.
create or replace function public.touch_session_last_message() returns trigger
language plpgsql as $$
begin
  update public.assistant_sessions
     set last_message_at = new.created_at,
         updated_at      = now()
   where id = new.session_id;
  return new;
end;
$$;

create trigger assistant_messages_touch_session
  after insert on public.assistant_messages
  for each row execute function public.touch_session_last_message();

-- updated_at trigger on sessions (only mutable field besides last_message_at is title)
create trigger trg_assistant_sessions_updated_at
  before update on public.assistant_sessions
  for each row execute function public.set_updated_at();

-- Indexes
create index assistant_messages_session_time_idx
  on public.assistant_messages (session_id, created_at);
create index assistant_sessions_staff_idx
  on public.assistant_sessions (staff_id, last_message_at desc);
create index assistant_query_audit_staff_idx
  on public.assistant_query_audit (staff_id, created_at desc);

-- RLS: a session is readable/writable by the staff who owns it,
--      or by anyone with cross-project read access (for principals/admins reviewing usage).
alter table public.assistant_sessions      enable row level security;
alter table public.assistant_messages      enable row level security;
alter table public.assistant_query_audit   enable row level security;

create policy assistant_sessions_select on public.assistant_sessions
  for select using (
    staff_id = public.current_staff_id()
    or (project_id is not null and public.current_can_read_project(project_id))
  );

create policy assistant_sessions_insert on public.assistant_sessions
  for insert with check (
    staff_id = public.current_staff_id()
    and (project_id is null or public.current_can_read_project(project_id))
  );

create policy assistant_sessions_update on public.assistant_sessions
  for update using (staff_id = public.current_staff_id());

create policy assistant_messages_select on public.assistant_messages
  for select using (
    exists (
      select 1 from public.assistant_sessions s
       where s.id = assistant_messages.session_id
         and (s.staff_id = public.current_staff_id()
              or (s.project_id is not null and public.current_can_read_project(s.project_id)))
    )
  );

create policy assistant_messages_insert on public.assistant_messages
  for insert with check (
    staff_id = public.current_staff_id()
    and exists (
      select 1 from public.assistant_sessions s
       where s.id = assistant_messages.session_id
         and s.staff_id = public.current_staff_id()
    )
  );

create policy assistant_query_audit_select on public.assistant_query_audit
  for select using (
    staff_id = public.current_staff_id()
    or public.current_has_cross_project_read()
  );

create policy assistant_query_audit_insert on public.assistant_query_audit
  for insert with check (staff_id = public.current_staff_id());

commit;
