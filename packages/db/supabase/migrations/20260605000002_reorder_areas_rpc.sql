-- 20260605000002_reorder_areas_rpc.sql
-- Atomic area reordering. The previous server action looped N sequential
-- UPDATEs and on mid-loop failure left the table in an inconsistent state
-- (some rows renumbered, some not). Move the renumber into a single SQL
-- function that runs in one transaction.

begin;

create or replace function public.reorder_project_areas(
  p_project_id uuid,
  p_area_ids   uuid[]
)
returns void
language plpgsql
security invoker  -- run under caller RLS; areas_update policy gates this
set search_path = public
as $$
declare
  v_existing_count int;
  v_input_count    int := coalesce(array_length(p_area_ids, 1), 0);
begin
  if v_input_count = 0 then
    return;
  end if;

  -- Verify every supplied id actually belongs to the project. Stops a caller
  -- from sneaking a foreign area_id into the reorder set.
  select count(*) into v_existing_count
  from public.areas
  where id = any(p_area_ids)
    and project_id = p_project_id;

  if v_existing_count <> v_input_count then
    raise exception 'reorder set contains areas outside project %', p_project_id
      using errcode = '22023';
  end if;

  -- One UPDATE statement renumbers everything in lockstep, inside the
  -- implicit function transaction.
  update public.areas a
     set sort_order = idx.ord
    from (
      select unnest(p_area_ids) as id,
             generate_series(0, v_input_count - 1) as ord
    ) idx
   where a.id = idx.id
     and a.project_id = p_project_id;
end;
$$;

revoke all on function public.reorder_project_areas(uuid, uuid[]) from public;
grant execute on function public.reorder_project_areas(uuid, uuid[]) to authenticated;

commit;
