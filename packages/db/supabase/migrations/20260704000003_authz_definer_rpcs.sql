-- 20260704000003_authz_definer_rpcs.sql
-- SECURITY FIX (AUDIT_SECURITY.md Finding 3).
--
-- Four SECURITY DEFINER functions were `grant execute … to authenticated` with
-- NO internal membership check, so any authenticated user could call them via
-- POST /rest/v1/rpc/<fn> with a FOREIGN project/area id and trigger writes that
-- bypass RLS (the DEFINER runs as the function owner):
--
--   * compute_project_schedule(uuid)   — overwrites another project's gate dates
--   * seed_area_steps(uuid)            — injects area_steps into another project
--   * seed_default_topics(uuid)        — injects topics into another project
--   * mark_areas_stale_for_card(uuid)  — flips staleness on another project
--
-- Two of them (compute_project_schedule, seed_area_steps) ARE called directly by
-- the app via the session client, so they keep EXECUTE but gain an explicit
-- current_can_read_project guard (matching the resolve_card_event pattern).
-- Service-role / DEFINER-trigger contexts have no JWT (auth.uid() is null) and
-- are trusted, so the guard is skipped for them.
--
-- The other two (seed_default_topics, mark_areas_stale_for_card) are NOT called
-- directly anywhere in the app — they are only invoked by SECURITY DEFINER
-- triggers, which run the nested call with the trigger owner's privileges and
-- therefore do NOT need the invoking user to hold EXECUTE. So we simply revoke
-- their EXECUTE from client roles, removing the direct-call attack surface with
-- zero impact on the trigger paths.

begin;

-- ── compute_project_schedule: add authz guard, body otherwise unchanged ───────
create or replace function public.compute_project_schedule(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kickoff date;
  g record;
  a record;
  v_start date;
  v_end date;
begin
  -- AUTHZ (F3): a JWT-bearing caller must be able to read this project.
  -- Trigger / service-role contexts (no auth.uid()) are trusted.
  if auth.uid() is not null and not public.current_can_read_project(p_project_id) then
    raise exception 'not authorized for project %', p_project_id using errcode = '42501';
  end if;

  select kickoff_date into v_kickoff from public.projects where id = p_project_id;
  if v_kickoff is null then
    return;  -- no kickoff → no projection possible
  end if;

  for g in select code, active_weeks from public.gates where active_weeks is not null order by sort_order loop
    -- int4range lower/upper: [start_week, end_week)
    -- Defensive: skip rows where active_weeks is empty or unbounded
    if lower(g.active_weeks) is null or upper(g.active_weeks) is null then
      continue;
    end if;
    v_start := v_kickoff + (lower(g.active_weeks) - 1) * 7;
    v_end   := v_kickoff + (upper(g.active_weeks) - 1) * 7;
    for a in select id from public.areas where project_id = p_project_id loop
      insert into public.area_gate_status (
        project_id, area_id, gate_code, status,
        target_start_date, target_end_date
      ) values (
        p_project_id, a.id, g.code, 'not_started',
        v_start, v_end
      )
      on conflict (project_id, area_id, gate_code) do update set
        target_start_date = excluded.target_start_date,
        target_end_date   = excluded.target_end_date,
        updated_at        = now();
    end loop;
  end loop;
end;
$$;

-- ── seed_area_steps: add authz guard, body otherwise unchanged ────────────────
create or replace function public.seed_area_steps(p_area_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid; v_area_type text; v_finish jsonb;
  v_step record; v_new_id uuid; v_ok boolean; v_key text; v_allowed jsonb; v_value text;
begin
  select project_id, area_type::text, finish_profile
    into v_project_id, v_area_type, v_finish
    from public.areas where id = p_area_id;
  if v_project_id is null then return; end if;

  -- AUTHZ (F3): a JWT-bearing caller must be able to read this area's project.
  -- Trigger / service-role contexts (no auth.uid()) are trusted.
  if auth.uid() is not null and not public.current_can_read_project(v_project_id) then
    raise exception 'not authorized for area %', p_area_id using errcode = '42501';
  end if;

  for v_step in
    select * from public.trade_steps
    where active and project_id is null
      and (applies_to_area_types is null or v_area_type = any(applies_to_area_types))
    order by gate_code, sort_order
  loop
    v_ok := true;
    for v_key, v_allowed in select * from jsonb_each(v_step.applicability)
    loop
      v_value := v_finish ->> v_key;
      if v_value is null or not (v_allowed ? v_value) then v_ok := false; end if;
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
      from public.trade_step_checkpoints t where t.step_code = v_step.code;
    end if;
  end loop;
end;
$$;

-- ── Trigger-only functions: remove the direct-call surface ────────────────────
-- These are invoked exclusively by SECURITY DEFINER triggers (which call them
-- as the trigger owner, not the end-user), so client roles never need EXECUTE.
revoke all on function public.seed_default_topics(uuid)        from public;
revoke all on function public.seed_default_topics(uuid)        from anon;
revoke all on function public.seed_default_topics(uuid)        from authenticated;

revoke all on function public.mark_areas_stale_for_card(uuid)  from public;
revoke all on function public.mark_areas_stale_for_card(uuid)  from anon;
revoke all on function public.mark_areas_stale_for_card(uuid)  from authenticated;

commit;
