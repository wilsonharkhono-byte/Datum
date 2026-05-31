-- 20260601000009_card_attachments_storage.sql
-- Slice 1.1.5: private Storage bucket for card attachments + RLS.
-- Path layout: `<project_id>/<card_id>/<event_id>/<uuid>-<original-filename>`
-- so the project_id prefix lets RLS scope reads/writes cleanly.

begin;

-- 1. Create the bucket (private; no public read).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-attachments',
  'card-attachments',
  false,
  20971520,  -- 20 MB per file
  array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. RLS on storage.objects scoped to this bucket.
--    The path's first segment must be a project UUID the user can read.
--    We use a helper that extracts the first path segment and validates it.

create or replace function public.path_project_id(p_path text)
returns uuid language sql immutable as $$
  select case
    when p_path ~ '^[0-9a-f-]{36}/' then
      substring(p_path from '^([0-9a-f-]{36})/')::uuid
    else null
  end;
$$;

revoke all on function public.path_project_id(text) from public;
grant execute on function public.path_project_id(text) to authenticated;

-- Read: user must be able to read the project the path belongs to.
create policy card_attachments_storage_select on storage.objects
  for select
  using (
    bucket_id = 'card-attachments'
    and public.current_can_read_project(public.path_project_id(name))
  );

-- Insert: same gate. Owner is set automatically by Storage to the auth user.
create policy card_attachments_storage_insert on storage.objects
  for insert
  with check (
    bucket_id = 'card-attachments'
    and public.current_can_read_project(public.path_project_id(name))
  );

-- Update: only the original uploader can update metadata (rare; mostly for retries).
create policy card_attachments_storage_update on storage.objects
  for update
  using (
    bucket_id = 'card-attachments'
    and owner = auth.uid()
  );

-- No delete policy: attachments are append-only. The card_attachments
-- row can be soft-removed by detaching from its event in a later slice,
-- but the storage object stays as audit evidence.

commit;
