-- Per-bathroom step editing: add/remove work steps.
-- Custom steps = project-scoped trade_steps rows; removal = reversible soft-delete.

-- 1. trade_steps scoping. NULL project_id = firm standard; set = project-scoped custom.
alter table public.trade_steps
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists source     text not null default 'standard' check (source in ('standard','custom')),
  add column if not exists created_by uuid references public.staff(id),
  add column if not exists created_at timestamptz not null default now();

-- 2. area_steps reversible soft-remove.
alter table public.area_steps
  add column if not exists removed_at timestamptz;

-- 3. Seeding stays pristine: only firm-standard steps auto-seed (project_id is null).
create or replace function public.seed_area_steps(p_area_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_area_type  text;
  v_finish     jsonb;
  v_step       record;
  v_new_id     uuid;
  v_ok         boolean;
  v_key        text;
  v_allowed    jsonb;
  v_value      text;
begin
  select project_id, area_type::text, finish_profile
    into v_project_id, v_area_type, v_finish
    from public.areas where id = p_area_id;
  if v_project_id is null then return; end if;
  if v_area_type <> 'bathroom' then return; end if;

  for v_step in
    select * from public.trade_steps
    where gate_code = 'B' and active and project_id is null   -- firm-standard only
    order by sort_order
  loop
    v_ok := true;
    for v_key, v_allowed in select * from jsonb_each(v_step.applicability)
    loop
      v_value := coalesce(v_finish ->> v_key, null);
      if v_value is null or not (v_allowed ? v_value) then
        v_ok := false;
      end if;
    end loop;
    if not v_ok then continue; end if;

    insert into public.area_steps (area_id, project_id, step_code)
    values (p_area_id, v_project_id, v_step.code)
    on conflict (area_id, step_code) do nothing
    returning id into v_new_id;

    if v_new_id is not null then
      insert into public.area_step_checkpoints
        (area_step_id, project_id, item_text, severity, required, sort_order)
      select v_new_id, v_project_id, t.item_text, t.default_severity, t.required, t.sort_order
      from public.trade_step_checkpoints t
      where t.step_code = v_step.code;
    end if;
  end loop;
end;
$$;

-- 4. RLS: everyone reads firm standards; custom rows only to their project's members.
drop policy if exists trade_steps_read on public.trade_steps;
create policy trade_steps_read on public.trade_steps
  for select to authenticated
  using (project_id is null or public.current_can_read_project(project_id));

-- project members CRUD their own project's CUSTOM steps; never firm-standard rows.
drop policy if exists trade_steps_custom_write on public.trade_steps;
create policy trade_steps_custom_write on public.trade_steps
  for all to authenticated
  using  (project_id is not null and public.current_can_read_project(project_id))
  with check (project_id is not null and source = 'custom' and public.current_can_read_project(project_id));

-- Table-level INSERT grant so the SECURITY INVOKER RPC can insert custom rows.
-- RLS (above) still confines writes to project-scoped custom rows; firm-standard
-- rows (project_id is null) are unmatched by USING, so they remain protected.
grant insert on public.trade_steps to authenticated;

-- 5a. Add a firm-standard Gate B step (one-step seed). INVOKER so RLS enforces membership.
create or replace function public.add_catalog_area_step(p_area_id uuid, p_step_code text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_step_id    uuid;
begin
  select project_id into v_project_id from public.areas where id = p_area_id;
  if v_project_id is null then raise exception 'area not found'; end if;

  if not exists (
    select 1 from public.trade_steps
    where code = p_step_code and project_id is null and gate_code = 'B'
  ) then
    raise exception 'not a standard Gate B step: %', p_step_code;
  end if;

  insert into public.area_steps (area_id, project_id, step_code)
  values (p_area_id, v_project_id, p_step_code)
  on conflict (area_id, step_code) do nothing
  returning id into v_step_id;

  if v_step_id is not null then
    insert into public.area_step_checkpoints
      (area_step_id, project_id, item_text, severity, required, sort_order)
    select v_step_id, v_project_id, t.item_text, t.default_severity, t.required, t.sort_order
    from public.trade_step_checkpoints t
    where t.step_code = p_step_code;
  end if;

  return v_step_id;
end;
$$;
revoke all on function public.add_catalog_area_step(uuid, text) from public;
grant execute on function public.add_catalog_area_step(uuid, text) to authenticated;

-- 5b. Add a custom step (atomic: trade_steps row + area_step). INVOKER so RLS enforces.
create or replace function public.add_custom_area_step(p_area_id uuid, p_name text, p_step_type text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_code       text;
  v_step_id    uuid;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  if p_step_type not in ('decision','procurement','site_work','inspection') then
    raise exception 'invalid step_type: %', p_step_type;
  end if;

  select project_id into v_project_id from public.areas where id = p_area_id;
  if v_project_id is null then raise exception 'area not found'; end if;

  v_code := 'cst_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.trade_steps
    (code, gate_code, name, step_type, source, project_id, created_by, sort_order, applicability, active)
  values
    (v_code, 'B', btrim(p_name), p_step_type, 'custom', v_project_id, auth.uid(), 900, '{}'::jsonb, true);

  insert into public.area_steps (area_id, project_id, step_code)
  values (p_area_id, v_project_id, v_code)
  returning id into v_step_id;

  return v_step_id;
end;
$$;
revoke all on function public.add_custom_area_step(uuid, text, text) from public;
grant execute on function public.add_custom_area_step(uuid, text, text) to authenticated;
