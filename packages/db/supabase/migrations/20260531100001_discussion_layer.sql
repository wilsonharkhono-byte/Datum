-- DATUM Slice 1.0 — discussion overlay (Trello-familiar topics + drawing register + attachments)

------------------------------------------------------------------------
-- Topics (drawing-code containers like A04 Tangga, U02 Listrik, FORUM-INT)
------------------------------------------------------------------------
create type public.topic_type as enum
  ('drawing','utility','room','forum','general');

create table public.topics (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  code                text not null,
  name                text not null,
  topic_type          public.topic_type not null default 'general',
  default_gate        public.gate_code,
  related_area_id     uuid references public.areas(id) on delete set null,
  status              text not null default 'open',
  sort_order          integer not null default 0,
  created_by_staff_id uuid references public.staff(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, code)
);
create trigger trg_topics_updated_at
  before update on public.topics
  for each row execute function public.set_updated_at();
create index topics_project_idx on public.topics(project_id, sort_order);
create index topics_area_idx on public.topics(related_area_id) where related_area_id is not null;

------------------------------------------------------------------------
-- Topic notes (the discussion content — equivalent of Trello card comments)
------------------------------------------------------------------------
create type public.topic_note_type as enum
  ('general','meeting','client_conversation','site_instruction','survey','decision_log','imported');

create type public.note_official_status as enum
  ('draft','approved','rejected');

create table public.topic_notes (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  topic_id             uuid not null references public.topics(id) on delete cascade,
  body                 text not null,
  note_type            public.topic_note_type not null default 'general',
  related_area_id      uuid references public.areas(id),
  related_gate         public.gate_code,
  related_record_type  text,
  related_record_id    uuid,
  official_status      public.note_official_status not null default 'approved',
  created_by_staff_id  uuid references public.staff(id),
  approved_by_staff_id uuid references public.staff(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_topic_notes_updated_at
  before update on public.topic_notes
  for each row execute function public.set_updated_at();
create index topic_notes_topic_created_idx on public.topic_notes(topic_id, created_at desc);
create index topic_notes_cell_idx on public.topic_notes(project_id, related_area_id, related_gate)
  where related_area_id is not null;

------------------------------------------------------------------------
-- Drawings register (per-project drawing list with status pipeline)
------------------------------------------------------------------------
create type public.drawing_type as enum
  ('cover','floor_plan','section','elevation','door_window','detail',
   'finishing_schedule','room_data_sheet','utility','landscape','other');

create type public.drawing_status as enum
  ('required','issued','revised','approved','superseded','not_applicable');

create table public.drawings (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  drawing_code    text not null,
  drawing_name    text not null,
  drawing_type    public.drawing_type not null default 'other',
  status          public.drawing_status not null default 'required',
  current_revision text,
  drawn_by        text,
  last_updated    date,
  notes           text,
  related_topic_id uuid references public.topics(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, drawing_code)
);
create trigger trg_drawings_updated_at
  before update on public.drawings
  for each row execute function public.set_updated_at();
create index drawings_project_idx on public.drawings(project_id);
create index drawings_status_idx on public.drawings(status) where status <> 'not_applicable';

------------------------------------------------------------------------
-- Drawing revisions (append-only history of file uploads per drawing)
------------------------------------------------------------------------
create table public.drawing_revisions (
  id                  uuid primary key default gen_random_uuid(),
  drawing_id          uuid not null references public.drawings(id) on delete cascade,
  revision_code       text not null,
  file_path           text not null,
  uploaded_by_staff_id uuid references public.staff(id),
  uploaded_at         timestamptz not null default now(),
  notes               text,
  unique (drawing_id, revision_code)
);
create index drawing_revisions_drawing_idx on public.drawing_revisions(drawing_id, uploaded_at desc);

------------------------------------------------------------------------
-- Attachments (photos, PDFs — anything attached to any record)
------------------------------------------------------------------------
create type public.attachment_kind as enum
  ('photo','drawing','document','other');

create table public.attachments (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  kind                 public.attachment_kind not null default 'photo',
  file_path            text not null,
  mime_type            text,
  caption              text,
  gps_lat              numeric(10,7),
  gps_lon              numeric(10,7),
  taken_at             timestamptz,
  related_area_id      uuid references public.areas(id),
  related_gate         public.gate_code,
  related_record_type  text,
  related_record_id    uuid,
  uploaded_by_staff_id uuid references public.staff(id),
  created_at           timestamptz not null default now()
);
create index attachments_project_idx on public.attachments(project_id, created_at desc);
create index attachments_cell_idx on public.attachments(project_id, related_area_id, related_gate)
  where related_area_id is not null;
create index attachments_record_idx on public.attachments(related_record_type, related_record_id)
  where related_record_type is not null;
