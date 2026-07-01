# Card-Derived Readiness — Design

**Date:** 2026-06-27
**Status:** Design approved (Wilson). Re-scoped after discovering Slices 0/A already exist on `main`.
**Scope of this doc:** the card→step AI bridge that makes per-room steps derive their status from card activity. The room-type step *catalog* already exists on `main` (PRs #24/#25); this doc builds the missing **perception** layer on top of it.

---

## 0. State of the world (verified against `main`, 2026-06-27)

Two layers compute readiness today, and only one is card-derived:

- **Cards → Gates is derived from reality.** `card_event` of kind `work` carries `{status, percent_complete, blocked_on}`; an insert fires a staleness trigger; `evaluateGate()` ([packages/core/src/gates/readiness-rules.ts](../../../packages/core/src/gates/readiness-rules.ts)) reads the latest work-event per card → `area_gate_status`. Nobody types gate status by hand.
- **Steps → (nothing) is a manual checklist, now per-room.** **PR #24** (`a53a4ab`, merged) reframed Gate B into a "wet-works" phase, added **`applies_to_area_types text[]`** to `trade_steps`, seeded a **uniform A–H step library across every room type**, generalized `seed_area_steps`/`add_catalog_area_step`/`add_custom_area_step`, made `createArea` seed new rooms, and renders per-room steps on the **rooms page** (`getRoomStepViews` → `RoomStepsPanel`). **PR #25** added the "Pustaka Langkah" management UI. But step **status is still set only by hand** (`StepDetail.tsx` buttons → `area_step_events`) — `area_steps` have **zero** linkage to cards. Creating a card, logging "waterproofing done", moving a card — none of it touches a step.

So every room now has its expected A–H checklist, but those checklists are filled in manually and contradict the card-derived gates for the same room.

## 1. What's already done vs. what this doc adds

| Layer | Status |
|---|---|
| **Area typing** (`area_type` per room) | Mostly moot — PR #24 seeds **every** room a uniform A–H library regardless of type; `applies_to_area_types` only tunes *which* room-specific steps seed. Mis-typed rooms still get general coverage. A correction affordance is a minor nice-to-have, not a blocker. |
| **Room-type step catalog + per-room dropdown + library mgmt** | **DONE on `main`** (PR #24 + #25). This is what the original "room-type dropdown" idea asked for. |
| **Card → step status bridge** | **MISSING — this doc.** The perception layer that makes seeded steps derive status from cards. |
| **Propagation + gaps** | **MISSING — this doc.** Cross-trade "bridging" + "what you missed", off the existing dep/signal engine. |

The auto-seed that `main` already does is **correct** *given this bridge*: seeding the expected A–H steps per room is only "deterministic fiction" ([docs/audit/gate-readiness-evaluation.md](../../audit/gate-readiness-evaluation.md)) while their status is hand-typed and rots. Once cards drive the status, the seeded checklist becomes a live, reality-tracking surface. (This retracts the earlier draft's "drop auto-seed" recommendation — auto-seed + bridge is the right combination.)

## 2. Vision

**Cards are the source of truth. The per-room A–H steps (already seeded) get their status inferred from card activity. Cross-trade "bridging" and "what you missed" fall out of diffing the expected steps against what cards show.** This matches the audit's inversion principle: *the machine reads the work; humans only confirm.*

## 3. Architecture — the two missing layers

| Slice | What it is | Depends on | AI |
|---|---|---|---|
| **B — The bridge** | Async outbox + Vercel cron + Haiku 4.5 (structured output): each `card_event` → matched seeded step + status (incl. `blocked_on`) + affected trades. Writes step status via propose→confirm. | catalog on `main` (done) | Haiku 4.5 per card |
| **C — Propagation + gaps** | Feed inferred status into the **existing** `trade_step_deps` / signal engine → cross-trade cascade ("bridging") + "what you missed" reminders. | B | none (deterministic) |

**Core principle: AI = perception (Slice B), deterministic rules = propagation (Slice C).** The AI only reads each card and classifies it; it never computes the dependency cascade. Bridging falls out of the existing [signals.ts](../../../apps/web/lib/steps/signals.ts) (`blocking_timeline` / `lead_time_risk`) fed by AI-inferred status.

## 4. Data model (Slice B)

The catalog model already exists (`trade_steps` + `applies_to_area_types` + `area_steps` + `area_step_events`). Slice B adds only the inference plumbing:

- An **outbox flag** on `card_events` (or a small `card_event_analysis` queue table) marking "needs analysis", set on insert — mirrors the existing `mark_areas_stale` trigger pattern.
- AI verdicts land as a new **source of `area_step_events`** (provenance marker + confidence), so the existing projection in [status.ts](../../../apps/web/lib/steps/status.ts) still derives `area_steps.status` — AI is just another event author alongside manual UI.
- Consequential verdicts route through the existing `data_drafts` / review-queue (propose→confirm).
- **Precedence:** a human-confirmed status must outrank a later low-confidence AI verdict — define explicitly in the projection so a stale inference can't override a person.

## 5. The AI pipeline (Slice B)

**Task per card:** read the work entry → match a seeded step for that room → infer status (`in_progress`/`done`/`blocked` + `blocked_on`) → identify affected trades/areas. A single **classification/extraction** call, not an agent.

**Model: Haiku 4.5** (`claude-haiku-4-5`, $1/$5 per M) — the model the app already uses for area extraction, attachment captions, and the assistant. **Prompt caching** on the static prefix (instructions + the room's seeded A–H steps + dependency graph + output schema); **structured outputs** (`output_config.format`) to force the JSON verdict (no prefill).

**Run mode: async outbox + Vercel cron** (decided). Card insert flags "needs analysis"; a cron (Vercel Pro) claims N pending events, runs Haiku, writes verdicts back — the exact shape of [analyze-attachments/route.ts](../../../apps/web/app/api/cron/analyze-attachments/route.ts). Decouples AI latency/failures from the write path; gives retry/backoff; batches; survives spikes.

**Cost (Haiku 4.5, cached prefix):**

| Component | Tokens | Rate | Cost |
|---|---|---|---|
| Cached prefix (room steps + rules + schema) | ~2,500 | $0.10/M (cache read) | $0.0003 |
| Fresh input (card + event + area step snapshot) | ~1,200 | $1/M | $0.0012 |
| Output (structured JSON verdict) | ~300 | $5/M | $0.0015 |
| **Per card** | | | **≈ $0.003–0.005** |

At 100 / 300 / 1,000 card-events per day → **~$12 / ~$36 / ~$120 per month**. Negligible. Opus 4.8 ≈ 5× for no benefit on classification; reserve it for a possible low-frequency cross-project "what did the team miss" synthesis. **No AWS** — the outbox+cron pattern already lives in-repo (attachment analysis); Vercel + Supabase + Anthropic is the whole stack. Batch API (50% off, ≤1h) isn't worth the freshness hit given the trivial cost.

## 6. Slice-by-slice

### Slice B — The bridge
- Outbox flag + claim/lease cron; Haiku call with cached prefix + structured output; verdict → AI-authored `area_step_events` → existing projection.
- Propose→confirm: high-confidence status auto-applies with undo; consequential verdicts (marking a trade blocked) get one-tap confirm via the review queue.
- Reconcile with the manual step UI: AI is an additional event source; define precedence (human-confirm > AI inference) in the projection.
- **Fuzzy matching:** one card ("pasang marmer KM utama") may cover multiple seeded steps (e.g. tiling D + sanitair G). Allow a card → multiple steps; on low confidence leave unmatched and flag for a human rather than guess.

### Slice C — Propagation + gaps
- Feed AI-inferred status into the existing `trade_step_deps` + [signals.ts](../../../apps/web/lib/steps/signals.ts) engine; `blocking_timeline` / `lead_time_risk` already model cross-trade cascade → surface "bridging" (a blocked trade rippling to dependents).
- "What you missed" = expected seeded steps minus inferred-from-cards → surface in the reminder cron / advisor (both already exist).

## 7. Build order, sequencing, preconditions
- **B → C.** Each independently shippable and testable. (Slices 0/A are already on `main`.)
- **Precondition check:** confirm PR #24's migration (`20260625000001_uniform_room_steps`) and #25's are pushed to prod before relying on per-room steps there — the rooms page queries `applies_to_area_types` and will 500 if prod is behind. (This is likely why the live app still shows the old bathroom-only schedule view.)
- Optional minor: an `area_type` correction affordance (Slice 0) — low priority given uniform seeding.

## 8. Testing & rollout
- Unit tests: AI-verdict → event projection; the outbox claim/lease logic; precedence (human-confirm vs AI); deterministic propagation off AI-inferred status.
- **Verify `apps/web` with `pnpm --filter web build`** (not just tsc + vitest) — `"use server"` files may export only async fns.
- Root `pnpm typecheck` + `pnpm test` (all workspaces incl. mobile) for any `@datum/core` change.
- **Migrations via the global Supabase v2 CLI** (`supabase db push` / `gen types`), not `pnpm migrate`. Regenerate types after push.
- Live Supabase, Wilson solo-on-main; land Slice B behind its own PR.

## 9. Open questions / risks
- **Card→step matching is fuzzy** (multi-step cards, ambiguous phrasing) — degrade gracefully; flag low-confidence for humans.
- **Backfill** of existing card history through the bridge — one-time pass vs. forward-only; decide in Slice B planning.
- **Precedence** between AI-inferred and human-confirmed status — define so a stale verdict can't override a person.
- **Realtime:** `area_step_events` is not yet in `supabase_realtime`; add it if the inferred-status feed should be live.

## 10. First implementation slice
**Slice B — the card→step AI bridge.** The outbox + cron + Haiku-classification pipeline that writes inferred `area_step_events` for the already-seeded per-room steps, behind propose→confirm. Slice C (propagation/gaps) follows once status is flowing from cards.
