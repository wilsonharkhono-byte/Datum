-- Instantiate Gate B steps for a bathroom area. Idempotent: skips steps that
-- already exist for the area. Applicability: every key in trade_steps.applicability
-- must have the area's profile value (area_type + finish_profile) in its allowed set.
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

  -- Only bathrooms get the Gate B step set in this pilot.
  if v_area_type <> 'bathroom' then return; end if;

  for v_step in
    select * from public.trade_steps where gate_code = 'B' and active order by sort_order
  loop
    -- Evaluate applicability (AND across keys; value must be in allowed array).
    v_ok := true;
    for v_key, v_allowed in select * from jsonb_each(v_step.applicability)
    loop
      v_value := coalesce(v_finish ->> v_key, null);
      if v_value is null or not (v_allowed ? v_value) then
        v_ok := false;
      end if;
    end loop;
    if not v_ok then continue; end if;

    -- Idempotent insert of the area_step.
    insert into public.area_steps (area_id, project_id, step_code)
    values (p_area_id, v_project_id, v_step.code)
    on conflict (area_id, step_code) do nothing
    returning id into v_new_id;

    -- Copy checkpoint templates only when we actually created the step.
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

revoke all on function public.seed_area_steps(uuid) from public;
grant execute on function public.seed_area_steps(uuid) to authenticated;
