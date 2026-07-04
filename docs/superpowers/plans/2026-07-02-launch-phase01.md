# Launch Readiness Phase 0+1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make the readiness engine consume the data the team actually produces (notes/documents/photos, mostly area-unlinked) and remove the ops blind spots — per the audit (`docs/audit/2026-07-02-card-progress-ux-audit.md`) and live persona findings (`docs/audit/2026-07-02-persona-test-findings.md`).

**Architecture:** All changes ride existing rails: the outbox+claim+Haiku bridge, the areas extractor/apply-proposal machinery, the back-schedule module, the cron auth pattern. One new migration. No new services.

**Tech Stack:** Next.js 16 (apps/web), Expo (apps/mobile), Supabase migrations (packages/db, local stack on ports 553xx), `@anthropic-ai/sdk`, vitest.

## Global Constraints

- Branch `feat/launch-phase01` in worktree `/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/audit`. **Never `git add -A`** — the worktree carries uncommitted local-env files (`packages/db/supabase/config.toml` port remap, `.env*`); stage only your task's files explicitly.
- Node 22 required: `export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"` before any pnpm/node command.
- A LOCAL Supabase stack runs on ports 553xx (API http://127.0.0.1:55321). Apply migrations there with `cd packages/db && supabase db reset` (or `supabase migration up`) and smoke via `docker exec supabase_db_db psql -U postgres -d postgres -c "..."`. Do NOT run `supabase db push` (that targets prod).
- New migration filename prefix: `20260702...`. Migrations additive/idempotent (`create or replace`, `drop index if exists` + recreate is OK for indexes).
- Model via `getModel()`; prompt caching via `cachedSystemBlock`; structured outputs via `output_config.format`. No assistant prefill.
- Pure logic no-Supabase + unit tests in `apps/web/tests/unit/`. `noUncheckedIndexedAccess` — guard indexed access.
- Gate per task: focused vitest run + `pnpm -C apps/web typecheck`. Before the branch is done: root `pnpm typecheck` + `pnpm test` + `pnpm --filter web build` (any `@datum/core` change → root gates mandatory).
- Commit per task with a conventional message; end commits with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Bridge correctness — occurred_at propagation + no future-intentions + percent symmetry

**Files:** Modify `apps/web/lib/steps/mutations.ts` (applyStepInference), `apps/web/lib/steps/run-inference.ts`, `apps/web/lib/steps/infer.ts` (prompt), `apps/web/tests/unit/apply-step-inference.test.ts`, `apps/web/tests/unit/step-infer.test.ts`.

**Requirements (from live bugs B1/B2 + trust audit):**
1. `applyStepInference` gains `occurredAt: string` in its args and writes it as the inserted event's `occurred_at`; `processPendingStepInference` passes `ev.occurred_at`. (Today AI events default to now() → an older card event processed later overrides newer state — observed live.)
2. In `buildInferencePrompt`'s ATURAN block add (Bahasa, matching style): report ONLY work that has started/finished; plans/intentions ("akan", "besok", "siap mulai") are NOT progress — omit those steps.
3. Stop force-writing `percent_complete: 100` on done (write `null` unless a percent is in the event text — keep it simple: always `null`; status carries done-ness). Update the existing test asserting 100.
4. Tests: applyStepInference passes occurred_at through (fake supabase captures it); prompt contains the new rule text.

**Verify:** `pnpm -C apps/web exec vitest run apply-step-inference step-infer run-inference` + typecheck.

---

### Task 2: Kind-agnostic inference (the pivotal change)

**Files:** Create `packages/db/supabase/migrations/20260702000001_kind_agnostic_inference.sql`; modify `apps/web/lib/steps/infer.ts` (summarize + schema + parse), `apps/web/lib/steps/run-inference.ts`, `apps/web/lib/cards/mutations.ts` (both `after()` triggers), `packages/db/src/types.generated.ts` (only if RPC signature changes — it doesn't), tests.

**Requirements:**
1. Migration: `create or replace` `claim_card_events_for_step_inference` with filter `event_kind in ('work','note','document','photo','client_request')` (was `='work'`); `drop index if exists card_events_ai_step_pending_idx` and recreate with the same widened predicate. Comment why (team logs notes 89:1 vs work).
2. `summarizeWorkEvent(payload)` → rename/extend to `summarizeEventText(kind, payload)` handling per-kind payload shapes: work (status/description/notes/blocked_on/percent), note (`body`), document (title/description/body fields — read the zod schemas in `packages/types/src/event-kinds.ts` for exact keys), photo (caption/description), client_request (request/body). Return "" when no text. Keep a back-compat export if other callers exist (grep first).
3. Verdict schema gains `is_progress: boolean` (top-level, required). Prompt: first decide whether the note reports physical work progress at all; if not (design chatter, scheduling, client talk) → `is_progress:false, matches:[]`.
4. Runner: `is_progress === false` → mark event `ai_step_status:'skipped', ai_step_error:'not_progress'` (counts as skipped).
5. `createCardEvent` + `approveCardEventDraft` `after()` triggers fire for the widened kind set (extract a shared `INFERABLE_KINDS` const in `apps/web/lib/steps/infer.ts` and import it in both).
6. Apply migration to the LOCAL stack and smoke: insert a `note` card event via psql on a card linked to an area → run `select count(*) from claim_card_events_for_step_inference(5)` → expect it claimed.
7. Tests: summarizeEventText per kind (incl. empty), parse with is_progress, selectApplicableMatches unchanged.

**Verify:** focused vitest + typecheck + local-stack smoke output in report.

---

### Task 3: Phase-0 code — /api/health/ai + e2e prod guard

**Files:** Create `apps/web/app/api/health/ai/route.ts`, `apps/web/tests/unit/health-ai.test.ts`; modify `apps/web/playwright.config.ts` (or its global setup).

**Requirements:**
1. GET route, bearer `CRON_SECRET` (reuse `isCronAuthorized` from `@/lib/cron/auth`). Returns JSON: `card_attachments` by `ai_status`, `card_events` by `ai_step_status`, `notifications` count last 7 days, newest `area_step_events.created_at` where source='ai'. Admin client. On missing columns (pre-push prod) degrade gracefully (per-section try/catch → `"unavailable"`).
2. Playwright: hard-fail before tests when the target Supabase URL contains the prod ref `nsmyazmxwdvwtdtqjrpx` (read env in config/global-setup; throw with a clear message). Prod data already got polluted by e2e notes — this closes it.
3. Unit-test the pure aggregation helper (shape from fake rows).

**Verify:** focused vitest + typecheck; curl the route locally with the local CRON_SECRET (`local-test-secret`) and paste output in the report.

---

### Task 4: Self-healing readiness — auto-recompute + planned windows

**Files:** Investigate then modify `apps/web/lib/cards/mutations.ts`, `apps/web/lib/steps/mutations.ts` (writePlannedDates), possibly `apps/web/components/schedule/AreaTargetEditor.tsx`'s action; tests.

**Requirements (live bug B4 + audit Phase 1c):**
1. Diagnose why "8 stale" persisted on /brief after Budi's work event despite `recomputeProjectGates` being fire-and-forget in `createCardEvent` (read the recompute + stale-trigger path; likely the recompute ran before triggers/other-kind events marked more cells, or the event kind isn't in GATE_RELEVANT_KINDS for notes). Fix so stale cells self-heal: move the recompute into the same `after()` used for inference, fire it for ALL event kinds that mark stale (mirror the DB trigger's kinds), and make the inference `after()` ALSO recompute after writing step events.
2. Ensure planned windows exist once targets do: verify the target-save action calls `writePlannedDates`; add a kickoff-fallback: when a project has `kickoff_date` but an area has no gate targets, derive default windows via the existing gate-schedule logic (`compute_area_gate_schedule` migration / core fn — investigate what exists and wire the minimal call) so `area_steps.planned_*` stops being universally null (signals need it — currently they mathematically cannot fire).
3. Acceptance (manual, local): log a note event via the UI or psql → within the request lifecycle stale count for that project returns to 0 (query `area_gate_status.stale`); setting a target on an area populates `planned_start/planned_end` on that area's steps (psql check).

**Verify:** focused tests for any pure logic touched + typecheck + psql evidence in report.

---

### Task 5: Deterministic area hint at capture (web) + card-create room inheritance

**Files:** Create `apps/web/lib/areas/match-hint.ts` + `apps/web/tests/unit/area-match-hint.test.ts`; modify `apps/web/components/board/AddEventForm.tsx`, `apps/web/components/board/AddCardForm.tsx` (or the create action), `apps/web/lib/cards/mutations.ts` if the link-write needs a server action param.

**Requirements:**
1. Pure matcher `suggestAreaForCard({ cardTitle, topicName, areas })`: normalized token match of topic name first (e.g. "LANTAI 1 KITCHEN" → area named "Kitchen Lt.1" / code "L1-KITCHEN"), then card title tokens (kamar mandi/km/bathroom→bathroom areas; kitchen/dapur/pantry; bedroom/kamar tidur; living/ruang tamu; floor tokens "lt 1/lantai 1"→Lt.1). Return best match + null when ambiguous (2+ equal candidates) — no AI call, zero latency.
2. AddEventForm: when the card has NO linked area and the matcher finds one, render a small pre-checked chip "Tautkan ke {area_name}" above Simpan; on submit with chip checked, link `card_areas` (reuse `linkCardToArea` via a server action) before/with the event insert so inference sees it. Unchecked = no link. No chip when no match.
3. Card creation: when the topic is room-matched, auto-link the new card to that area (same matcher, server-side in the create action).
4. Tests: matcher cases (topic exact, title tokens, floor disambiguation, ambiguous→null).

**Verify:** focused vitest + typecheck + `pnpm --filter web build`; browser-verify on local (add event on the unlinked "kusen pintu master bedroom" card → chip suggests Master Bedroom Lt.2; submit; psql shows card_areas row + inference claimed it) — the dev server on port 3012 is already running against the local stack; report evidence.

---

### Task 6: Mobile parity — show + link areas on the card screen

**Files:** Investigate `apps/mobile/app/**/cards/**` and `apps/mobile/components/card/*`; likely create `apps/mobile/components/card/CardAreas.tsx`; core query/mutation reuse from `@datum/core` (area-link functions live in `packages/core/src/cards/area-link.ts`).

**Requirements:**
1. Card screen shows linked areas (names) and a picker to add one (project areas list). Uses the same core mutations the web uses (`linkCardToArea` / unlink equivalent) through mobile's existing supabase client pattern (mirror how other mobile mutations call core).
2. Keep it visually consistent with the existing mobile card sections; Bahasa labels ("Area terkait", "+ Tautkan area").
3. If mobile AddEventForm can cheaply reuse the Task-5 matcher for a pre-checked chip, do it; if it needs new plumbing, note as follow-up instead (don't gold-plate).
4. Tests: any pure logic reused is already tested; component snapshot/unit per existing mobile test conventions (`apps/mobile` has jest tests — follow the nearest example).

**Verify:** `pnpm -C apps/mobile test` (or targeted) + **root** `pnpm typecheck` (core touched ⇒ root gate) — mobile fixture gotcha applies.

---

### Task 7: Area backfill for existing cards (surfaced, review-gated)

**Files:** Investigate `packages/core/src/areas/apply-proposal.ts`, `apps/web/lib/areas/extract.ts`, `apps/web/components/area-setup/AreaSetup.tsx` / `components/settings`; extend the settings Area tab.

**Requirements:**
1. Verify what the existing AI area-proposal flow already does with existing cards (apply-proposal inserts `card_areas` for assignments). If assignments already cover existing unlinked cards, the task = make it reachable+repeatable: a "Tautkan kartu ke ruangan (AI)" action on the settings Areas tab that runs extraction over ACTIVE, UNLINKED cards only (skip already-linked), shows the standard proposal review UI, and applies on approve.
2. Cap batch size (e.g. 100 cards) and show counts ("42 kartu belum tertaut"). Non-matching cards are simply left unlinked (no forced guesses).
3. Prompt/extraction reuses the existing extractor; no new model plumbing.
4. Tests: pure filtering (unlinked-active selection, cap) unit-tested; proposal/apply already covered by core tests.

**Verify:** focused vitest + typecheck + build; local browser spot-check (settings → run backfill on BDG-H1 → granit/kusen cards get proposals) with evidence in report.

---

## Self-review notes
- Spec coverage: audit Phase 0 code items (health, e2e guard) = T3; Phase 1a = T2 (+T1 correctness); 1b = T5/T6/T7; 1c = T4. Ops items (db push, Vercel env, staff onboarding) are Wilson's — listed in the PR body, not tasks.
- Type consistency: `INFERABLE_KINDS` defined once (T2) and imported by triggers; `summarizeEventText` replaces `summarizeWorkEvent` with grep-verified call sites (T2); matcher exported from `lib/areas/match-hint.ts` used by web form + create action (T5) and optionally mobile (T6).
- No placeholders; investigate-then-fix tasks (T4, T6, T7) name the exact files to read and the acceptance evidence required.
