# Launch Readiness Phase 3 Implementation Plan — Tanya Becomes the PM

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, task-by-task.

**Goal:** Turn the assistant from a citation-checked event search into the project manager: it sees the full project state, remembers the conversation, can take confirm-gated actions, and delivers the daily brief conversationally — per audit §5 Phase 3 and the assistant capability audit. The live persona test proved model quality is sufficient when context is supplied; every gap below is a data/plumbing gap, not a model gap.

**Tech Stack:** as prior phases; branch `feat/launch-phase03` stacked on `feat/launch-phase02`.

## Global Constraints
Same as Phase 0+1/2 (Node 22 PATH, never `git add -A`, local stack, per-task gates, Bahasa copy, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`). Keep Haiku via `getModel()` as default; do not swap models without a measured reason. Respect RLS: all retrieval through the caller's supabase client (never admin) so each persona's assistant sees only their projects — add a test asserting the queries run on the user client.

---

### Task 1: Retrieval sees the whole project (steps, deps, dates, decisions, procurement, forecast)

**Files:** `apps/web/lib/assistant/retrieval.ts` (+ its formatters), reuse `getRoomStepViews`/`getAreaSteps`, `trade_step_deps` fetch, `getProjectStepSignals`, `getProjectForecast`, decision/procurement queries (advisor's decision query in `packages/core/src/advisor/get-advisor.ts` as reference); token-budget constants; tests (`assistant-retrieval.test.ts` exists — extend).

**Requirements:**
1. Add compact KONTEKS sections (each capped, severity/relevance-sorted, formatted like existing ones): **LANGKAH PER RUANGAN** (per room: active + next 3 pending steps with planned dates and status incl. AI-sourced marker), **KEPUTUSAN TERBUKA** (decision-kind events with status needs_decision + decision-type steps not done), **PENGADAAN/ORDER** (procurement-type steps: not-started-with-lead-time-risk first), **PERKIRAAN** (project forecast: projected handover, slip-days, bottleneck).
2. Budget: keep total context under ~20k tokens — introduce per-section row caps and a tiny truncation note ("+N lainnya"). Cited tokens: steps get `[step:CODE ROOM]`-style tokens only if the citation system can render them; otherwise cite via the room name in text (do NOT break the existing `[card:]/[event:]` citation contract — check `extractCitations`).
3. When the question mentions a room (simple name match against areas), bias that room's section to full detail.
4. Tests: fake data → context contains the four sections, caps respected, RLS client used.

### Task 2: Conversation memory + PM system prompt

**Files:** `apps/web/lib/assistant/anthropic.ts`, `apps/web/app/api/assistant/message/route.ts`, audit/session storage (`lib/assistant/audit.ts`), tests.

**Requirements:** replay up to the last 8 messages of the session (they're already stored) as proper user/assistant turns (context block only on the newest turn to protect the cache: system + history + fresh KONTEKS+question); raise `max_tokens` to 2048; extend the system prompt to the PM persona: still citation-bound and context-only, but instructed to (a) lead with the direct answer, (b) proactively flag the top risk it sees in KONTEKS when relevant, (c) offer at most one follow-up action from the action list (Task 3). Keep Bahasa. Update streaming route accordingly; keep prompt caching valid (system block byte-stable — no timestamps).

### Task 3: Confirm-gated actions (reminder + step update + decision record)

**Files:** new `apps/web/lib/assistant/actions.ts` (schema + executors), `apps/web/app/api/assistant/message/route.ts` (structured action proposals), `apps/web/components/chat/ChatDock.tsx` + mobile chat (render proposal chips → confirm), reuse `updateAreaStep`/notification producer/decision resolve; tests.

**Requirements:**
1. The assistant may end its reply with ONE proposed action as a structured block (use `output_config`-style JSON? — the reply is streamed text; simplest robust approach: a fenced `<action>{json}</action>` tail the client parses; schema: `{type: "remind"|"update_step"|"record_decision", args...}`). Server validates against a zod schema; invalid → ignored.
2. Rendering: a chip under the message ("🔔 Ingatkan Budi besok: flood test KM-1 — Kirim?") with Confirm/Batal. Confirm calls a server action that executes: remind → `notifications` row(s) via existing producer (+push if tokens exist) targeted at a named staff or trade-role; update_step → `updateAreaStep` (human-sourced, author = the confirming user); record_decision → the decision-resolve mutation with outcome text.
3. NOTHING executes without the user's tap. Audit-log executed actions (assistant_query_audit or notification metadata).
4. Tests: parser (valid/invalid/absent action blocks), executor authorization (uses caller client/session, not admin).

### Task 4: The daily brief becomes a Tanya message (conversational + push)

**Files:** `apps/web/app/api/cron/readiness-reminders/route.ts` + `lib/steps/reminders.ts` (compose step), new pure `lib/assistant/daily-brief.ts`, notification producer, tests.

**Requirements:**
1. Per recipient (staff with role/trade mapping — existing resolver), compose a SHORT personal brief (pure function over the same signal/forecast data: "Pagi {name} — 3 hal hari ini: 1) … 2) … 3) …", ≤ 600 chars, deep link `/brief`), delivered as a notification (existing kind) + push when tokens exist. No model call in the cron (deterministic compose from signals — cheap, reliable); the "conversational" part = tapping it opens the dock with the brief pre-seeded as an assistant message and the user can ask follow-ups (wire via the existing seeded-prompt mechanism, seeding an ASSISTANT-authored first message variant).
2. Escalation transparency: the notification body names who else was notified ("juga dikirim ke: mandor").
3. Keep the existing per-signal reminder dedup; the personal brief replaces N separate rows with one digest per person per day (dedup key person+date).
4. Tests: compose function (content, caps, escalation line), dedup key.

### Task 5: Cross-project PM mode (principal's portfolio question)

**Files:** `apps/web/lib/assistant/retrieval.ts` (portfolio branch), route param, ChatDock entry from `/brief` (project-less context), tests.

**Requirements:** when invoked without a project (from /brief), build a PORTFOLIO KONTEKS instead: per active project one row (forecast, top signal, open decisions count) via existing cross-project queries (`getProjectsSlipRisk`, advisor cross-project mode) — capped 15 projects; answers "proyek mana paling berisiko?", "apa 3 hal terpenting hari ini?". RLS keeps it to the caller's visible projects. Dock on /brief gets an entry button ("Tanya asisten portofolio").

---

## Self-review notes
- Maps to audit Phase 3 items 1–4 exactly; assistant-audit Tier-1 gaps (steps/procurement/decisions/forecast) = T1; Tier-2 (multi-turn, cross-project, write) = T2/T3/T5; proactive = T4.
- T3's action tail format is deliberately simple (fenced JSON) — structured outputs can't constrain a streamed prose+action hybrid; the zod validation gate makes it safe.
- Order: T1 → T2 → T3 → T4 → T5 (each builds on prior).
- Root gates where core is touched; mobile chat parity in T3 limited to rendering chips (mobile executes via existing Bearer routes — verify reachable; else note follow-up).
