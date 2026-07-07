# Card-Progress System — UX/Workflow Audit & Optimization Plan

**Date:** 2026-07-02 · **Scope:** everything that "combines project card progress" — cards → gates → per-room steps → AI bridge → signals → reminders/escalation → forecast/slip-risk → learning loops → assistant (PRs #14–#37).
**Method:** code audit at deployed commit `37fb7d6` (4 parallel deep reads: capture path, consumption surfaces, assistant, bridge trust loop) + **read-only queries against the live database** + running the app locally at the deployed commit.
**Goal being audited against (Wilson):** *data in the cards, input as work in a relatable field, recognized as the real process at the site; AI predicts patterns and becomes the daily reminder; don't overcomplicate data entry; the features and data must work together; the AI assistant acts as the project manager.*

---

## 0. Verdict

**The machine is ~80% built and genuinely well-architected. It is ~0% used — and mostly not because of UX polish, but because of three stacked disconnects:**

1. **It was never switched on** (production ops: unpushed migrations, background AI has *never once run* in prod, zero notifications ever delivered, the team isn't onboarded).
2. **It listens for data the team doesn't produce** (structured `work` events on area-linked cards in area-configured projects — each precondition is near-zero in the real data) **while ignoring the data the team produces daily** (notes, documents, photos, room-named cards).
3. **Its outputs are scattered and its assistant is blind** (6+ surfaces to answer "what needs doing today"; Tanya can't see steps, procurement, decisions, or forecast — and has never been asked a single question).

None of these require a rebuild. The optimization plan (§5) is: **turn it on → meet the data where it is → one morning surface → make Tanya the PM.**

---

## 1. Data reality (live DB, 2026-07-02 — the ground truth)

The input side of the funnel is **alive**; every downstream stage is **empty**:

| Layer | Count | Meaning |
|---|---|---|
| Projects / cards / card events | 66 / 3,269 / 5,640 | The card layer is genuinely used. This is the asset. |
| Card events by kind (all time) | document 2,898 · note 1,816 · pending 890 · **work 17** · decision 8 · others trace | The team logs **notes and documents**, not structured work events. |
| Card events since Jun 1 | note 89 · document 28 · decision 6 · client_request 5 · **work 1** | Current behavior: ~1 structured work event **per month**. |
| Projects with areas | **4 of 66** (19 areas) | Room setup has happened almost nowhere. |
| Cards linked to areas (`card_areas`) | **3 of 3,269** | Effectively zero. |
| `area_steps` seeded / ever touched | 1,230 / **0** (all `not_started`, 0 events, 0 planned dates) | The entire step layer — checklists, editing UI, library — has never been used once. |
| Notifications ever created | **0** (incl. 0 readiness reminders) | The reminder/escalation system has never delivered anything. |
| Push tokens registered | **0** · staff rows: **2** | "Remind the whole team" — the team isn't in the system. |
| Attachment AI captions | **351 pending, 0 processed — ever** | **Background AI has never successfully run in production.** |
| Tanya usage | 13 sessions, **0 messages** | The dock has been opened; no one has ever asked it anything. |
| Latest events in prod | `"E2E test note 178292…"` | **E2E tests are writing into the production database.** |

Two additional ops facts: prod is **missing the last two migrations** (`20260628000001` lead-time learning, `20260628000002` card→step bridge) — so the just-merged AI bridge is deployed but **dormant** (it politely returns `migration_pending`), and the lead-time "apply" button will 404 (PGRST202) exactly like the earlier Pustaka incident. And since the *attachment* cron (same auth pattern, migration long since pushed) has processed 0 of 351 in weeks, the root cause is almost certainly **`CRON_SECRET` and/or `ANTHROPIC_API_KEY` missing in the Vercel production env (or crons disabled)** — which silently disables *every* AI/reminder feature at once.

**The multiplicative funnel.** For the new bridge to fire, an event must be (a) kind `work` (0.3% of events), (b) on a card with `card_areas` (0.1% of cards), (c) in a project with areas (6%), (d) with the migration pushed (not yet), (e) with crons/env working (never has). Expected throughput as shipped: **~zero events per month.** The bridge is correct code pointed at an empty pipe.

**The latent signal is real, though.** 57/200 board columns are room-named (`LANTAI 1 PANTRY`, `A09 — Detail Kamar Mandi`), 43/300 sampled card titles reference rooms (`Master bathroom`, `KUSEN KAMAR BATHROOM LT 3`). The team already tells the system *where* and *what* — in free text. The June audit (`docs/audit/gate-readiness-evaluation.md`) proposed exactly the assisted area-backfill this implies; it was never executed.

---

## 2. Workflow audit — capture side ("don't overcomplicate data entry")

*(full trace: capture-path audit; key files cited inline)*

- **Logging work is a 7–10-field form.** `AddEventForm` (web + mobile parity) requires picking an event kind, then for `work`: status enum, blocked_on, worker, role, scope, %, description, severity, location… The team's revealed preference is the 2-field `note`. **The form asks humans to pre-structure what the AI could extract.**
- **Area linking is a separate, optional, web-only chore.** Cards are created with no area (`packages/core/src/cards/create.ts`); linking requires finding the `CardAreas` dropdown on the card page afterwards (`apps/web/components/board/CardAreas.tsx`); **mobile has no area UI at all.** Only the AI chat-capture flow (`api/assistant/capture` → `ProposalCard` "Tautkan ke area…") links areas naturally — and it depends on areas already existing.
- **Silent failure everywhere.** `ai_step_status`/`ai_step_error` (`skipped: no_candidate_steps`) are shown in **no UI**; a supervisor who logs work on an unlinked card gets no hint that nothing downstream happened.
- **The draft/review gate for high-risk kinds is dead code.** `createCardEventDraft` has zero call sites; `work`/`vendor`/`decision` all insert directly.
- **Room context is typed twice.** The user writes "KM utama" in the title/text, then is expected to *also* pick the area, the event kind, the status enum. Duplicated intent = skipped intent.

**Conclusion:** data entry is already over-complicated relative to behavior — the fix is not more fields or discipline, it's letting AI structure what the team already writes, with one-tap confirmation.

## 3. Workflow audit — consumption side ("features and data used all together")

*(full trace: surfaces audit — 20 surfaces inventoried)*

- **The morning question takes 5–7 clicks across ≥4 islands**: Home (no signals) → `/brief` (the best aggregator: advisor feed + 6 sections + cascade + stale) → `/risiko` (the *only* place forecast/slip lives) → per-project `/schedule` (the only place step signals live) → boards. No single view answers "what needs doing today across my projects."
- **Three ranking systems disagree**: advisor score (board strip/brief), step-signal severity (schedule panel), slip-risk level (`/risiko`) — same reality, three vocabularies; gate signals appear in advisor but not the signal panel and vice-versa. Room "action tone" can visually contradict the gate matrix for the same area.
- **Reminders are hard to reach and unauditable**: web `/notifications` isn't in main nav (badge-only), escalation targeting is a black box ("who got paged and why" isn't shown anywhere) — and per §1, none has ever been sent.
- **Forecast is orphaned** from the page where scheduling decisions are made (`/schedule` doesn't show projected handover).
- **Steps/rooms surfaces render an empty world**: with 0 planned dates and 0 step activity, signals can literally never fire (`behind_plan`/`lead_time_risk` need `planned_*`; `silent` needs `in_progress`) — the engine's precondition (back-scheduled windows) was never computed even though 120 gate rows have targets.

## 4. Workflow audit — the AI layer

**Assistant (Tanya)** *(full trace: assistant audit)* — a well-built, citation-enforced, single-project **event search**. It cannot act as a PM because its context omits: the step list + dependencies (can't answer "apa langkah selanjutnya"), procurement/vendor/decision status ("apa yang belum dipesan"), planned dates & forecast ("kapan serah terima"), cross-project data ("proyek mana paling berisiko") — and it is single-turn (no follow-ups), 1024-token, read-only (can't set a reminder), and reactive-only. Usage: zero questions ever. The retrieval gaps are ironic: `getAreaSteps`, `getProjectForecast`, advisor cross-project mode all exist server-side, unqueried by `retrieval.ts`.

**The card→step bridge (#36)** *(full trace: trust audit — summarized; see §6 hardening list)* — sound plumbing, but as shipped: AI-made step updates render **anonymous** (null author, `source`/confidence not displayed), never link back to the originating card, and cannot be un-done in a way the user understands — while touching a step once **permanently disables AI updates for it** (precedence rule) with no warning. Skips are silent; an AI-inferred `blocked` flows into `blocking_timeline` signals → escalation → could page the principal off a hallucination with no confirm gate (the spec's propose→confirm was deferred). And per §1, it listens on `event_kind='work'` — the one kind nobody logs.

---

## 5. Optimization plan

Ordered so each phase makes the *previous investment* start paying before new surface is built. Phases 1–3 each become their own spec→plan per house convention; Phase 0 is an ops checklist, mostly Wilson-executed, ~a day.

### Phase 0 — Turn the engine on *(days; no product code)*

The single highest-leverage action in the entire system. Nothing in Phases 1–3 is measurable until this is done.

1. `supabase db push` from `packages/db` (applies `20260628000001` + `20260628000002`) + regen types. Fixes: bridge dormancy, lead-time-apply 404.
2. **Vercel production env:** set/verify `CRON_SECRET` and `ANTHROPIC_API_KEY`; confirm crons are enabled on the project. **Observable success:** the 351 pending attachment captions start draining within minutes (`ai_status=done` rising). This one signal validates the entire background-AI substrate that the bridge + reminders share.
3. **Onboard the team:** staff rows for every member (2 exist today), roles set (`trade_role` targeting depends on it), mobile app installed → push tokens registered (0 today). Without this, "remind the whole team" has no recipients.
4. **Stop E2E pollution of prod:** point Playwright at the CI Supabase only; add an env guard that refuses `E2E test` writes when the URL is the prod ref; clean existing test notes.
5. Instrument a tiny `/api/health/ai` (counts: attachments pending/done, card_events by ai_step_status, notifications last 7d) so "is it on?" is never a mystery again.

**KPIs after 1 week:** attachment captions done > 300; ≥1 readiness notification delivered; ≥1 AI step event written.

### Phase 1 — Meet the data where it is *(the pivotal slice — 1–2 weeks)*

Stop asking the team to change; make the engine read what they already produce. Three sub-slices:

**1a. Kind-agnostic step inference.** Widen the bridge's claim from `event_kind='work'` to any event carrying textual signal (`note`, `document`, `client_request`, `photo`-with-caption — captions exist once Phase 0 lands). Haiku already classifies; let it also decide *whether* an event is progress at all (add `is_progress` to the verdict schema; non-progress → `skipped: not_work`). This converts the real stream (≈120 events/month) into step signal, instead of the 1/month `work` stream. Cost impact at current volume: still under ~$5/month.

**1b. Area backfill + zero-friction linking.** (i) One-time assisted backfill per active project: AI reads card titles + topic names (57/200 topics are already room-named) → proposes areas + `card_areas` via the **existing** review queue — this is the June audit's proposal, still the right one, now with the extractor + apply-proposal code already built. (ii) At capture: auto-suggest area on every event (reuse the chat-capture `areaHint` logic inside `AddEventForm` as a pre-checked chip — one tap to unlink, zero taps to accept). (iii) Card-create inherits the topic's room when the column is room-named. (iv) Ship the missing **mobile** area chip. Target: % of new events with an area link goes 0.1% → >60%.

**1c. Give the schedule a spine.** Run the existing back-schedule against the 120 gate rows that already have targets → populate `area_steps.planned_*`; default kickoff-based windows for projects without targets. This is what lets `behind_plan`/`lead_time_risk`/forecast produce anything. Then **simplify the work form** (counter-intuitive but on-goal): kind auto-suggested, status/percent optional, free text + photo primary — AI structures it (propose-confirm chips, the `ProposalCard` pattern). Fewer fields than today.

### Phase 2 — One morning surface + AI you can see *(1–2 weeks)*

**2a. Promote `/brief` to THE dashboard.** Fold in the `/risiko` forecast table (projected handover + slip-days per project) and a per-project signal heat-strip; link it as the post-login landing (or first card on Home). Unify the three ranking vocabularies into the advisor's (signals feed advisor items instead of a parallel panel). `/schedule` gains the forecast line for its project. Kill nothing; consolidate entry.

**2b. The bridge trust loop** (fixes from the trust audit, §6): AI step updates get a visible `AI` badge + confidence + "dari kartu: <title>" link (data already on the row: `source`, `confidence`, `card_event_id`); one-tap **Benar / Koreksi** on each AI update (a confirm writes a cheap human event; a correction teaches Phase 4); card timeline shows the inverse link ("→ memperbarui langkah B4 ✓" or "tidak ada area tertaut — hubungkan?" — finally surfacing `ai_step_status`); AI-inferred `blocked` requires one-tap confirm **before** it can escalate to the principal; soften precedence from "any human event silences AI forever" to "human status wins for N days / until a newer card event" so checklists don't go permanently AI-dead.

**2c. Reminders people actually receive:** readiness kind visible in web `/notifications`; each reminder deep-links to the exact room/step; escalation transparency line ("dikirim ke: mandor, PIC"); after Phase 0's push tokens, verify delivery end-to-end.

### Phase 3 — Tanya becomes the PM *(2–3 weeks)*

1. **Feed it everything it's blind to** (all server-side code exists): step list + deps + planned/actual dates per room, decision & procurement status, forecast/slip, cross-project advisor mode for portfolio questions. Retrieval grows from "cards + 15 signals" to a real project state.
2. **Conversation**: replay session history (the tables already store it), raise output budget, and route PM-grade questions to a stronger model when needed (cost is trivial at this usage).
3. **Actions with confirm**: "ingatkan tim besok soal waterproofing" → creates a scheduled notification via propose→confirm; "tandai screeding selesai" → drafts a step event. The assistant becomes the *write* path with the human as gatekeeper — the same pattern as chat-capture.
4. **The daily brief becomes a Tanya message**: the 08:00 cron composes a conversational per-person digest (their trade's steps, today's risks, one question to answer), delivered as a push that opens the dock. Reminder + assistant + brief stop being three systems.

### Phase 4 — Learning & prediction *(after 4–6 weeks of real data)*
Duration/lead-time learning pages start receiving actuals (they're built, currently starved); add "AI was corrected" feedback from 2b into inference confidence; portfolio pattern reports ("waterproofing consistently starts 6 days late after material decisions").

### Adoption metrics (review weekly)
| Metric | Today | Phase 1 target |
|---|---|---|
| Events/mo the engine can read | ~1 | >100 |
| New events with area link | ~0% | >60% |
| Steps auto-updated /week | 0 | >10 |
| Reminders delivered /week | 0 | >5, opened |
| Tanya questions /week | 0 | >5 |

---

## 6. Bridge hardening list (from the trust audit — fold into Phase 2b)

- **Anonymous AI events (Critical):** `source`/`confidence`/`card_event_id` are written but selected **nowhere** — `getAreaStepEvents` (`lib/steps/queries.ts:127`) and the project activity feed (`lib/activity/step-activity.ts:64`) both omit them; StepDetail renders a blank author for AI rows → AI badge + confidence + "dari kartu: …" deep link.
- **Unreviewed consequential verdicts (Critical):** AI `blocked` flows straight into `blocking_timeline` (critical severity) → escalation to principal, no confirm gate → route `blocked` (and optionally `done`) through one-tap confirm before it can escalate.
- **Permanent AI-silencing precedence (Critical):** any human event disables AI for that step forever, with no warning at the moment of tapping and no re-enable path → recency-bound the precedence; warn on manual override; add re-enable.
- **Silent skips (Important):** `no_candidate_steps` / low-confidence outcomes surface in no UI → show `ai_step_status` on the card timeline ("tidak ada area tertaut — hubungkan?").
- **No watcher notification on AI step events (Important):** `notifyWatchersOfEvent` fires only for card events; an AI-marked `blocked` step notifies no one until the daily cron → notify watchers for high-impact AI step events.
- **Multi-area cards:** duplicate step codes across areas collide in `selectApplicableMatches` (last-wins) → per-area candidates in the prompt or area-scoped codes.
- **Timing:** gate recompute is instant, step inference seconds-to-15-min behind → cheap staleness hint on the rooms panel ("AI sedang membaca aktivitas…").
- **Cosmetic:** AI `done` writes `percent_complete=100` while human `done` leaves it null — history rows render asymmetrically → standardize.

## 7. What is genuinely good (keep, don't churn)

The card event log as single source of truth; gates derived not typed; the pure/testable engine layers (signals, back-schedule, forecast, precedence); the outbox+cron+structured-output AI substrate; the review-queue pattern; `/brief` as aggregator seed; the uniform A–H room library with management UI; RLS discipline. The system's bones are right — this plan is about connecting lungs to airways, not surgery on the skeleton.
