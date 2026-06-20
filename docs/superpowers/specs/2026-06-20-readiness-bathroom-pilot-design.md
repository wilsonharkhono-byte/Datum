# Readiness System — Pilot 1: Gate B (Kamar Mandi) deep-step model + reminder engine

- **Date:** 2026-06-20
- **Status:** Approved design (pre-plan)
- **Branch:** `feat/readiness-bathroom-pilot`
- **Author:** Wilson + Claude (brainstorming session)

---

## 1. Problem & motivation

DATUM's finishing projects rely on the principal / site manager to *push* progress. When the
team is busy, aspects get overlooked and projects do not get equal attention. The project
manager has a ceiling on how many projects they can actively track. We want a robust system
that **guides staff's work** and **eases the managerial burden** — so nothing rots in a
neglected project, even when no one is pushing it.

The intelligence to do this is **already largely present** in DATUM:

- 8 sequenced finishing gates A–H (`gates`, seeded from the SAN Finishing Guide Bab 2), each
  with `active_weeks` typical-schedule windows.
- Lampiran A quality checkpoints per gate (`gate_checkpoint_templates`).
- Per-area gate status, target dates, schedule recompute (`area_gate_status`,
  `compute_area_gate_schedule`, `lib/gates/*`).
- A cross-project, ranked "Hari Ini" advisor (`lib/advisor/*`) that already surfaces
  gate_overdue, blocker, decision_needed, awaiting_client, quote_expiring, cascade_risk,
  schedule_rot, gate_ready, stale_card.
- An in-app notifications subsystem (`lib/notifications/*`) on an every-minute cron.

**The gap is not "compute what needs attention" — that exists. The gap is:**

1. The advisor is **passive (pull)** — someone must open it. Busy people don't.
2. It is **global, not personalized** — one big list, not "your PM's list for your projects."
3. It is **coarse** — it reasons at the 8-gate level, so it cannot yet say
   *"the marble selection for KM Lt.2 is still open and it now blocks the order, which needs
   4 weeks, so the install slips unless you decide by Friday."*
4. It is **in-app only** — no push to where field staff actually look during a site day.

This pilot closes the gap for **one gate (B, kamar mandi)** end-to-end, proving the pattern
before expanding to the other gates.

## 2. Goals & non-goals

### Goals (this pilot)

- A deepened, **data-driven trade-step model** for Gate B (template layer + step checkpoints).
- **Per-bathroom-area instantiation** of those steps, specialized by the area's finish profile.
- A **step lifecycle** that survives real-site mess: `blocked` ≠ `stalled` ≠
  `done_with_defects` ≠ `accepted`.
- **Reality tracking via light cadence** + **graduated silence escalation**.
- A **reminder engine**: personalized list + daily push + escalation ladder, reading the new
  model (extends the existing advisor; does not replace it).
- **Progress-gating punch items** in DATUM (extends the existing `issue: defect` primitive).

### Non-goals (deferred — schema-ready, not built now)

- Deepening Gates A, C–H. (Pilot proves the pattern; the rest is incremental knowledge capture.)
- The cross-project **per-trade calendar view**. The data (`assigned_trade` + planned window)
  is queryable from day one; the *view* is a later deliverable.
- **SANO integration.** Chargeable rework stays in SANO. DATUM stores at most an optional
  manual reference string; **no sync**. (SANO is ours to integrate with later if desired.)
- **WhatsApp delivery.** The digest content is channel-agnostic; it ships in-app first, with a
  WhatsApp adapter as the immediate fast-follow.

## 3. Core concept — reference backbone + reality layer

The gate/checkpoint model is a **reference backbone**, not a waterfall. It encodes the firm's
standard flow and the standard way of thinking. A thin **reality-tracking layer** sits on top;
its only job is to capture the mess and **flag where actual progress diverges from the
standard**. The engine's value is "tell me where reality has drifted," not "enforce the plan."

This directly absorbs the real-site chaos:

| Site reality | Model mechanism |
| --- | --- |
| A trade frames, leaves for another trade, gets reallocated, never returns | Typed "not moving" reason: `blocked` (waiting on a predecessor) ≠ `stalled` (trade not on site). Different reasons → different reminders. |
| Subcontractor under-resourced / no workers at site | **Silence detection**: each step has a planned window; window active + no progress logged for N days → escalate. Near-zero extra logging — silence *is* the signal. |
| Work not 100%, defects + modifications create interdependencies | `done_with_defects` (punch items open) ≠ `accepted` (checkpoint passed). Punch items are first-class; a defect can reopen *rework* without reopening the gate, and can be raised against an already-accepted step (later trade damaged the marble). |
| Checkpoints vary project to project, flow stays standard | **Template + per-project override.** Steps & dependencies = firm standard; checkpoints are editable per area instance. |

