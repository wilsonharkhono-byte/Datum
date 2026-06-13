# Gate × Readiness Machine — Evaluation & Redesign Proposal

**Date:** 2026-06-13 · **Verdict in one line:** the machine is architecturally sound but operationally dead — it models a QA bureaucracy nobody executes, on data that doesn't exist, against schedules that are fiction. It can become genuinely useful, but only by inverting its philosophy: **derive status from work that already happens, instead of demanding parallel bookkeeping.**

---

## 1. What it is today (verified, not assumed)

The stack: 8 seeded gates (A–H, from Sistem Kontrol v3.0) × per-project areas → `area_gate_status` cells, fed by a deterministic schedule RPC (kickoff + each gate's `active_weeks` template) and a rule engine (v2) that reads card events through `card_areas` links. Downstream consumers: matrix page, Gantt, NextDeadlineBadge, board deadline chips, brief cascade risks, Hari Ini advisor — **~70% of the app's "intelligence" sits downstream of this one table.**

**Live verification (2026-06-13):**
- `ARIN-KARAWANG` (real, Trello-imported) schedule page: **"0 AREA · 8 GATE — Belum pernah dihitung — Schedule belum dihitung."** The Trello import creates no areas and no card_areas links, so all ~66 real projects have an empty machine.
- `BDG-H1` (seeded pilot): full 9×8 matrix — whose entire Gantt window runs **Jul 2024 → Mar 2026, i.e. wholly in the past.** Last recompute helped status colors, but every target date is dead. Before today's advisor fix, this fiction produced "Gate B lewat 487 hari" as priorities #1–7.
- The seeded grid also shows the template absurdity directly: *Pantry Lt.1 → Gate B "Kamar Mandi"* — every area gets all 8 gates whether or not they apply; `not_applicable` exists in the enum but nothing ever sets it.

**Dead subsystems (schema exists, zero UI, zero rows in practice):**

| Subsystem | State |
|---|---|
| `area_gate_checkpoints` (39 Lampiran-A QA templates per gate) | Seeded, never checkable — no UI to mark passed/failed or attach evidence |
| `area_gate_blockers` (typed blockers w/ owner + resolution) | No create/resolve UI anywhere; 0 rows |
| `area_gate_status.target_*` dates | Written only by the kickoff-date RPC; no per-cell or per-area adjustment UI |
| `area_gate_status.current_owner_id` | Seeded once, never updated |
| Areas + `card_areas` for imported projects | Import creates neither; manual curation of ~66 projects × ~10 areas × ~60 cards never happened and never will |

**Weighted liveness: ~6%** (2 pilot projects ~90% alive; 66 real projects ~5%).

## 2. Why it feels flimsy — the PM diagnosis

Put a seasoned project manager in front of this and four structural problems explain the feeling:

1. **It models an idealized process, not the actual one.** The design assumes a site supervisor doing structured per-cell QA entry (checkpoints → blockers → gate sign-off). The studio's actual information flow is WhatsApp photos, Trello cards, and now chat capture. A tool that requires a parallel bookkeeping universe loses to the universe that already exists. Evidence: 0 of 66 real projects were ever wired up.

2. **The schedule is deterministic fiction.** Every area in a project gets identical gate windows computed from one kickoff date. Real finishing work is per-area and wildly uneven (custom kitchen waits 12 weeks on fabrication; a bedroom finishes in 3). A schedule that can't bend to reality gets ignored; once ignored, every downstream signal computed from it (overdue, cascade, deadline chips) is noise. The 487-days-overdue advisor items were this noise reaching the top of the brief.

3. **The grain is wrong for daily work.** A PM's daily questions are: *what's blocking this room? what must I order/decide this week? which project needs me today?* The matrix answers "what is the status of 72 cells" — a reporting artifact you'd glance at in a monthly review, not an action surface. Cells don't map to actions; cards and blockers do.

4. **Cost-to-feed exceeds value-delivered.** To light up one project: create ~10 areas, link ~60 cards, enrich events with status fields, keep kickoff true, click recompute. Hours per project,×66. The payoff: colored cells. Nobody rational does this bookkeeping — and indeed nobody did.

**What's genuinely good (keep all of it):** the 8-gate domain model is real expertise encoded — the gate *sequence and dependency logic* (B before D before F…) is true to finishing work; the rule engine is deterministic and tested; the stale→recompute trigger architecture is elegant (and now auto-fires); cascade-risk logic is sound; the 39 checkpoint templates are a valuable *reference checklist* even if nobody will ever data-enter against them; the event-sourced card layer feeding it is the right substrate.

## 3. How a PM would actually use gates — the redesign

**Inversion principle: the machine reads the work; humans only confirm.** Gates stop being 8 deadline windows per area and become a **pipeline stage per area** — "Living Lt.1 is in Gate D" — derived from cards, confirmed by one tap, displayed where daily work happens.

### R1 — AI area-linking (the unlock; nothing else matters until this ships)
Cards and events already name their rooms in Bahasa ("kamar mandi anak 4", "pola lantai living", "kusen kamar bathroom lt 3"). One assisted backfill pass per project: AI reads card titles/events → proposes a canonical area list + card→area assignments → Wilson reviews in the **existing data_drafts review queue** (the pattern is already built and trusted) → accept-all with exceptions. Converts 66 dead projects to live in minutes each, and new cards get area suggestions at capture time (the chat assistant already extracts payloads — add `area_hint`).
*Effort: ~2–3 days. Uses: existing review_queue, existing capture pipeline, `seed_default_topics`-style area canon.*

### R2 — "Ruangan" view replaces the matrix as primary surface
Per project, one row per area: **current stage chip (the furthest gate with activity), progress within stage, blocker count, last activity, next action.** "R. Tamu — Gate D Lantai & Kusen — 3 kartu aktif, 1 blocker, terakhir 2 hari lalu." Tapping a row filters the board carousel to that area's cards (mobile-first, uses the new jump-bar machinery). The 8×N matrix stays as a "detail" tab for reviews; gates that don't apply to an area (pantry → Kamar Mandi) are auto-marked `not_applicable` when no relevant cards exist after R1.
*Effort: ~3–4 days. The rule engine already computes everything this needs.*

### R3 — Gate advance by confirmation, not bookkeeping
When the rule engine sees all of an area's gate-relevant work done, the advisor proposes: **"Tandai Gate D R. Tamu selesai?"** — one tap writes `actual_end_date` + `passed` (optional photo). At that moment — and only then — the 39 checkpoint templates appear as a *confirm-time reminder checklist* (skippable, not stored per-item unless ticked). QA knowledge gets used at the moment of decision instead of demanding a parallel ledger. Blockers stay payload-based (`blocked_on` — already capturable via chat); drop `area_gate_blockers` from the roadmap, one blocker system not two.
*Effort: ~2–3 days. Mostly advisor signal + one guarded mutation.*

### R4 — Honest dates: two real numbers instead of 8×N fictional windows
Keep: project `target_handover` (exists) + an optional **single target date per area** (one new nullable column or reuse cell H's target). Gate windows derive backwards from the area target when set, else from handover. "Overdue" then means *area at risk vs handover* — a claim a PM actually believes. Re-baseline = edit one date. The deterministic RPC survives as the default-filler, not the truth. (Today's stopgap already shipped: >120d-overdue gates collapse into one "baseline ulang" advisor item per project instead of per-cell spam, and same-gate-same-date items group across areas.)
*Effort: ~2 days + one additive migration.*

**Sequence: R1 → R2 → R3 → R4.** Each is independently shippable; R1 alone makes the existing matrix/advisor/deadline machinery light up on real projects. Total ≈ 2 weeks of focused work to take the feature from demo-ware to the daily driver the rest of DATUM already orbits.

---

## STATUS — all four BUILT (2026-06-13, branch `datum-brain-upgrade`)

R1–R4 shipped in parallel and integrated. Typecheck clean, 137 unit tests green, production build clean (17/17 routes), independent security review found **no vulnerabilities** (auth + project-membership + RLS + zod on every write path; AI output validated as untrusted data; no cost data in prompts; no service-role in app code).

- **R1 — verified live, read-only:** on ARIN-KARAWANG (61 cards, 0 areas) the AI proposed correct rooms from Bahasa card titles — KM-ANAK←"Update kamar mandi anak 4" (95%), KM-UTAMA←"Master bathroom - bathtub" (90%), CARPORT/Utility (95%), TERRACE/Sirkulasi. Entry point: Settings → Areas → "✨ Deteksi ruangan otomatis". Apply writes areas+card_areas under session RLS. Not applied to any real project during verification (left to Wilson's judgement).
- **R2 — verified live:** `/project/[slug]/rooms` renders per-room rows; on BDG-H1 it honestly shows "Belum mulai" because the pilot's cards aren't area-linked yet (exactly what R1 fixes). Empty state on 0-area projects points to the R1 flow.
- **R3 — built + tested:** `gate_ready` advisor signal (score 52) + `markGatePassed` (state-guarded, race-safe, audited via current_owner_id) + confirm sheet showing Lampiran-A checklist. Couldn't exercise live (no cell is `ready_for_handoff` in seed data) — covered by build + security review + unit tests. Recompute no longer clobbers a manually-passed cell.
- **R4 — verified live (UI):** schedule page shows "TARGET HANDOVER PER AREA" with 9 per-area editors; overlay derivation unit-tested (9 tests). **Write path blocked until migration push** — `areas.target_date` doesn't exist in the live DB yet; `getAreaTargetDates` degrades gracefully (empty) so the page renders.

**Pending manual step (blocked for the agent):** `cd packages/db/supabase && supabase db push` then `pnpm db:types` — applies the R4 `area_target_date` migration (+ the still-pending search_text + card_links delete migrations from earlier). Until then: R4 target-setting is read-only, search is unindexed, Terkait-delete is a no-op. Everything else works.

## 4. What shipped today alongside this evaluation
- **Advisor signal quality** (the stopgap for §2.2's noise): `schedule_rot` collapse + per-(project, gate, date) grouping — verified live: priorities went from 7 rows of dead-gate spam to one row per gate decision, with real blockers and a real 4-day-overdue gate surfacing.
- **Offline chat capture queue** — failed sends persist and auto-resend (site dead-spots can't lose notes); 12 new unit tests.
- **Brief blocker truncation fix** — exact counts, newest-first window, bounded supersession query (both TODO(scale) risks removed).
- **Per-route loading skeletons** for the 9 remaining routes. (The "blank schedule page" encountered mid-investigation was a headless-preview artifact — React 19.2 reveals streamed Suspense content via `requestAnimationFrame`, which never fires in hidden tabs. No app bug; verified by forcing the reveal.)
