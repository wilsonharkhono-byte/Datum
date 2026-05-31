-- 20260601000001_cards_layer.sql
-- Slice 1.1: Cards layer — subject cards with structured timeline.

begin;

-- Event kind enum for card_events.
create type public.card_event_kind as enum (
  'decision','drawing','survey','vendor_quote','vendor_pick',
  'material','worker_assigned','progress','defect','photo',
  'document','client_request','note','pending'
);

create type public.card_status as enum ('active','dormant','closed');
create type public.card_link_relation as enum
  ('depends_on','blocks','related_to','supersedes');
create type public.card_event_source as enum
  ('chat','manual','import','ai_extraction','external_pdf');

-- Subject cards. One per long-lived subject inside a topic (column).
create table public.cards (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  topic_id            uuid not null references public.topics(id) on delete cascade,
  title               text not null,
  slug                text not null,
  status              public.card_status not null default 'active',
  current_summary     text,
  properties          jsonb not null default '{}'::jsonb,
  created_by_staff_id uuid not null references public.staff(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  last_event_at       timestamptz,
  unique (project_id, slug)
);

-- Many-to-many: a card can reference multiple areas (drives gate readiness later).
create table public.card_areas (
  card_id uuid not null references public.cards(id) on delete cascade,
  area_id uuid not null references public.areas(id) on delete cascade,
  primary key (card_id, area_id)
);

-- The timeline: every typed event on every card.
create table public.card_events (
  id                 uuid primary key default gen_random_uuid(),
  card_id            uuid not null references public.cards(id) on delete cascade,
  project_id         uuid not null references public.projects(id) on delete cascade,
  event_kind         public.card_event_kind not null,
  payload            jsonb not null,
  occurred_at        timestamptz not null,
  logged_by_staff_id uuid not null references public.staff(id),
  source_kind        public.card_event_source not null,
  source_id          uuid,
  cost_visible       boolean not null default false,
  draft_id           uuid references public.data_drafts(id),
  created_at         timestamptz not null default now()
);

-- Attachments belong to a card_event for fast media queries.
create table public.card_attachments (
  id            uuid primary key default gen_random_uuid(),
  card_event_id uuid not null references public.card_events(id) on delete cascade,
  storage_path  text not null,
  mime_type     text not null,
  ai_caption    text,
  ai_extracted  jsonb,
  created_at    timestamptz not null default now()
);

-- Inter-card relations.
create table public.card_links (
  from_card_id        uuid not null references public.cards(id) on delete cascade,
  to_card_id          uuid not null references public.cards(id) on delete cascade,
  relation            public.card_link_relation not null,
  created_by_staff_id uuid not null references public.staff(id),
  created_at          timestamptz not null default now(),
  primary key (from_card_id, to_card_id, relation),
  check (from_card_id <> to_card_id)
);

-- Indexes
create index cards_project_topic_status_idx on public.cards (project_id, topic_id, status);
create index card_events_card_time_idx on public.card_events (card_id, occurred_at desc);
create index card_events_project_kind_time_idx
  on public.card_events (project_id, event_kind, occurred_at desc);
create index card_events_cost_visible_idx
  on public.card_events (project_id) where cost_visible = true;

-- Trigger: keep cards.last_event_at fresh as events arrive.
create or replace function public.touch_card_last_event() returns trigger
language plpgsql as $$
begin
  update public.cards
     set last_event_at = greatest(coalesce(last_event_at, 'epoch'::timestamptz), new.occurred_at),
         updated_at    = now()
   where id = new.card_id;
  return new;
end;
$$;

create trigger card_events_touch_card
  after insert on public.card_events
  for each row execute function public.touch_card_last_event();

commit;
