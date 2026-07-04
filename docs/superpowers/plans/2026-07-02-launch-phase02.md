# Launch Readiness Phase 2 Implementation Plan — One Morning Surface + AI You Can Trust

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, task-by-task.

**Goal:** Consolidate the morning workflow onto `/brief` (pulse + forecast + priorities in one place) and make the AI's step updates visible, attributable, correctable, and safe — per audit §5 Phase 2, §6 hardening, and live persona bugs B3/B4/B5.

**Tech Stack:** as Phase 0+1 (same worktree/branch conventions; branch `feat/launch-phase02` stacked on `feat/launch-phase01`).

## Global Constraints
Same as Phase 0+1 plan (Node 22 PATH, never `git add -A`, local stack 553xx, per-task gates, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`). Bahasa Indonesia for all user-facing copy, matching existing tone.

---

### Task 1: AI attribution end-to-end (badge + confidence + card link)

**Files:** `apps/web/lib/steps/queries.ts` (getAreaStepEvents select + AreaStepEventRow type), `apps/web/lib/activity/step-activity.ts` (same), `apps/web/components/schedule/StepDetail.tsx` (history rows), the project activity feed item component (find via step-activity usages), mobile inbox/activity equivalents if they render step events (grep `area_step_events` in apps/mobile + core); tests.

**Requirements:** select `source`, `confidence`, `card_event_id` everywhere step events are read; render for `source='ai'`: a small "AI" chip + confidence as `0.95` tooltip/text + link "dari kartu →" resolving `card_event_id` → its card page anchor (queries must join enough to build the href — card slug + project code; extend the select with `card_events(card_id, cards(slug, project_id))` or a second lookup — pick the cheapest correct join and keep it one round-trip). Null-author AI rows must no longer render a blank author (show "Asisten AI"). Human rows unchanged.

---

### Task 2: Correction loop + recency-bounded precedence

**Files:** `apps/web/lib/steps/status.ts` (applyPrecedence), `apps/web/components/schedule/StepDetail.tsx`, `apps/web/lib/steps/actions.ts`, tests (`step-status-precedence.test.ts` + new).

**Requirements:**
1. Precedence change (design decided in audit): human events outrank AI **only for AI events whose occurred_at ≤ the newest human event's occurred_at + 7 days**? — NO: simpler + predictable rule chosen: an AI event is ignored iff a human event with occurred_at **≥ that AI event's occurred_at** exists on the step (newest-information-wins; human wins ties). This un-deadlocks steps permanently silenced by one old human tap while never letting AI override a *newer* human statement. Update tests to the new rule (keep back-compat: absent source = human).
2. StepDetail: on each AI event row add one-tap **"Benar"** (writes a human confirming event, same status — cheap, locks it) and **"Koreksi"** (opens the existing status buttons; the human event then outranks). Both via existing `submitStepUpdate` action (extend args if needed).
3. When a user manually sets status on a step that has newer AI events, show a one-line hint "Update AI yang lebih baru akan diabaikan" (no modal).

---

### Task 3: Confirm-gate before AI 'blocked' escalates + watcher notification

**Files:** `apps/web/lib/steps/run-inference.ts` or `mutations.ts` (where AI events insert), `apps/web/lib/steps/signals.ts` or its query layer (where blocked feeds blocking_timeline), notification producer (`apps/web/lib/notifications/producers.ts`, core producers), tests.

**Requirements:**
1. AI-authored `blocked` events do NOT flow into `blocking_timeline`/escalation until confirmed: implement by having `projectStepStatus`'s blocked branch ignore AI-sourced blocked (treat as in_progress-with-note) unless a human event confirms, **and** surface the unconfirmed block prominently: notify the step's trade-role recipients + card watchers "AI mendeteksi kemungkinan terblokir: {step} — konfirmasi?" (reuse notification producer; kind `watcher_event` or the readiness kind — pick what renders on both web+mobile inboxes) with a deep link to the room/step.
2. Non-blocked AI statuses keep flowing (they're low-risk).
3. Watcher notification for AI `done` on H-gate/inspection steps too? NO — YAGNI; blocked only.
4. Tests: projection treats AI-blocked as non-blocking; notification intent produced once (dedup on step+card_event).

---

### Task 4: Card timeline shows what AI did (incl. skips)

**Files:** card timeline event renderer (`apps/web/components/board/…` — find where card_events render on the card page), `apps/web/lib/cards/queries.ts` (event select + ai_step_status), tests.

**Requirements:** each event row that was processed by inference shows a subtle result line: `done` + matches → "AI: memperbarui langkah {names}" (needs the reverse lookup: area_step_events by card_event_id — one grouped query for the page); `skipped/no_candidate_steps` → "AI: kartu belum tertaut ke ruangan — tautkan agar progres terbaca" with the Task-5(P1) chip/link; `skipped/not_progress` → nothing (silent is right); `failed` → "AI: gagal membaca — akan dicoba lagi". Degrade silently when columns absent (prod pre-push).

---

### Task 5: /brief becomes the dashboard — pulse + forecast + today

**Files:** `apps/web/app/(app)/brief/page.tsx`, `packages/core/src/brief/get-brief-data.ts` (or a new lib fn web-side if core untouched is simpler — prefer core so mobile brief inherits), `apps/web/lib/steps/slip-risk-queries.ts` / forecast queries (reuse), mobile brief consumers if core shape changes (root gates!), tests for pure assembly.

**Requirements:**
1. New top section **"DENYUT KEMARIN–HARI INI"** (the pulse): step events + card events from the last 48h across the user's projects (grouped by project → room/card, max ~10 rows, AI-attributed where source='ai'), so the brief leads with what's HAPPENING (live finding: today's 80% waterproofing appeared nowhere).
2. Fold in forecast: per-project row (from `/risiko`'s `getProjectsSlipRisk`/`getProjectForecast`) — projected handover + slip-days + bottleneck, linked to the project schedule. `/risiko` page stays (deep view) but the brief carries the summary.
3. Demote stale-card items: cap "Tanpa aktivitas" items to 3 with a "lihat semua" link (they currently drown the list — 20-month imports).
4. Keep all existing sections; this is additive layout + 2 new data sections.
5. Mobile brief gets the same via core assembly (if shape changes are core-side); verify mobile tests.

---

### Task 6.5 (added by Phase-1 whole-branch review): Recompute hardening

**Files:** `apps/web/lib/cards/mutations.ts`, `apps/web/lib/steps/run-inference.ts`, `packages/core/src/gates/recompute.ts`, tests.

**Requirements:** (1) Dedup the double recompute per request: when `processPendingStepInference` already recomputed a project, the trailing unconditional `recomputeProjectGatesSystem` for that project must be skipped (thread the recomputed-project set or reorder). (2) Batch `recomputeProjectGates`'s per-cell sequential upserts into one bulk `upsert([...])` (A×8 rows) — same result, one round-trip. Unit-test the dedup; core change ⇒ ROOT gates.

### Task 6: Coherence fixes — risk vocabulary, stage chip, decision outcome, renderer tolerance, blob truncation

**Files:** `apps/web/lib/steps/slip-risk.ts` (level derivation), rooms stage derivation (`packages/core` or `apps/web/lib` — find where "Gate H Serah Terima berjalan" text is built), decision resolve action + dialog (`Tandai diputuskan` flow), the card timeline decision renderer, `RoomStepsPanel`/`RoomRow` flags line; tests.

**Requirements (each small, bundled to one task):**
1. **B5:** slip-risk level must incorporate forecast slip: if projected handover > target ⇒ at_risk (>0 days) / behind (>14 days) even when signals are silent. "Aman + 34 hari telat" must be impossible. Unit-test the matrix.
2. **B3:** stage derivation: ignore gates whose status is `not_started`/stale-default when picking the stage label; with no meaningful gate signal, derive from the furthest step-with-activity's gate (BW2 active ⇒ "Gate B · Pekerjaan Basah"), else "Belum mulai". Unit-test with the live-bug fixture.
3. **Decision outcome capture:** "Tandai diputuskan" opens a one-field inline input "Apa keputusannya?" (optional but encouraged) → stored into the payload (`decision`/`outcome` field per the zod schema — check `packages/types/src/event-kinds.ts`) so the record and the AI can use it.
4. **Renderer tolerance:** decision (and generally event) timeline renderer falls back through payload fields (question/summary/body/description) — never prints "undefined".
5. **Mobile blob:** room flags line truncates to 3 named steps + "+N lainnya".

---

## Self-review notes
- Sources: audit §6 items 1–8 → T1–T4; §5 Phase 2a → T5; live bugs B3/B5 + Carissa/Budi findings → T6. Reminders-web-visibility from audit: `/notifications` shows all kinds already (verified in code); reachability improves via T5's pulse; escalation transparency deferred to Phase 3's conversational brief (noted, not dropped).
- Order: T1 → T2 → T3 → T4 (all touch step-event surfaces; sequential to avoid conflicts) → T5 → T6.
- Cross-package: T5 (core brief) and T6 (core stage derivation, if it lives in core) require ROOT typecheck+test gates.
