-- 20260601000005_seed_topics_function.sql
-- Slice 1.1: Auto-seed the standard drawing-code topic taxonomy on project create.

begin;

create or replace function public.seed_default_topics(p_project_id uuid)
returns void language plpgsql as $$
declare
  rows constant text[][] := array[
    ['A01-03', 'A01-03 — DTP (Denah, Tampak, Potongan)', 'drawing'],
    ['A04',    'A04 — Tangga',                            'drawing'],
    ['A05',    'A05 — Kusen',                             'drawing'],
    ['A06',    'A06 — Detail Arsitektur',                 'drawing'],
    ['A07-08', 'A07-08 — Pola Lantai dan Plafon',         'drawing'],
    ['A09',    'A09 — Detail Kamar Mandi',                'drawing'],
    ['A10',    'A10 — Detail Besi',                       'drawing'],
    ['U01',    'U01 — Pipa Air Kotor dan Bersih',         'utility'],
    ['U02',    'U02 — Listrik Dinding dan Lantai',        'utility'],
    ['U03',    'U03 — AC',                                'utility'],
    ['U04',    'U04 — CCTV, Data, Telpon, Wifi',          'utility'],
    ['LANDSCAPE',      'LANDSCAPE',                        'general'],
    ['DAILY_PROGRESS', 'DAILY PROGRESS',                   'general'],
    ['PHOTOS',         'PHOTOS',                           'general'],
    ['LOGISTIK',       'LOGISTIK',                         'general']
  ];
  r text[];
  ord int := 0;
begin
  foreach r slice 1 in array rows loop
    ord := ord + 1;
    insert into public.topics (project_id, code, name, topic_type, sort_order)
      values (p_project_id, r[1], r[2], r[3]::public.topic_type, ord)
    on conflict (project_id, code) do nothing;
  end loop;
end;
$$;

create or replace function public.seed_topics_on_project_insert()
returns trigger language plpgsql security definer as $$
begin
  perform public.seed_default_topics(new.id);
  return new;
end;
$$;

drop trigger if exists seed_topics_after_project_insert on public.projects;
create trigger seed_topics_after_project_insert
  after insert on public.projects
  for each row execute function public.seed_topics_on_project_insert();

-- Backfill: seed topics for the two pilot projects that already exist.
do $$
declare p record;
begin
  for p in select id from public.projects loop
    perform public.seed_default_topics(p.id);
  end loop;
end $$;

commit;
