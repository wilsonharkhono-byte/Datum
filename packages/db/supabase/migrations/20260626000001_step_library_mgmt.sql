-- Firm-standard step library management: open trade_steps firm-standard rows to
-- principal/admin editing via RLS + RPCs. Edits affect future seeding only.

-- 1. Audit columns (global edits worth attributing).
alter table public.trade_steps
  add column if not exists updated_by uuid references public.staff(id),
  add column if not exists updated_at timestamptz;

-- 2. RLS: managers may INSERT/UPDATE firm-standard rows. No DELETE (deactivate).
grant update on public.trade_steps to authenticated;  -- INSERT already granted (#22)

drop policy if exists trade_steps_standard_insert on public.trade_steps;
create policy trade_steps_standard_insert on public.trade_steps
  for insert to authenticated
  with check (project_id is null and source = 'standard' and public.current_can_manage_projects());

drop policy if exists trade_steps_standard_update on public.trade_steps;
create policy trade_steps_standard_update on public.trade_steps
  for update to authenticated
  using (project_id is null and source = 'standard' and public.current_can_manage_projects())
  with check (project_id is null and source = 'standard' and public.current_can_manage_projects());

-- 3. RPCs (SECURITY INVOKER → RLS enforces; each re-checks for a clean error).
create or replace function public.update_standard_step(
  p_code text, p_name text, p_step_type text, p_trade_role text,
  p_typical_duration_days int, p_lead_time_days int,
  p_applicability jsonb, p_applies_to_area_types text[]
) returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang mengubah pustaka langkah'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'nama wajib diisi'; end if;
  if p_step_type not in ('decision','procurement','site_work','inspection') then raise exception 'tipe langkah tidak valid: %', p_step_type; end if;
  if coalesce(p_typical_duration_days,0) < 0 or coalesce(p_lead_time_days,0) < 0 then raise exception 'durasi/lead time tidak boleh negatif'; end if;
  if p_applies_to_area_types is not null and exists (
    select 1 from unnest(p_applies_to_area_types) v
    where v not in ('bathroom','kitchen','bedroom','living','dining','garden','circulation','utility','general')
  ) then raise exception 'tipe ruangan tidak valid'; end if;
  update public.trade_steps set
    name = btrim(p_name), step_type = p_step_type, trade_role = p_trade_role,
    typical_duration_days = p_typical_duration_days, lead_time_days = p_lead_time_days,
    applicability = coalesce(p_applicability, '{}'::jsonb),
    applies_to_area_types = p_applies_to_area_types,
    updated_by = auth.uid(), updated_at = now()
  where code = p_code and project_id is null and source = 'standard';
  if not found then raise exception 'langkah standar tidak ditemukan: %', p_code; end if;
end; $$;

create or replace function public.set_standard_step_active(p_code text, p_active boolean)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang'; end if;
  update public.trade_steps set active = p_active, updated_by = auth.uid(), updated_at = now()
  where code = p_code and project_id is null and source = 'standard';
  if not found then raise exception 'langkah standar tidak ditemukan: %', p_code; end if;
end; $$;

create or replace function public.reorder_standard_steps(p_gate_code text, p_codes text[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang'; end if;
  update public.trade_steps t
    set sort_order = u.ord, updated_by = auth.uid(), updated_at = now()
  from unnest(p_codes) with ordinality as u(code, ord)
  where t.code = u.code and t.gate_code = p_gate_code and t.project_id is null and t.source = 'standard';
end; $$;

create or replace function public.add_standard_step(
  p_gate_code text, p_name text, p_step_type text, p_trade_role text,
  p_typical_duration_days int, p_lead_time_days int, p_applies_to_area_types text[]
) returns text language plpgsql security invoker set search_path = public as $$
declare v_code text; v_sort int;
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang'; end if;
  if not exists (select 1 from public.gates where code = p_gate_code) then raise exception 'gate tidak dikenal: %', p_gate_code; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'nama wajib diisi'; end if;
  if p_step_type not in ('decision','procurement','site_work','inspection') then raise exception 'tipe langkah tidak valid: %', p_step_type; end if;
  if coalesce(p_typical_duration_days,0) < 0 or coalesce(p_lead_time_days,0) < 0 then raise exception 'durasi/lead time tidak boleh negatif'; end if;
  if p_applies_to_area_types is not null and exists (
    select 1 from unnest(p_applies_to_area_types) v
    where v not in ('bathroom','kitchen','bedroom','living','dining','garden','circulation','utility','general')
  ) then raise exception 'tipe ruangan tidak valid'; end if;
  select coalesce(max(sort_order),0)+1 into v_sort from public.trade_steps
    where gate_code = p_gate_code and project_id is null and source = 'standard';
  v_code := 'std_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.trade_steps
    (code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days,
     sort_order, applicability, applies_to_area_types, active, project_id, source, created_by, updated_by, updated_at)
  values
    (v_code, p_gate_code, btrim(p_name), p_step_type, p_trade_role, coalesce(p_typical_duration_days,1), coalesce(p_lead_time_days,0),
     v_sort, '{}'::jsonb, p_applies_to_area_types, true, null, 'standard', auth.uid(), auth.uid(), now());
  return v_code;
end; $$;

-- 4. Grants (RLS + the in-RPC check do the gating).
revoke all on function public.update_standard_step(text,text,text,text,int,int,jsonb,text[]) from public;
grant execute on function public.update_standard_step(text,text,text,text,int,int,jsonb,text[]) to authenticated;
revoke all on function public.set_standard_step_active(text,boolean) from public;
grant execute on function public.set_standard_step_active(text,boolean) to authenticated;
revoke all on function public.reorder_standard_steps(text,text[]) from public;
grant execute on function public.reorder_standard_steps(text,text[]) to authenticated;
revoke all on function public.add_standard_step(text,text,text,text,int,int,text[]) from public;
grant execute on function public.add_standard_step(text,text,text,text,int,int,text[]) to authenticated;