## 4. Data model

Two layers, mirroring the existing `gates` + `gate_checkpoint_templates` (template) and
`area_gate_status` (instance) patterns.

### 4.1 Template layer (firm standard; seeded by migration)

**`trade_steps`** — the granular activity unit.

| Column | Type | Notes |
| --- | --- | --- |
| `code` | text PK | e.g. `B1`, `B4` |
| `gate_code` | text → `gates.code` | parent gate |
| `name` | text | e.g. "Waterproofing" |
| `step_type` | text | `decision` \| `procurement` \| `site_work` \| `inspection` |
| `trade_role` | text null | e.g. `aplikator_waterproofing`, `tukang_marmer`, `desainer`, `purchasing`, `site_manager` |
| `typical_duration_days` | numeric | nominal site duration |
| `lead_time_days` | numeric default 0 | for `decision`/`procurement`: how far upstream of its dependents it must start |
| `sort_order` | int | display order within gate |
| `applicability` | jsonb | condition over area finish profile; empty = always applies |
| `active` | boolean default true | |

**`trade_step_deps`** — DAG edges.

| Column | Type | Notes |
| --- | --- | --- |
| `step_code` | text → `trade_steps.code` | |
| `predecessor_code` | text → `trade_steps.code` | |
| PK | (`step_code`, `predecessor_code`) | |

**`trade_step_checkpoints`** — Lampiran A pushed down to the step.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `step_code` | text → `trade_steps.code` | |
| `item_text` | text | the quality criterion |
| `default_severity` | text | `kritis` \| `mayor` \| `minor` (severity if it fails) |
| `required` | boolean default true | |
| `sort_order` | int | |

### 4.2 Instance layer (one real bathroom)

**`area_steps`** — one row per applicable step per bathroom area. **Materialized** (not derived
on the fly) because we need stored *planned windows* for silence detection and the per-trade
calendar, plus assignments.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `area_id` | uuid → `areas` | |
| `step_code` | text → `trade_steps.code` | |
| `status` | text | `not_started` \| `in_progress` \| `blocked` \| `stalled` \| `done_with_defects` \| `accepted` \| `not_applicable` |
| `planned_start` | date null | from schedule computation |
| `planned_end` | date null | |
| `actual_start` | date null | |
| `actual_end` | date null | |
| `assigned_trade` | text null | which subcontractor/owner; powers per-trade calendar |
| `blocking_reason` | text null | human phrasing for `blocked`/`stalled` |
| `last_progress_at` | timestamptz null | drives silence detection |
| unique | (`area_id`, `step_code`) | idempotent instantiation |

**`area_step_checkpoints`** — instance results + per-project overrides. Rows are seeded by
copying the template, then may be added/removed/edited per area without touching templates.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `area_step_id` | uuid → `area_steps` | |
| `item_text` | text | copied from template; editable per project |
| `severity` | text | `kritis` \| `mayor` \| `minor` |
| `required` | boolean | |
| `result` | text default `pending` | `pending` \| `pass` \| `fail` |
| `checked_by` | uuid null | staff |
| `checked_at` | timestamptz null | |
| `sort_order` | int | |

**`punch_items`** — progress-gating defects (extends the existing `issue: defect` concept).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `area_step_id` | uuid → `area_steps` | the step it gates |
| `description` | text | |
| `severity` | text | `kritis` \| `mayor` \| `minor` |
| `caused_by_trade` | text null | for accountability |
| `fix_owner_trade` | text null | who fixes it |
| `status` | text default `open` | `open` \| `fixing` \| `closed` |
| `sano_work_item_ref` | text null | **optional manual reference only; no sync** |
| `created_at` / `closed_at` | timestamptz | |

### 4.3 Progress linkage (resolved design choice §2)

A supervisor's **work `card_event` carries an explicit step reference** (e.g.
`payload.area_step_id`). One extra tap when logging attributes progress to a specific step.
A projection handler updates the referenced `area_steps` row: sets `actual_start`/`actual_end`,
`status`, and `last_progress_at`. The event log stays append-only; latest event per step wins
(same semantics as `lib/gates/readiness-rules.ts`).

*Rejected alternative:* deriving step status from unattributed events on the area (lighter
logging, but the signal is too fuzzy for silence detection and per-trade scheduling).

### 4.4 Instantiation & scheduling (mirror existing patterns)

**Applicability profile source.** A step's `applicability` is matched against the area's
profile = `area_type` (existing enum: `bathroom`, `kitchen`, …) **plus a new
`areas.finish_profile jsonb`** (e.g. `{ "lantai": "marmer", "dinding": "cat", "kusen": "aluminium" }`)
that staff set per area. `area_type = bathroom` selects the Gate B step set; `finish_profile`
selects finish-dependent steps (B3 import-order only when `lantai ∈ {marmer, batu}`).

