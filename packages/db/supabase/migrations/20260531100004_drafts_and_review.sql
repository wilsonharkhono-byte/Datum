-- DATUM Slice 1.0 — data_drafts (assistant-or-risky-human writes pending approval) + review queue

create type public.draft_type as enum
  ('note','decision','material_item_update','material_milestone',
   'quality_checkpoint_pass','quality_checkpoint_fail','blocker_open','blocker_close',
   'drawing_extraction','photo_record','progress_update','cost_quote','invoice');

create type public.draft_risk_level as enum ('low','medium','high');

create type public.draft_status as enum
  ('draft','approved','rejected','superseded','auto_promoted');

create type public.draft_source_type as enum
  ('manual_form','assistant_chat','pdf_upload','image_upload','import','migration');

create table public.data_drafts (
  id                          uuid primary key default gen_random_uuid(),
  project_id                  uuid not null references public.projects(id) on delete cascade,
  topic_id                    uuid references public.topics(id) on delete set null,
  draft_type                  public.draft_type not null,
  proposed_payload            jsonb not null,
  risk_level                  public.draft_risk_level not null default 'medium',
  approval_required_role      public.staff_role,
  status                      public.draft_status not null default 'draft',
  source_type                 public.draft_source_type not null,
  source_attachment_id        uuid references public.attachments(id) on delete set null,
  source_assistant_message_id uuid,    -- FK added in Slice 2 once assistant_messages exists
  original_input_text         text,
  created_by_staff_id         uuid references public.staff(id),
  approved_by_staff_id        uuid references public.staff(id),
  rejected_by_staff_id        uuid references public.staff(id),
  rejection_reason            text,
  promoted_record_type        text,
  promoted_record_id          uuid,
  created_at                  timestamptz not null default now(),
  approved_at                 timestamptz,
  rejected_at                 timestamptz
);
create index data_drafts_project_status_idx on public.data_drafts(project_id, status);
create index data_drafts_pending_idx on public.data_drafts(project_id, risk_level, created_at)
  where status = 'draft';
create index data_drafts_topic_idx on public.data_drafts(topic_id) where topic_id is not null;

------------------------------------------------------------------------
-- Review queue (assignment + priority surface for drafts that need human attention)
------------------------------------------------------------------------
create type public.review_priority as enum ('low','normal','high','urgent');

create type public.review_queue_status as enum ('pending','in_review','resolved','dismissed');

create table public.review_queue (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  draft_id             uuid not null references public.data_drafts(id) on delete cascade,
  assigned_to_staff_id uuid references public.staff(id),
  priority             public.review_priority not null default 'normal',
  status               public.review_queue_status not null default 'pending',
  created_at           timestamptz not null default now(),
  resolved_at          timestamptz,
  resolved_by_staff_id uuid references public.staff(id)
);
create index review_queue_project_idx on public.review_queue(project_id, status, priority);
create index review_queue_assignee_idx on public.review_queue(assigned_to_staff_id)
  where status in ('pending','in_review');
