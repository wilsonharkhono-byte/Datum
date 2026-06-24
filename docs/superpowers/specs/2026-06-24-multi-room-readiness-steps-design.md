# Uniform Phase-Based Readiness for All Rooms — Design

**Date:** 2026-06-24
**Status:** Design approved in brainstorming; pending spec review → implementation plan.
**Supersedes the bathroom-only model:** reframes Gate B from a room ("Kamar Mandi") into a phase ("Pekerjaan Basah / Waterproofing"), so all gates A–H are uniform construction phases and **every room — including the bathroom — flows through the same phases**. Extends the readiness step system (Gate B pilot + per-area editing #22) to every room type.

## Goal

Make the gate model uniform (8 phases, no room-gate), give every room a phase-tagged readiness to-do checklist seeded from a firm-standard library, and surface it on the Rooms page with an active-focused view + an AI-assistant entry point. The bathroom stops being a special bundle and becomes a normal room.

## Context (current model + the wart)

- Gates **A–H** are construction phases, project-wide — **except B**, which is "Pekerjaan Kamar Mandi," a *room* bundled into a gate. Gate B's steps (B1–B11) actually mix three phases: waterproofing/slope (a wet-works phase), wall/floor tiling (Gate D work), and sanitair (Gate G work).
- `seed_area_steps` hard-codes `area_type='bathroom'` + `gate_code='B'`. The schedule page renders the step panel only for bathrooms.
- Live footprint is tiny: **one** bathroom (Dharmahusada Master Bathroom) has seeded step data on prod, mostly `not_started` — so reframing B is cheap now and expensive later.
- `/project/[slug]/rooms` (`RoomsView` → `RoomRow`, urgency-sorted) is the per-room daily-glance surface. The schedule page already has `SignalSummaryPanel` (cross-area readiness signals).
- Per-area editing (#22): `area_steps.removed_at` soft-remove, custom steps as project-scoped `trade_steps`, `getAddableCatalogSteps`, `add_catalog_area_step`/`add_custom_area_step`.

## Decisions (from brainstorming)

1. **Reframe Gate B → "Pekerjaan Basah / Waterproofing"** — a phase applicable to wet rooms (bathroom, kitchen wet-zone, service/laundry, balcony). The bathroom flows through A–H like every room; its B1–B11 unbundle into wet-works (B), tiling (D), and sanitair (G).
2. **Organize by phase, tagged per room** — each step defined once per gate, tagged with `applies_to_area_types`; a room's to-do = the applicable steps.
3. **Propagation = opt-in pull** — existing projects keep their lists; new recommended steps become *available* via the per-area "Dari rekomendasi" picker; deactivate/reorder affect future seeding only.
4. **Applicability depth = seed-by-room-type + prune** — seed every step tagged to the room; conditional ones (⟨marble⟩/⟨AC⟩/⟨duco⟩/⟨countertop⟩/⟨ironwork⟩) that don't apply are removed per-area (#22). Keep the existing floor-material applicability.
5. **Content base accepted** — the reconciled A–H library (Appendix A) is the starting recommended set; tuned later (or via Piece B).
6. **Checkpoints:** none on the new steps in v1; gate-level checkpoints stay as-is.
7. **Placement = Rooms page** — each room's full A–H checklist lives in `RoomsView` (a `RoomRow` expands into it). The schedule page keeps `SignalSummaryPanel` + matrix; the bathroom step panels move off the schedule page so all rooms are consistent.
8. **Within-room view = active-focused** — flags ("Perlu perhatian") + ready/in-progress steps up top; "Lihat semua langkah" reveals the full A–H phase-grouped (collapsible) list.
9. **AI-assistant entry point (this round)** — a "Tanya asisten: jadwal & langkah berikutnya" button opens the existing assistant seeded with the room's step context + a scheduling/next-to-do prompt. Deeper schedule-drafting is later.

## Part 0 — Gate-B reframe + live migration (prerequisite)

This is a model refactor of *live, shipped* code; do it before the multi-room rollout.

- **Gate definition:** rename gate `B` from "Pekerjaan Kamar Mandi" to **"Pekerjaan Basah / Waterproofing."** The `gate_code` enum (`A`–`H`) is unchanged — only B's *meaning* changes.
- **Redistribute the B1–B11 templates:**
  - Waterproofing → new **Gate B (wet-works)** steps (Appendix A): booking aplikator (B11), waterproofing membrane (B4), flood test (new), screed + slope (B5).
  - Tiling → **Gate D** with `bathroom` added: pick material (B1), order marmer (B3), wall tiling (B6), floor tiling (B7), grouting (B8).
  - Sanitair → **Gate G** with `bathroom`: pilih sanitair (B2), order sanitair (B10), pasang sanitair (new), verifikasi titik sanitair (B9).
- **Re-seed the one live bathroom** (Dharmahusada): its `area_steps` re-derive from the reconciled library. Since it's mostly `not_started`, this is a clean re-seed (preserve any logged status by step-meaning where feasible).
- **Rule engine — NO logic change (verified).** `evaluateGate` (`packages/core/src/gates/readiness-rules.ts`) is generic: it filters `card_events` by `RELEVANT_KINDS[gate]`, then computes work-stream status. Gate B's relevant kinds `{material, decision, vendor, work}` already fit wet-works (membrane = material, aplikator = vendor, work, decisions). So the rule engine + `area_gate_status` recompute are **unchanged**; `RULE_VERSION` stays `2`. There is no bathroom-specific rule.
- **UI labels:** flip `packages/core/src/gates/labels.ts` `B: "Kamar Mandi"` → `"Pekerjaan Basah"` — the matrix column + everywhere Gate B is named follow automatically.
- **Generalize the two `gate_code='B'` code pins** (needed for multi-room regardless): `getAddableCatalogSteps` (`lib/steps/queries.ts`) and `writePlannedDates` (`lib/steps/mutations.ts` — currently computes planned windows for *Gate-B* steps only; generalize to all gates from each gate's target window).

## §1. Schema & seeding

- **`trade_steps` gains `applies_to_area_types text[]`** (NULL = all room types). Finish-profile conditions stay in the existing `applicability` jsonb (floor material only, where we have data).
- **`seed_area_steps` generalizes:** drop the bathroom/Gate-B hard-coding; seed every active firm-standard step where `(applies_to_area_types is null or area.area_type = any(applies_to_area_types))` **and** `applicability` matches the area's `finish_profile`. Copy checkpoint templates as today (none for new steps → no-op).
- **`createArea`** calls `seed_area_steps` for **all** room types; a one-time **backfill** re-seeds existing areas.
- **`trade_step_deps`** seeded from each step's predecessors.

## §2. Content

- Reframe Gate B + seed the reconciled library (Appendix A): the **~77 phase steps** (A, C, D, E, F, G, H) now tagged to include `bathroom` where the work happens, **+ Gate B wet-works (4) + Gate G sanitair (4)** new bathroom-relevant steps. The old B1–B11 are retired (their content lives in B-wet / D / G).
- **Display order** = `(gate_code, sort_order)`, so a room reads A→H.
- **No per-step checkpoints in v1.**

## §3. The screen (Rooms page)

- `RoomRow` expands into the room's step view (a new `RoomStepsPanel`).
- **Active-focused default:** the room's `flags` + in-progress/ready steps; **"Lihat semua langkah"** reveals the full list grouped by phase-gate (collapsible A→H, done/total each), reusing the row → `StepDetail` interaction + #22 add/remove/restore.
- **Schedule page:** drop the bathroom-only step section; keep `SignalSummaryPanel` + matrix + Gantt + targets.
- **AI entry point:** "Tanya asisten" button opens the assistant seeded with a compact serialization of the room's steps (name, status, ready/blocked, lead-time-critical procurement) + a scheduling/next-to-do prompt.

## §4. Reuse, backfill, scope

- **Editing is free:** #22 works on any room. `getAddableCatalogSteps` generalizes from `gate_code='B'` to "firm-standard steps where `applies_to_area_types` matches this room's `area_type`, not yet on it."
- **Flags/projection** are step-code + dep based, already room-agnostic — unchanged.
- **Out of scope (→ Piece B):** the firm-standard library management UI (add/deactivate/drag-reorder/retag). Deeper AI scheduling intelligence is also later.

## Open implementation notes

- `applies_to_area_types` filtering (`text[]` + `= any(...)`); generalize `getAddableCatalogSteps` + `add_catalog_area_step` off `gate_code='B'`.
- ~~Verify the rule engine's Gate-B logic before reframing~~ — **DONE:** `evaluateGate` is generic (filters by `RELEVANT_KINDS`), no bathroom semantics; the reframe needs no rule-engine change (see Part 0).
- **Migration ordering:** prod history must include `20260623000002` (readiness-reminder sync, PR #23) before pushing, or `db push` collides.
- **AI entry-point mechanism (verify):** confirm `ChatDock`/`/api/assistant` can open pre-seeded with a prompt + injected context; if not, degrade to a copy-ready prompt and defer context-injection to the AI scheduling piece.
- **Per-room step fetch on the Rooms page:** batch/parallelize per-room `getAreaStepView` (project is load-perf sensitive).
- **Plan sizing:** consider two plans — (0) the Gate-B reframe + live migration, then (A) the multi-room seeding + Rooms-page UI — since (0) touches shipped code and must land cleanly first.

---

## Appendix A — Reconciled step library (the seed source)

Columns: **code · name · type · trade · dur(d) · lead(d) · preds · rooms · note**. Rooms key: `bath`=bathroom, `liv`=living, `kit`=kitchen, `bed`=bedroom, `gen`=general, `grd`=garden; **allint** = bath/liv/kit/bed/gen. ⟨…⟩ = finish conditional (seed-and-prune). ✱ = maps to an existing gate checkpoint.

### Gate A — MEP Rough-in + Persiapan Struktural (all rooms)
| code | name | type | trade | dur | lead | preds | rooms | note |
|--|--|--|--|--|--|--|--|--|
|A1|Koordinasi MEP & sign-off shop drawing|dec|desainer|3|5|—|allint+grd|garden = irrigation/outdoor-power only|
|A2|Booking tim MEP & order material rough-in|proc|purchasing|1|10|A1|allint+grd||
|A3|Chasing dinding & persiapan jalur|work|tukang_sipil|4|0|A1|allint|not garden|
|A4|Rough-in conduit & wiring listrik|work|mep|6|0|A2,A3|allint+grd||
|A5|Rough-in plumbing (supply & drain)|work|mep|6|0|A2,A3|bath,kit,gen,grd|wet rooms (incl. bathroom)|
|A6|Rough-in pipa refrigerant & drain AC|work|mep|4|0|A2,A3|liv,kit,bed,gen|⟨AC rooms⟩ (bathroom rarely AC)|
|A7|Pressure test pipa air bersih|insp|site_manager|2|0|A5|bath,kit,gen,grd|min 4 bar/24h|
|A8|Foto dokumentasi MEP sebelum ditutup|insp|site_manager|1|0|A4,A5,A6,A7|allint+grd|✱ Gate-A checkpoint|
|A9|Persiapan substrat & screed dasar|work|tukang_sipil|5|0|A8|allint|✱ level ≤3mm/2m (bathroom slope-screed is in Gate B)|
|A11|Inspeksi kesiapan struktural sebelum finishing|insp|site_manager|2|0|A9|allint+grd||

*(old A10 "waterproofing prep" folds into Gate B below.)*

### Gate B — Pekerjaan Basah / Waterproofing (wet rooms) — REFRAMED
| code | name | type | trade | dur | lead | preds | rooms | note |
|--|--|--|--|--|--|--|--|--|
|B1|Booking aplikator waterproofing|proc|aplikator_wp|1|7|—|bath,kit,gen|secures specialist (was B11)|
|B2|Aplikasi waterproofing membrane (lapis kedap)|work|aplikator_wp|3|0|B1|bath,kit,gen|after rough-in (was B4)|
|B3|Flood test / uji genang 24 jam|insp|site_manager|2|0|B2|bath,kit,gen|wet QC before covering — NEW|
|B4|Screeding + slope ke floor drain|work|tukang_sipil|2|0|B3|bath,kit,gen|wet-floor slope (was B5)|

### Gate C — Plafon & Penutupan Selubung (+ bathroom)
| code | name | type | trade | dur | lead | preds | rooms | note |
|--|--|--|--|--|--|--|--|--|
|C1|Pilih sistem plafon + RCP & shop drawing|dec|desainer|2|0|—|allint|bathroom = moisture-resistant (GRC/PVC)|
|C2|Koordinasi titik MEP di plafon|dec|mep|2|0|C1|allint||
|C3|Order rangka & papan plafon|proc|purchasing|1|7|C1|allint|GRC for wet rooms|
|C4|Fabrikasi plafon kayu/panel khusus|proc|purchasing|2|21|C1|liv,bed,gen|⟨wood/panel⟩|
|C5|Pasang rangka plafon + leveling|work|tukang_plafon|4|0|C2,C3|allint||
|C6|Pasang papan plafon + drop/cove|work|tukang_plafon|5|0|C5|allint||
|C7|Buka cut-out downlight/AC/speaker/exhaust|work|tukang_plafon|2|0|C6|allint|bathroom = exhaust fan cut-out|
|C8|Pasang plafon kayu/panel khusus|work|tukang_finishing|4|0|C4,C7|liv,bed,gen|⟨wood/panel⟩|
|C9|Compound + amplas joint plafon|work|tukang_plafon|3|0|C7|allint|⟨gypsum/GRC⟩|
|C10|Penutupan selubung/soffit & bulkhead AC|work|tukang_plafon|2|0|C5|liv,kit,bed,gen||
|C11|Verifikasi level plafon + cut-out|insp|mandor|1|0|C9,C10|allint|↔ Gate-C checkpoint|

### Gate D — Finishing Lantai, Dinding & Kusen (+ bathroom = tiling)
| code | name | type | trade | dur | lead | preds | rooms | note |
|--|--|--|--|--|--|--|--|--|
|D1|Pilih material lantai + dinding|dec|desainer|2|7|—|allint|bathroom = keramik/marmer dinding+lantai (was B1)|
|D2|Pilih kusen aluminium + kaca|dec|desainer|1|7|—|allint|⟨rooms w/ bukaan⟩|
|D3|Order material lantai/dinding|proc|purchasing|1|14|D1|allint|lead↑ marmer/import (was B3)|
|D4|Fabrikasi + order kusen aluminium|proc|purchasing|1|21|D2|allint|⟨bukaan⟩|
|D5|Screeding + leveling substrat|work|tukang_sipil|4|0|—|liv,kit,bed,gen|bathroom screed/slope is in Gate B|
|D6|Pasang lantai (keramik/marmer/vinyl/parket)|work|tukang_lantai|6|0|D3,D5|allint|⟨finish_profile.lantai⟩; bathroom over waterproofing (was B7)|
|D7|Pasang dinding finish (tiling / aci→cat / panel)|work|tukang_finishing|4|0|D3|allint|bathroom = wall tiling (was B6)|
|D8|Pasang kusen aluminium + kaca|work|tukang_aluminium|3|0|D4,D5|allint|⟨bukaan⟩|
|D9|Grouting + sealant|work|tukang_lantai|2|0|D6,D7|allint|was B8|
|D10|Verifikasi level lantai + threshold|insp|mandor|1|0|D6,D8,D9|allint|↔ Gate-D checkpoint (lippage ≤1mm marmer/1.5mm keramik)|

### Gate E — Finishing Permukaan + Ironwork (bathroom mostly skips — tiled)
| code | name | type | trade | dur | lead | preds | rooms | note |
|--|--|--|--|--|--|--|--|--|
|E1|Pilih warna & sistem cat/wallpaper|dec|desainer|1|5|—|liv,kit,bed,gen||
|E2|Tentukan finishing khusus (duco/tekstur)|dec|desainer|1|5|E1|liv,kit,bed|⟨duco/texture⟩|
|E3|Desain ironwork + shop drawing|dec|desainer|2|7|—|liv,bed,gen,grd|⟨ironwork⟩|
|E4|Order material cat/wallpaper/coating|proc|purchasing|1|10|E1|liv,kit,bed,gen,grd||
|E5|Fabrikasi & order ironwork|proc|purchasing|1|21|E3|liv,bed,gen,grd|⟨ironwork⟩|
|E6|Booking aplikator finishing khusus (duco)|proc|aplikator_duco|1|10|E2|liv,kit,bed|⟨duco⟩|
|E7|Proteksi material terpasang (masking)|work|tukang_cat|2|0|—|liv,kit,bed,gen,grd||
|E8|Dempul, amplas & primer dinding|work|tukang_cat|4|0|E4,E7|liv,kit,bed,gen||
|E9|Cat dasar + cat finish (multi-coat)|work|tukang_cat|5|0|E8|liv,kit,bed,gen,grd|⟨cat areas⟩|
|E10|Aplikasi finishing khusus (duco/tekstur)|work|aplikator_duco|6|0|E6,E8|liv,kit,bed|⟨duco⟩|
|E11|Pasang ironwork|work|tukang_besi|3|0|E5,E9|liv,bed,gen,grd|⟨ironwork⟩|
|E12|Verifikasi coverage cat & ironwork|insp|site_manager|2|0|E9,E10,E11|liv,kit,bed,gen,grd||

*(bathroom ceiling paint, if any, is handled as a pruned/added step per-room.)*

### Gate F — Furniture Built-in & Interior (+ bathroom = vanity)
| code | name | type | trade | dur | lead | preds | rooms | note |
|--|--|--|--|--|--|--|--|--|
|F1|Pilih desain furniture built-in + shop drawing|dec|desainer|2|7|—|kit,bed,liv,gen,bath|bathroom = vanity|
|F2|Pilih finishing + countertop + hardware|dec|desainer|1|7|F1|kit,bed,liv,gen,bath|bathroom vanity top|
|F3|Approval klien atas desain + sample|dec|desainer|3|0|F1,F2|kit,bed,liv,gen,bath||
|F4|Order countertop (solid surface/quartz/marmer)|proc|purchasing|1|21|F3|kit,gen,bath|⟨countertop⟩|
|F5|Order hardware (soft-close, rel, engsel)|proc|purchasing|1|14|F3|kit,bed,liv,gen,bath||
|F6|Fabrikasi carcass & pintu (workshop)|proc|vendor_furniture|1|28|F3|kit,bed,liv,gen,bath|longest lead|
|F7|Verifikasi ukuran lapangan (pre-final fab)|insp|site_manager|1|0|F6|kit,bed,liv,gen,bath||
|F8|Pasang carcass & rangka built-in|work|tukang_furniture|5|0|F6,F7|kit,bed,liv,gen,bath||
|F9|Pasang countertop + sambungan|work|tukang_furniture|2|0|F4,F8|kit,gen,bath|⟨countertop⟩|
|F10|Pasang pintu, laci, hardware & finishing|work|tukang_furniture|4|0|F5,F8|kit,bed,liv,gen,bath||
|F11|Verifikasi alignment, gap & smooth operation|insp|site_manager|1|0|F9,F10|kit,bed,liv,gen,bath|↔ Gate-F checkpoint|

### Gate G — MEP Fit-out (+ bathroom lighting/exhaust + sanitair)
| code | name | type | trade | dur | lead | preds | rooms | note |
|--|--|--|--|--|--|--|--|--|
|G1|Finalisasi titik lampu & layout pencahayaan|dec|desainer|1|7|—|allint+grd|after furniture layout|
|G2|Pilih saklar, stop kontak & smart-home device|dec|desainer|1|7|—|allint+grd||
|G3|Pilih unit AC & kapasitas per ruang|dec|mep|1|7|—|liv,kit,bed,gen|⟨AC rooms⟩|
|G4|Pilih sanitair & fixtures kamar mandi|dec|desainer|1|7|—|bath|was B2|
|G5|Order lampu & fixtures dekoratif|proc|purchasing|1|21|G1|allint+grd||
|G6|Order saklar, stop kontak & smart-home device|proc|purchasing|1|14|G2|allint+grd||
|G7|Order unit AC|proc|purchasing|1|14|G3|liv,kit,bed,gen|⟨AC⟩|
|G8|Order sanitair & fixtures|proc|purchasing|1|14|G4|bath|was B10|
|G9|Pasang fixture lampu & energize titik|work|mep|3|0|G5|allint+grd|garden = outdoor IP-rated|
|G10|Pasang plate saklar, stop kontak & panel|work|mep|2|0|G6|allint+grd||
|G11|Pasang indoor unit AC + drain & refrigerant|work|mep|3|0|G7|liv,kit,bed,gen|⟨AC⟩|
|G12|Pasang sanitair & fixtures kamar mandi|work|tukang_sanitair|3|0|G8|bath|NEW (install)|
|G13|Testing & commissioning sirkuit, AC & smart-home|work|mep|2|0|G9,G10,G11|allint+grd||
|G14|Verifikasi titik sanitair & tes fungsi (no leak)|insp|site_manager|1|0|G12|bath|was B9|
|G15|Verifikasi semua titik energize & berfungsi|insp|site_manager|1|0|G13|allint+grd||

### Gate H — Penyelesaian Akhir & Serah Terima (all rooms)
| code | name | type | trade | dur | lead | preds | rooms | note |
|--|--|--|--|--|--|--|--|--|
|H1|Walkthrough snagging & buat punch list|insp|site_manager|2|0|—|allint+grd||
|H2|Perbaikan defect & touch-up finishing|work|mandor|5|0|H1|allint+grd||
|H3|Poles marmer & batu alam|work|tukang_marmer|4|0|H1|allint|⟨marmer/batu⟩ (incl. bathroom)|
|H4|Re-test fungsional MEP, AC, sanitair & fixtures|insp|mep|2|0|H2|allint+grd||
|H5|Lepas proteksi & kemasan pelindung|work|cleaning_crew|1|0|H2|allint+grd||
|H6|Deep cleaning akhir|work|cleaning_crew|3|0|H3,H4,H5|allint+grd||
|H7|Inspeksi internal pre-handover (QC final)|insp|site_manager|1|0|H6|allint+grd|zero kritis/mayor gate|
|H8|Foto dokumentasi as-built hasil akhir|insp|site_manager|1|0|H6|allint+grd|↔ A8 principle|
|H9|Walkthrough klien & sign-off serah terima|insp|site_manager|2|0|H7|allint+grd||
|H10|Perbaikan snag list klien|work|mandor|3|0|H9|allint+grd|⟨if client snags⟩|
|H11|Serahkan dokumen handover (as-built/manual/garansi)|insp|site_manager|2|0|H9|gen|project-level|

> Durations/leads are firm-standard defaults; per-project actuals + tuning come later (and via Piece B). `applicability` jsonb is populated only for floor-material conditionals (D6, H3); other ⟨…⟩ conditionals seed broadly and are pruned per-room (#22). Gate codes within a gate are illustrative — the seed assigns real `sort_order`.
