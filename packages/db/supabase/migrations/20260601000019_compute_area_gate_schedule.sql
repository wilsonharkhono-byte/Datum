-- 20260601000019_compute_area_gate_schedule.sql
-- Slice 1.9-schedule: project gate active_weeks ranges onto real calendar dates
-- per (area, gate). Run on demand from the app; auto-backfill existing projects.

begin;

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

revoke all on function public.compute_project_schedule(uuid) from public;
grant execute on function public.compute_project_schedule(uuid) to authenticated;

-- Trigger: when projects.kickoff_date changes, recompute the schedule.
create or replace function public.projects_recompute_schedule_on_kickoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.kickoff_date is not null then
    perform public.compute_project_schedule(new.id);
  elsif tg_op = 'UPDATE' and (new.kickoff_date is distinct from old.kickoff_date) and new.kickoff_date is not null then
    perform public.compute_project_schedule(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists projects_recompute_schedule on public.projects;
create trigger projects_recompute_schedule
  after insert or update of kickoff_date on public.projects
  for each row execute function public.projects_recompute_schedule_on_kickoff();

-- Backfill existing projects (Wilson's pilot projects already have kickoff_date)
do $$
declare p record;
begin
  for p in select id from public.projects where kickoff_date is not null loop
    perform public.compute_project_schedule(p.id);
  end loop;
end $$;

commit;
