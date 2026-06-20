-- Gate B (Kamar Mandi) trade-step template — v1. Refine item_text with Wilson.

insert into public.trade_steps (code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days, sort_order, applicability) values
  ('B1','B','Pilih material dinding/lantai + shop drawing','decision','desainer',1,7,1,'{}'::jsonb),
  ('B2','B','Pilih sanitair & fixtures','decision','desainer',1,7,2,'{}'::jsonb),
  ('B3','B','Order marmer/batu','procurement','purchasing',1,21,3,'{"lantai":["marmer","batu"]}'::jsonb),
  ('B4','B','Waterproofing','site_work','aplikator_waterproofing',3,0,4,'{}'::jsonb),
  ('B5','B','Screeding + slope','site_work','tukang',2,0,5,'{}'::jsonb),
  ('B6','B','Pasang dinding marmer/batu','site_work','tukang_marmer',5,0,6,'{}'::jsonb),
  ('B7','B','Pasang lantai marmer/batu','site_work','tukang_marmer',3,0,7,'{}'::jsonb),
  ('B8','B','Grouting','site_work','tukang',1,0,8,'{}'::jsonb),
  ('B9','B','Verifikasi titik sanitair','inspection','site_manager',1,0,9,'{}'::jsonb);

insert into public.trade_step_deps (step_code, predecessor_code) values
  ('B3','B1'),
  ('B5','B4'),
  ('B6','B3'), ('B6','B4'),
  ('B7','B5'), ('B7','B3'),
  ('B8','B6'), ('B8','B7'),
  ('B9','B2');

insert into public.trade_step_checkpoints (step_code, item_text, default_severity, required, sort_order) values
  ('B1','Klien sign-off shop drawing dinding/lantai','mayor',true,1),
  ('B2','Spesifikasi sanitair & fixtures terkunci','mayor',true,1),
  ('B3','PO disetujui, tanggal kirim dikonfirmasi','mayor',true,1),
  ('B4','Flood test 24-48 jam: tidak ada rembesan','kritis',true,1),
  ('B5','Kemiringan lantai ke floor drain minimum 1%','mayor',true,1),
  ('B6','Lippage maksimal 1mm untuk marmer','mayor',true,1),
  ('B6','Pola sesuai shop drawing yang disetujui','mayor',true,2),
  ('B7','Slope terjaga; lippage maksimal 1mm','mayor',true,1),
  ('B8','Grouting rapi dan merata, tidak ada void','minor',true,1),
  ('B9','Outlet air dan drain presisi ke posisi sanitair terpilih','mayor',true,1);
