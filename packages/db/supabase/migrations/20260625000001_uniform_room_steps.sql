-- Uniform phase-based readiness for all rooms.
-- Reframes Gate B from "Pekerjaan Kamar Mandi" (a room) into the
-- "Pekerjaan Basah / Waterproofing" PHASE, so gates A–H are uniform construction
-- phases and every room (incl. the bathroom) flows through the same phases.
-- Adds room-type scoping to the firm-standard step library, seeds the reconciled
-- A–H library (~84 steps), generalizes seeding beyond bathroom/Gate-B, and
-- backfills existing areas. The readiness rule engine is unchanged (generic).

-- ─── 1. Room-type scoping on the firm-standard library ────────────────────────
alter table public.trade_steps
  add column if not exists applies_to_area_types text[];  -- NULL = all room types

-- ─── 2. Reframe Gate B (name only; gate_code 'B' and the rule engine unchanged) ─
update public.gates set name = 'Pekerjaan Basah / Waterproofing' where code = 'B';

-- ─── 3. Retire the old bundled bathroom steps ─────────────────────────────────
-- Their content is redistributed below into wet-works (BW*) / D (tiling) / G
-- (sanitair). Deactivate the templates (don't delete — FKs may reference them)…
update public.trade_steps set active = false
  where project_id is null
    and code in ('B1','B2','B3','B4','B5','B6','B7','B8','B9','B10','B11');

-- …and remove the now-orphaned per-area instances of those retired steps so they
-- stop rendering (only the pilot bathroom has these; minimal not_started data —
-- the work is re-tracked under the redistributed gates after the backfill).
delete from public.area_steps
  where step_code in ('B1','B2','B3','B4','B5','B6','B7','B8','B9','B10','B11');

-- ─── 4. Seed the reconciled A–H step library (spec Appendix A) ─────────────────
insert into public.trade_steps
  (code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days, sort_order, applicability, applies_to_area_types, active, project_id, source)
values
  -- Gate A — MEP Rough-in + Persiapan Struktural
  ('A1','A','Koordinasi MEP & sign-off shop drawing','decision','desainer',3,5,1,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('A2','A','Booking tim MEP & order material rough-in','procurement','purchasing',1,10,2,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('A3','A','Chasing dinding & persiapan jalur','site_work','tukang_sipil',4,0,3,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('A4','A','Rough-in conduit & wiring listrik','site_work','mep',6,0,4,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('A5','A','Rough-in plumbing (supply & drain)','site_work','mep',6,0,5,'{}'::jsonb,'{bathroom,kitchen,general,garden}',true,null,'standard'),
  ('A6','A','Rough-in pipa refrigerant & drain AC','site_work','mep',4,0,6,'{}'::jsonb,'{living,kitchen,bedroom,general}',true,null,'standard'),
  ('A7','A','Pressure test pipa air bersih','inspection','site_manager',2,0,7,'{}'::jsonb,'{bathroom,kitchen,general,garden}',true,null,'standard'),
  ('A8','A','Foto dokumentasi MEP sebelum ditutup','inspection','site_manager',1,0,8,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('A9','A','Persiapan substrat & screed dasar','site_work','tukang_sipil',5,0,9,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('A11','A','Inspeksi kesiapan struktural sebelum finishing','inspection','site_manager',2,0,10,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  -- Gate B — Pekerjaan Basah / Waterproofing (wet rooms)
  ('BW1','B','Booking aplikator waterproofing','procurement','aplikator_wp',1,7,1,'{}'::jsonb,'{bathroom,kitchen,general}',true,null,'standard'),
  ('BW2','B','Aplikasi waterproofing membrane (lapis kedap)','site_work','aplikator_wp',3,0,2,'{}'::jsonb,'{bathroom,kitchen,general}',true,null,'standard'),
  ('BW3','B','Flood test / uji genang 24 jam','inspection','site_manager',2,0,3,'{}'::jsonb,'{bathroom,kitchen,general}',true,null,'standard'),
  ('BW4','B','Screeding + slope ke floor drain','site_work','tukang_sipil',2,0,4,'{}'::jsonb,'{bathroom,kitchen,general}',true,null,'standard'),
  -- Gate C — Plafon & Penutupan Selubung
  ('C1','C','Pilih sistem plafon + RCP & shop drawing','decision','desainer',2,0,1,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('C2','C','Koordinasi titik MEP di plafon','decision','mep',2,0,2,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('C3','C','Order rangka & papan plafon','procurement','purchasing',1,7,3,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('C4','C','Fabrikasi plafon kayu/panel khusus','procurement','purchasing',2,21,4,'{}'::jsonb,'{living,bedroom,general}',true,null,'standard'),
  ('C5','C','Pasang rangka plafon + leveling','site_work','tukang_plafon',4,0,5,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('C6','C','Pasang papan plafon + drop/cove','site_work','tukang_plafon',5,0,6,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('C7','C','Buka cut-out downlight/AC/speaker/exhaust','site_work','tukang_plafon',2,0,7,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('C8','C','Pasang plafon kayu/panel khusus','site_work','tukang_finishing',4,0,8,'{}'::jsonb,'{living,bedroom,general}',true,null,'standard'),
  ('C9','C','Compound + amplas joint plafon','site_work','tukang_plafon',3,0,9,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('C10','C','Penutupan selubung/soffit & bulkhead AC','site_work','tukang_plafon',2,0,10,'{}'::jsonb,'{living,kitchen,bedroom,general}',true,null,'standard'),
  ('C11','C','Verifikasi level plafon + cut-out','inspection','mandor',1,0,11,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  -- Gate D — Finishing Lantai, Dinding & Kusen (bathroom = tiling)
  ('D1','D','Pilih material lantai + dinding','decision','desainer',2,7,1,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('D2','D','Pilih kusen aluminium + kaca','decision','desainer',1,7,2,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('D3','D','Order material lantai/dinding','procurement','purchasing',1,14,3,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('D4','D','Fabrikasi + order kusen aluminium','procurement','purchasing',1,21,4,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('D5','D','Screeding + leveling substrat','site_work','tukang_sipil',4,0,5,'{}'::jsonb,'{living,kitchen,bedroom,general}',true,null,'standard'),
  ('D6','D','Pasang lantai (keramik/marmer/vinyl/parket)','site_work','tukang_lantai',6,0,6,'{"lantai":["marmer","batu","keramik","vinyl","parket"]}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('D7','D','Pasang dinding finish (tiling / aci-cat / panel)','site_work','tukang_finishing',4,0,7,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('D8','D','Pasang kusen aluminium + kaca','site_work','tukang_aluminium',3,0,8,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('D9','D','Grouting + sealant','site_work','tukang_lantai',2,0,9,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('D10','D','Verifikasi level lantai + threshold','inspection','mandor',1,0,10,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  -- Gate E — Finishing Permukaan + Ironwork (bathroom mostly skips — tiled)
  ('E1','E','Pilih warna & sistem cat/wallpaper','decision','desainer',1,5,1,'{}'::jsonb,'{living,kitchen,bedroom,general}',true,null,'standard'),
  ('E2','E','Tentukan finishing khusus (duco/tekstur)','decision','desainer',1,5,2,'{}'::jsonb,'{living,kitchen,bedroom}',true,null,'standard'),
  ('E3','E','Desain ironwork + shop drawing','decision','desainer',2,7,3,'{}'::jsonb,'{living,bedroom,general,garden}',true,null,'standard'),
  ('E4','E','Order material cat/wallpaper/coating','procurement','purchasing',1,10,4,'{}'::jsonb,'{living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('E5','E','Fabrikasi & order ironwork','procurement','purchasing',1,21,5,'{}'::jsonb,'{living,bedroom,general,garden}',true,null,'standard'),
  ('E6','E','Booking aplikator finishing khusus (duco)','procurement','aplikator_duco',1,10,6,'{}'::jsonb,'{living,kitchen,bedroom}',true,null,'standard'),
  ('E7','E','Proteksi material terpasang (masking)','site_work','tukang_cat',2,0,7,'{}'::jsonb,'{living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('E8','E','Dempul, amplas & primer dinding','site_work','tukang_cat',4,0,8,'{}'::jsonb,'{living,kitchen,bedroom,general}',true,null,'standard'),
  ('E9','E','Cat dasar + cat finish (multi-coat)','site_work','tukang_cat',5,0,9,'{}'::jsonb,'{living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('E10','E','Aplikasi finishing khusus (duco/tekstur)','site_work','aplikator_duco',6,0,10,'{}'::jsonb,'{living,kitchen,bedroom}',true,null,'standard'),
  ('E11','E','Pasang ironwork','site_work','tukang_besi',3,0,11,'{}'::jsonb,'{living,bedroom,general,garden}',true,null,'standard'),
  ('E12','E','Verifikasi coverage cat & ironwork','inspection','site_manager',2,0,12,'{}'::jsonb,'{living,kitchen,bedroom,general,garden}',true,null,'standard'),
  -- Gate F — Furniture Built-in & Interior (bathroom = vanity)
  ('F1','F','Pilih desain furniture built-in + shop drawing','decision','desainer',2,7,1,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('F2','F','Pilih finishing + countertop + hardware','decision','desainer',1,7,2,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('F3','F','Approval klien atas desain + sample','decision','desainer',3,0,3,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('F4','F','Order countertop (solid surface/quartz/marmer)','procurement','purchasing',1,21,4,'{}'::jsonb,'{bathroom,kitchen,general}',true,null,'standard'),
  ('F5','F','Order hardware (soft-close, rel, engsel)','procurement','purchasing',1,14,5,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('F6','F','Fabrikasi carcass & pintu (workshop)','procurement','vendor_furniture',1,28,6,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('F7','F','Verifikasi ukuran lapangan (pre-final fab)','inspection','site_manager',1,0,7,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('F8','F','Pasang carcass & rangka built-in','site_work','tukang_furniture',5,0,8,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('F9','F','Pasang countertop + sambungan','site_work','tukang_furniture',2,0,9,'{}'::jsonb,'{bathroom,kitchen,general}',true,null,'standard'),
  ('F10','F','Pasang pintu, laci, hardware & finishing','site_work','tukang_furniture',4,0,10,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('F11','F','Verifikasi alignment, gap & smooth operation','inspection','site_manager',1,0,11,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  -- Gate G — MEP Fit-out (+ bathroom lighting/exhaust + sanitair)
  ('G1','G','Finalisasi titik lampu & layout pencahayaan','decision','desainer',1,7,1,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('G2','G','Pilih saklar, stop kontak & smart-home device','decision','desainer',1,7,2,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('G3','G','Pilih unit AC & kapasitas per ruang','decision','mep',1,7,3,'{}'::jsonb,'{living,kitchen,bedroom,general}',true,null,'standard'),
  ('G4','G','Pilih sanitair & fixtures kamar mandi','decision','desainer',1,7,4,'{}'::jsonb,'{bathroom}',true,null,'standard'),
  ('G5','G','Order lampu & fixtures dekoratif','procurement','purchasing',1,21,5,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('G6','G','Order saklar, stop kontak & smart-home device','procurement','purchasing',1,14,6,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('G7','G','Order unit AC','procurement','purchasing',1,14,7,'{}'::jsonb,'{living,kitchen,bedroom,general}',true,null,'standard'),
  ('G8','G','Order sanitair & fixtures','procurement','purchasing',1,14,8,'{}'::jsonb,'{bathroom}',true,null,'standard'),
  ('G9','G','Pasang fixture lampu & energize titik','site_work','mep',3,0,9,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('G10','G','Pasang plate saklar, stop kontak & panel','site_work','mep',2,0,10,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('G11','G','Pasang indoor unit AC + drain & refrigerant','site_work','mep',3,0,11,'{}'::jsonb,'{living,kitchen,bedroom,general}',true,null,'standard'),
  ('G12','G','Pasang sanitair & fixtures kamar mandi','site_work','tukang_sanitair',3,0,12,'{}'::jsonb,'{bathroom}',true,null,'standard'),
  ('G13','G','Testing & commissioning sirkuit, AC & smart-home','site_work','mep',2,0,13,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('G14','G','Verifikasi titik sanitair & tes fungsi (no leak)','inspection','site_manager',1,0,14,'{}'::jsonb,'{bathroom}',true,null,'standard'),
  ('G15','G','Verifikasi semua titik energize & berfungsi','inspection','site_manager',1,0,15,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  -- Gate H — Penyelesaian Akhir & Serah Terima
  ('H1','H','Walkthrough snagging & buat punch list','inspection','site_manager',2,0,1,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('H2','H','Perbaikan defect & touch-up finishing','site_work','mandor',5,0,2,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('H3','H','Poles marmer & batu alam','site_work','tukang_marmer',4,0,3,'{"lantai":["marmer","batu"]}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard'),
  ('H4','H','Re-test fungsional MEP, AC, sanitair & fixtures','inspection','mep',2,0,4,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('H5','H','Lepas proteksi & kemasan pelindung','site_work','cleaning_crew',1,0,5,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('H6','H','Deep cleaning akhir','site_work','cleaning_crew',3,0,6,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('H7','H','Inspeksi internal pre-handover (QC final)','inspection','site_manager',1,0,7,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('H8','H','Foto dokumentasi as-built hasil akhir','inspection','site_manager',1,0,8,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('H9','H','Walkthrough klien & sign-off serah terima','inspection','site_manager',2,0,9,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('H10','H','Perbaikan snag list klien','site_work','mandor',3,0,10,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('H11','H','Serahkan dokumen handover (as-built/manual/garansi)','inspection','site_manager',2,0,11,'{}'::jsonb,'{general}',true,null,'standard')
on conflict (code) do nothing;

-- Ensure dining / circulation / utility rooms get a usable checklist: give them
-- the same coverage as a 'general' room (over-inclusive steps are prunable per-area).
update public.trade_steps
  set applies_to_area_types = applies_to_area_types || array['dining','circulation','utility']::text[]
  where project_id is null and source = 'standard'
    and 'general' = any(applies_to_area_types)
    and not ('dining' = any(applies_to_area_types));

-- ─── 5. Dependencies (within-gate predecessors) ───────────────────────────────
insert into public.trade_step_deps (step_code, predecessor_code) values
  -- A
  ('A2','A1'),('A3','A1'),('A4','A2'),('A4','A3'),('A5','A2'),('A5','A3'),('A6','A2'),('A6','A3'),('A7','A5'),('A8','A4'),('A8','A5'),('A8','A6'),('A8','A7'),('A9','A8'),('A11','A9'),
  -- B (wet-works)
  ('BW2','BW1'),('BW3','BW2'),('BW4','BW3'),
  -- C
  ('C2','C1'),('C3','C1'),('C4','C1'),('C5','C2'),('C5','C3'),('C6','C5'),('C7','C6'),('C8','C4'),('C8','C7'),('C9','C7'),('C10','C5'),('C11','C9'),('C11','C10'),
  -- D
  ('D3','D1'),('D4','D2'),('D6','D3'),('D6','D5'),('D7','D3'),('D8','D4'),('D8','D5'),('D9','D6'),('D9','D7'),('D10','D6'),('D10','D8'),('D10','D9'),
  -- E
  ('E2','E1'),('E4','E1'),('E5','E3'),('E6','E2'),('E8','E4'),('E8','E7'),('E9','E8'),('E10','E6'),('E10','E8'),('E11','E5'),('E11','E9'),('E12','E9'),('E12','E10'),('E12','E11'),
  -- F
  ('F2','F1'),('F3','F1'),('F3','F2'),('F4','F3'),('F5','F3'),('F6','F3'),('F7','F6'),('F8','F6'),('F8','F7'),('F9','F4'),('F9','F8'),('F10','F5'),('F10','F8'),('F11','F9'),('F11','F10'),
  -- G
  ('G5','G1'),('G6','G2'),('G7','G3'),('G8','G4'),('G9','G5'),('G10','G6'),('G11','G7'),('G12','G8'),('G13','G9'),('G13','G10'),('G13','G11'),('G14','G12'),('G15','G13'),
  -- H
  ('H2','H1'),('H3','H1'),('H4','H2'),('H5','H2'),('H6','H3'),('H6','H4'),('H6','H5'),('H7','H6'),('H8','H6'),('H9','H7'),('H10','H9'),('H11','H9')
on conflict do nothing;

-- ─── 6. Generalize seed_area_steps beyond bathroom/Gate-B ──────────────────────
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

-- ─── 7. Generalize add_catalog_area_step (room-type applicability, any gate) ────
create or replace function public.add_catalog_area_step(p_area_id uuid, p_step_code text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_project_id uuid; v_area_type text; v_step_id uuid;
begin
  select project_id, area_type::text into v_project_id, v_area_type
    from public.areas where id = p_area_id;
  if v_project_id is null then raise exception 'area not found'; end if;

  if not exists (
    select 1 from public.trade_steps
    where code = p_step_code and project_id is null and active
      and (applies_to_area_types is null or v_area_type = any(applies_to_area_types))
  ) then
    raise exception 'not an applicable standard step: %', p_step_code;
  end if;

  insert into public.area_steps (area_id, project_id, step_code)
  values (p_area_id, v_project_id, p_step_code)
  on conflict (area_id, step_code) do nothing
  returning id into v_step_id;

  if v_step_id is not null then
    insert into public.area_step_checkpoints
      (area_step_id, project_id, item_text, severity, required, sort_order)
    select v_step_id, v_project_id, t.item_text, t.default_severity, t.required, t.sort_order
    from public.trade_step_checkpoints t where t.step_code = p_step_code;
  end if;
  return v_step_id;
end;
$$;
revoke all on function public.add_catalog_area_step(uuid, text) from public;
grant execute on function public.add_catalog_area_step(uuid, text) to authenticated;

-- ─── 8. Generalize add_custom_area_step: custom steps pick their phase (gate) ───
drop function if exists public.add_custom_area_step(uuid, text, text);
create or replace function public.add_custom_area_step(p_area_id uuid, p_name text, p_step_type text, p_gate_code text default 'H')
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_project_id uuid; v_code text; v_step_id uuid;
begin
  select project_id into v_project_id from public.areas where id = p_area_id;
  if v_project_id is null then raise exception 'area not found'; end if;
  if not exists (select 1 from public.gates where code = p_gate_code) then
    raise exception 'unknown gate: %', p_gate_code;
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  if p_step_type not in ('decision','procurement','site_work','inspection') then
    raise exception 'invalid step_type: %', p_step_type;
  end if;
  v_code := 'cst_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.trade_steps
    (code, gate_code, name, step_type, source, project_id, created_by, sort_order, applicability, active)
  values
    (v_code, p_gate_code, btrim(p_name), p_step_type, 'custom', v_project_id, auth.uid(), 900, '{}'::jsonb, true);
  insert into public.area_steps (area_id, project_id, step_code)
  values (p_area_id, v_project_id, v_code) returning id into v_step_id;
  return v_step_id;
end;
$$;
revoke all on function public.add_custom_area_step(uuid, text, text, text) from public;
grant execute on function public.add_custom_area_step(uuid, text, text, text) to authenticated;

-- ─── 9. Backfill: re-seed every existing area against the reconciled library ────
do $$ declare a record; begin
  for a in select id from public.areas loop
    perform public.seed_area_steps(a.id);
  end loop;
end $$;