- **`seed_area_steps(area_id)`** — when an area is `area_type = bathroom` with its
  `finish_profile` set, insert `area_steps` + `area_step_checkpoints` from templates filtered by
  `applicability`. Mirrors `seed_default_topics`. Idempotent (re-runnable).
- **`compute_area_step_schedule(area_id)`** — derive `planned_start`/`planned_end` per step
  from the area's Gate B target window + step `typical_duration_days` + `trade_step_deps` +
  `lead_time_days`, back-scheduling decisions/procurement so their deadlines fall *before* the
  physical work they gate. Mirrors `compute_area_gate_schedule`.

## 5. Step lifecycle (state machine)

```
not_started → in_progress → done_with_defects → accepted
                  ↑ ↓                  ↓ (rework)        ↑
              stalled  blocked    (punch closed)   (later trade damages
              not_applicable                        → reopen rework)
```

- **blocked** — waiting on a predecessor, an open decision, or an undelivered order. Reminder
  chases *that* upstream item.
- **stalled** — planned window active but the trade isn't progressing. Reminder chases the
  *subcontractor's manpower*.
- **done_with_defects** — physically complete, punch items still open. Not `accepted`.
- **accepted** — checkpoint passed with **zero kritis, zero mayor**; minor accepted-or-fixed
  (the existing Gate H punch-list rule). Only `accepted` satisfies downstream dependencies.
- A `punch_item` can reopen **rework** on an `accepted` step without reopening the gate.

## 6. Reality tracking + silence escalation

Logging cadence is **(b): logged when something changes / per site visit.** The model does the
heavy lifting by turning *expected-but-silent* into a signal.

