-- 20260615000004_developments_and_project_covers.sql
-- Landing redesign: user-editable project grouping ("developments") + project
-- cover images.
--   * developments: curated groups (Citraland, Bukit Darmo Golf, ...). Source of
--     truth for landing grouping and the search "tier"; seeded once, edited in-app.
--   * projects.development_id: nullable FK; on delete set null keeps projects.
--   * projects.cover_image_path: path within the public 'project-covers' bucket.

begin;

create table public.developments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  area_label  text,
  sort_order  int  not null default 100,
  created_at  timestamptz not null default now()
);

create unique index developments_name_lower_idx on public.developments (lower(name));

alter table public.developments enable row level security;

create policy developments_select on public.developments
  for select using (true);

create policy developments_insert on public.developments
  for insert with check (public.current_can_manage_projects());

create policy developments_update on public.developments
  for update using (public.current_can_manage_projects())
  with check  (public.current_can_manage_projects());

create policy developments_delete on public.developments
  for delete using (public.current_can_manage_projects());

alter table public.projects
  add column development_id   uuid references public.developments(id) on delete set null,
  add column cover_image_path text;

create index projects_development_id_idx on public.projects (development_id);

-- Public bucket: covers are non-confidential renders; public URLs avoid 66
-- signed-URL round-trips on the landing page. Paths are '<project_id>/<uuid>-<name>'.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-covers',
  'project-covers',
  true,
  10485760,  -- 10 MB per file
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reads are public (served via /object/public/...). Writes are principal/admin only.
create policy project_covers_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-covers' and public.current_can_manage_projects());

create policy project_covers_update on storage.objects
  for update to authenticated
  using (bucket_id = 'project-covers' and public.current_can_manage_projects())
  with check (bucket_id = 'project-covers' and public.current_can_manage_projects());

create policy project_covers_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-covers' and public.current_can_manage_projects());

commit;
