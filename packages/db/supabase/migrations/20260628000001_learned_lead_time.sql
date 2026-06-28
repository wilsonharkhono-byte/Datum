-- Lead-time learning: apply a learned median to a firm-standard step's lead_time_days.
alter table public.trade_steps
  add column if not exists updated_by uuid references public.staff(id),
  add column if not exists updated_at timestamptz;

create or replace function public.apply_learned_lead_time(p_code text, p_lead_time_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang mengubah pustaka'; end if;
  if coalesce(p_lead_time_days, -1) < 0 then raise exception 'lead time tidak boleh negatif'; end if;
  update public.trade_steps
    set lead_time_days = p_lead_time_days, updated_by = auth.uid(), updated_at = now()
    where code = p_code and project_id is null and source = 'standard';
  if not found then raise exception 'langkah standar tidak ditemukan: %', p_code; end if;
end; $$;
revoke all on function public.apply_learned_lead_time(text, int) from public;
grant execute on function public.apply_learned_lead_time(text, int) to authenticated;
