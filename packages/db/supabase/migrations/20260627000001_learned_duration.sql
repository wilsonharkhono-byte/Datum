-- Learning loop: apply a learned median duration to a firm-standard step.
-- Decoupled from Piece B (SECURITY DEFINER + internal manage-check; idempotent audit cols).

alter table public.trade_steps
  add column if not exists updated_by uuid references public.staff(id),
  add column if not exists updated_at timestamptz;

create or replace function public.apply_learned_duration(p_code text, p_typical_duration_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang mengubah pustaka'; end if;
  if coalesce(p_typical_duration_days, 0) < 1 then raise exception 'durasi minimal 1 hari'; end if;
  update public.trade_steps
    set typical_duration_days = p_typical_duration_days, updated_by = auth.uid(), updated_at = now()
    where code = p_code and project_id is null and source = 'standard';
  if not found then raise exception 'langkah standar tidak ditemukan: %', p_code; end if;
end; $$;

revoke all on function public.apply_learned_duration(text, int) from public;
grant execute on function public.apply_learned_duration(text, int) to authenticated;
