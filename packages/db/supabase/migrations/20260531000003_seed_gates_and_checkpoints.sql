-- DATUM Slice 0 — seed configuration: 8 finishing gates + Lampiran A checkpoints

------------------------------------------------------------------------
-- Gates (per SAN Finishing Guide §Bab 2)
------------------------------------------------------------------------
insert into public.gates (code, name, description, sort_order, active_weeks) values
  ('A', 'MEP Rough-in + Persiapan Struktural',
       'Penarikan seluruh sistem MEP dan persiapan struktural untuk menerima finishing.',
       1, '[1,16]'),
  ('B', 'Pekerjaan Kamar Mandi',
       'Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup.',
       2, '[12,32]'),
  ('C', 'Plafon & Penutupan Selubung',
       'Penutupan plafon setelah MEP + kamar mandi selesai. Kusen kayu + kaca enclosure.',
       3, '[16,32]'),
  ('D', 'Finishing Lantai, Dinding & Kusen Aluminium',
       'Finalisasi jenis finishing lantai per ruangan dan spesifikasi kusen aluminium.',
       4, '[24,44]'),
  ('E', 'Finishing Permukaan + Ironwork',
       'Cat dinding/plafon, cat duco, ironwork. Landscape mulai paralel.',
       5, '[36,52]'),
  ('F', 'Furniture Built-in & Interior',
       'Kitchen set, wardrobe, wall panel, TV unit. Dipasang sebelum MEP fit-out.',
       6, '[44,64]'),
  ('G', 'MEP Fit-out',
       'Saklar, stop kontak, AC, sanitair fixtures, smart home, network/CTV. Sesuai layout furniture.',
       7, '[56,72]'),
  ('H', 'Penyelesaian Akhir & Serah Terima',
       'Kaca shower, lampu dekoratif, poles marmer, general cleaning, punch list.',
       8, '[68,88]');

------------------------------------------------------------------------
-- Lampiran A checkpoint templates (per SAN Finishing Guide Lampiran A)
------------------------------------------------------------------------
insert into public.gate_checkpoint_templates (gate_code, item_text, sort_order, required) values
-- Gate A
('A','Seluruh titik listrik, air, AC, pipa, data, dan speaker telah terpasang sesuai gambar kerja',1,true),
('A','Pressure test pipa air bersih: tekanan minimum 4 bar, tahan 24 jam tanpa bocor',2,true),
('A','Waterproofing test: flood test 24-48 jam untuk setiap area basah, tidak ada rembesan',3,true),
('A','Screeding lantai: level check menggunakan waterpass, toleransi maksimal 3mm per 2 meter',4,true),
('A','Foto dokumentasi: setiap sistem MEP sebelum ditutup (essential untuk maintenance di kemudian hari)',5,true),
-- Gate B
('B','Pemasangan material dinding rata, tidak ada lippage >1mm untuk marmer',1,true),
('B','Kemiringan lantai ke arah floor drain: minimum 1% slope',2,true),
('B','Grouting rapi dan merata, tidak ada void',3,true),
('B','Outlet air dan drain presisi sesuai posisi sanitair yang dipilih',4,true),
('B','Foto dokumentasi sebelum dan sesudah pemasangan',5,true),
-- Gate C
('C','Plafon level, tidak ada gelombang (cek dengan senter menyamping)',1,true),
('C','Joint gypsum rapi, tidak terlihat setelah finishing',2,true),
('C','Cornice presisi di sudut dan sambungan',3,true),
('C','Kusen tegak lurus dan siku, toleransi 1mm',4,true),
('C','Daun pintu berfungsi lancar, gap merata',5,true),
-- Gate D
('D','Lantai level, lippage maksimal 1mm untuk marmer, 1.5mm untuk keramik',1,true),
('D','Pattern/pola sesuai shop drawing yang disetujui klien',2,true),
('D','Kusen aluminium siku, sealant rapi, tidak ada celah udara/air',3,true),
('D','Threshold/ambang pintu presisi untuk transisi antar material lantai',4,true),
-- Gate E
('E','Cat merata, tidak ada bekas roller atau brush mark (cek dengan senter menyamping)',1,true),
('E','Warna sesuai sample yang disetujui klien',2,true),
('E','Cat duco halus, tidak ada orange peel atau bintik debu',3,true),
('E','Railing kokoh, las rapi, finishing cat/coating merata',4,true),
('E','Proteksi lantai dan material yang sudah terpasang selama pengecatan',5,true),
-- Gate F
('F','Furniture presisi, gap merata, alignment sempurna',1,true),
('F','Countertop level, sambungan invisible (khusus solid surface/quartz)',2,true),
('F','Laci dan pintu furniture berfungsi smooth, soft-close berfungsi',3,true),
('F','Handle dan aksesoris terpasang kokoh, tidak goyang',4,true),
('F','Wallpaper: pattern match, tidak ada gelembung atau lipatan',5,true),
-- Gate G
('G','Seluruh saklar dan stop kontak berfungsi, posisi sesuai gambar kerja',1,true),
('G','AC dingin merata, tidak ada kebocoran refrigerant, drain condensate lancar',2,true),
('G','Sanitair tidak bocor, flush closet lancar, pressure shower memadai',3,true),
('G','Lift berfungsi smooth, leveling presisi dengan lantai finish',4,true),
('G','Seluruh sistem (smart home, CCTV, network) tested dan berfungsi',5,true),
-- Gate H
('H','Kaca shower bersih, sealant rapi, engsel berfungsi smooth',1,true),
('H','Seluruh lampu berfungsi, dimmer (jika ada) berfungsi',2,true),
('H','Marmer setelah poles: refleksi jelas, tidak ada goresan tersisa',3,true),
('H','Seluruh ruangan bersih, tidak ada sisa material atau debu konstruksi',4,true),
('H','Punch list final: zero Critical defect, zero Major defect, Minor defect sudah diterima atau diperbaiki',5,true);