- Each `area_step` carries a planned window. The silence threshold is derived from the step's
  expected cadence (don't nag a 5-day step on day 2 if it is moving).
- **Tier 1 — nudge (private → supervisor):** window active, no progress for ~2 working days.
  *"Update KM Lt.2? Tukang marmer dijadwalkan, belum ada progress 2 hari."* Anti-slacking
  pressure that stays at the supervisor's level.
- **Tier 2 — warn (→ estimator + principal):** still silent after ~4 days. Deliberately
  ambiguous: *"KM Lt.2 senyap 4 hari — konfirmasi: tukang tidak hadir atau laporan tertinggal?"*
  The ambiguity is the point — a human must resolve it. Resolving it routes correctly: a
  progress log fills the gap; flagging "subcon tidak kirim tukang" sets the step to `stalled`.
- **Reporting reliability:** Tier-2 escalation counts per supervisor accumulate as a signal of
  who lets work go silent — the "not slacking off" accountability lever, for free.
- **Implementation:** a periodic job on the existing cron; new notification kinds
  `silence_nudge`, `silence_warning` via `lib/notifications/producers.ts`.

## 7. Reminder engine (extends the advisor, does not replace it)

- **New step-level signals** added to `lib/advisor/*`:
  - `next_step` — the area's next actionable step.
  - `decision_back_scheduled` — an open `decision` step whose back-scheduled deadline is
    approaching (e.g. "marble selection blocks the order; decide by Fri").
  - `order_lead_time` — a `procurement` step that must start now to land on time.
  - `step_stalled` — a `stalled` step (scored like a blocker).
- **Personalization:** filter the ranked signals per recipient (role + project membership) —
  a new `getAdvisorForStaff(staffId)`. Replaces the single global list.
- **Push, not pull (resolved choice §5):** a **daily digest** ("apa yang harus didorong hari
  ini") composed from each recipient's top-N signals, delivered **in-app first**. The digest
  content is **channel-agnostic**; a WhatsApp adapter is the immediate fast-follow.
- **Escalation ladder:** items left unattended for N days climb staff → PM → principal,
  reusing the Tier mechanics from §6.

## 8. Defects & per-trade schedule (already-agreed boundaries)

- **Defects:** DATUM `punch_items` gate progress only. **Chargeable rework stays in SANO**,
  logged as today; `sano_work_item_ref` is an optional manual breadcrumb with no sync.
- **Per-trade schedule:** because `area_steps` carry `assigned_trade` + planned window, the
  cross-project per-trade calendar is one query away. Built later as a read-only view; the
  schema supports it now. (Relevant because the same subcontractors recur across projects.)

## 9. Builds on (reuse, do not reinvent)

- `lib/gates/readiness-rules.ts` — append-only "latest event wins" pattern for step status.
- `lib/gates/recompute.ts`, `lib/gates/schedule.ts`, `area-target.ts` — schedule computation.
- `lib/advisor/queries.ts`, `rank.ts`, `types.ts` — signal assembly + ranking.
- `lib/notifications/producers.ts`, `queries.ts`, `realtime.ts` + cron — delivery.
- `lib/brief/queries.ts`, `bottlenecks.ts` — defects, expiring quotes, cascade risk.
- Migration patterns: `seed_gates_and_checkpoints`, `compute_area_gate_schedule`,
  `seed_topics_function` (instantiation), `*_staff_write_rls` (RLS).

## 10. Gate B trade-step template (v1 content to seed)

This is the v1 knowledge to author into `trade_steps` / `trade_step_deps` /
`trade_step_checkpoints`. Refine with Wilson during implementation.

Durations and lead times are **v2** (Wilson, 2026-06-20): site-work durations ×3 over the v1
estimates; flood test 3–5 days; and explicit lead-time + reminder steps for *securing* the
marble (B3), the sanitair (B10), and the **waterproofing applicator** (B11 — book the trade
ahead so it actually shows up).

| # | Step | Type | Trade / owner | Depends on | Lead/dur (days) | Checkpoint(s) |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Pilih material dinding/lantai + shop drawing | `decision` | desainer + klien | — | lead **7** | klien sign-off shop drawing |
| B2 | Pilih sanitair & fixtures | `decision` | desainer + klien | — | lead **7** | spesifikasi terkunci |
| B3 | Order marmer/batu | `procurement` | purchasing | B1 | lead **21** (impor) | PO marmer, tgl kirim fix |
| B10 | Order sanitair & fixtures | `procurement` | purchasing | B2 | lead **14** | PO sanitair, tgl kirim fix |
| B11 | Booking aplikator waterproofing | `procurement` | aplikator WP | — | lead **7** | aplikator dikonfirmasi & dijadwalkan |
| B4 | Waterproofing | `site_work` | aplikator WP | B11, Gate A | dur **9** (incl. cure + flood test) | flood test **3–5 hari**, no rembesan (kritis) |
| B5 | Screeding + slope | `site_work` | tukang | B4 | dur **6** | slope ≥ 1% ke floor drain |
| B6 | Pasang dinding marmer | `site_work` | tukang marmer | B3, B4 | dur **15** | lippage ≤ 1mm; pola per shop drawing |
| B7 | Pasang lantai marmer | `site_work` | tukang marmer | B5, B3 | dur **9** | slope terjaga; lippage ≤ 1mm |
| B8 | Grouting | `site_work` | tukang | B6, B7 | dur **3** | rapi; tidak ada void |
| B9 | Verifikasi titik sanitair | `inspection` | site manager | B2, B10 | dur **3** | outlet/drain presisi ke sanitair terpilih |

Unlocks **Gate C** (plafon KM boleh ditutup) once B4 + MEP-above verified.
`applicability` example: B3 applies only when `lantai ∈ {marmer, batu}`; a ceramic bathroom
gets a local-stock variant with no import lead time.

## 11. Risks & dependencies

- **Data-entry dependency.** The whole reality layer needs cadence (b). If supervisors neither
  log nor answer nudges, Tier-2 warnings carry the load (by design). *Mitigation:* logging must
  be one-tap on mobile (the responsive work just landed); the step reference is a single picker.
- **Knowledge capture.** The Gate B template (§10) is **v2** (durations/lead-times validated with
  Wilson 2026-06-20); `item_text` wording may still be refined per project.
- **Over-notification.** Tune thresholds; the digest dedupes; consider quiet hours.
- **RLS.** New tables need policies consistent with project-scoped read
  (`current_can_read_project`) and staff write where appropriate (mirror `areas_staff_write`).
- **Live Supabase.** `supabase db push` only — never reset. Use the global Supabase CLI v2
  (the workspace `pnpm migrate` fails on PG17 config).

## 12. Success criteria

1. For a real bathroom, DATUM shows the full step list **specialized to its finishes**, with
   computed planned windows.
2. An open marble-selection decision surfaces in the digest **with its back-scheduled deadline**
   *before* the gate goes overdue.
3. A step silent for ~4 days during its active window produces a **Tier-2 warning** to estimator
   + principal.
4. A step **cannot be `accepted`** while it has an open `kritis`/`mayor` punch item.
5. Each PM / principal receives a **personalized daily digest** of what to push today.

## 13. Suggested build phases (for the implementation plan)

1. **Model:** schema (template + instance tables, RLS) + Gate B template seed + `seed_area_steps`
   + `compute_area_step_schedule` + step state projection from work events.
2. **Reality:** silence detection job + graduated escalation (`silence_nudge`,
   `silence_warning`) + punch items + checkpoint pass/fail gating `accepted`.
3. **Reminder:** advisor step-level signals + personalization (`getAdvisorForStaff`) + daily
   in-app digest + escalation ladder.

Deferred to later slices: WhatsApp adapter, per-trade calendar view, SANO link, Gates A & C–H.
