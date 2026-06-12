# DATUM Optimization Audit

**Date:** 2026-06-12 · **Scope:** apps/web, apps/mobile, packages/db · **Method:** 4 parallel code audits + production build + manual verification of all high-severity claims. No code changed.

---

## 1. Architecture map

```
apps/web (Next.js 16, all routes dynamic ƒ — build: 2.5s compile, clean)
│
├─ Pages (Server Components, NO Suspense/loading.tsx anywhere)
│   /                       2 queries (well-optimized)
│   /project/[slug]         board: 3 parallel → 2 parallel (2 round-trips) → client <Board>
│   /project/[slug]/cards/[cardSlug]  1 → 1 → 6-parallel (3 round-trips, first 2 sequential)
│   /brief                  9 SEQUENTIAL queries (incl. duplicate area_gate_status fetch)
│   /search                 4 queries + 8 SEQUENTIAL payload-field queries in a loop
│   /project/[slug]/schedule  matrix + gate schedule, manual recompute button
│
├─ lib/assistant            capture path: retrieval (up to 8 sequential queries)
│                           → claude-haiku-4-5 via messages.create (NO streaming)
│                           → proposal card → createCardEvent → notification fan-out
├─ lib/brief, lib/gates     intelligence layer — correctly consumes the June 2026
│   lib/notifications       lifecycle payload fields (status/awaiting/blocked_on/issue) ✓
│
├─ Realtime: one channel per project (cards + events + comments), 250ms debounce
│   → router.refresh() = full board refetch on any change
│
apps/mobile (Expo)          VESTIGIAL — login + project list only; 3 commits, tabs are
│                           stubs ("Inbox (Slice 4)", "Asisten (Slice 2)"). The real
│                           mobile surface is the web app's responsive viewport.
│
packages/db (Supabase, LIVE)
    36 tables; append-only card_events; cards.current_summary/last_event_at denormalized.
    Indexing largely good (project_staff PK (project_id, staff_id) covers RLS lookups —
    a reported "missing index" there was a false alarm, verified in core_schema.sql:76).
    Real gaps: no text-search index for payload ilike sweeps; card_events.logged_by_staff_id
    unindexed. No views/RPCs for aggregation — brief/readiness logic all in JS.
```

**Client bundle health:** clean. No date/markdown/chart/dnd libraries; Anthropic SDK server-only. Bundle size is not the problem — **round-trips and blocking renders are.**

---

## 2. Rubric scores (1–5, evidence-backed)

### 2.1 Performance / latency on load — **2.5 / 5**

Good bones (parallel board queries, optimistic card creation, scoped realtime), but three pages serialize round-trips and nothing streams.

| # | Finding | Evidence | Cost on mobile (~150–300ms/RT) |
|---|---------|----------|-------|
| P1 | Brief runs **9 sequential queries**, two on the same table | `lib/brief/queries.ts:56–285` (verified: 9 awaited blocks, `area_gate_status` fetched at :253 and :279) | ~1.5–3s server time before anything renders |
| P2 | Search loops **8 sequential `ilike payload->>field`** queries | `lib/search/queries.ts:82–91` (verified) | ~1–2s per search; each is an unindexed scan |
| P3 | Assistant retrieval has the **same 8-query loop** | `lib/assistant/retrieval.ts:53–66` (verified) | +600–800ms on every chat message that includes a query |
| P4 | **Zero `loading.tsx` / Suspense** in the whole app | `find app -name loading.tsx` → empty (verified) | every nav = blank screen until all data resolves |
| P5 | No caching anywhere — every page dynamic, no `revalidate`/`use cache` | build output: all routes ƒ | stable data (project list, topics) refetched every request |
| P6 | Card detail: project lookup blocks card fetch | `app/(app)/project/[slug]/cards/[cardSlug]/page.tsx:24–33` | +1 round-trip per card open |
| P7 | `select("*")` on topics + cards for board | `lib/cards/queries.ts:35–52` | tens of KB of unused payload per board load |
| P8 | Realtime change → `router.refresh()` = full board refetch | `lib/cards/realtime.ts` + `Board.tsx` | acceptable now; revisit at high chatter |

**DB-side:** the `ilike '%term%'` sweeps in P2/P3 cannot be indexed as-is (a plain GIN on payload does **not** accelerate ilike). The durable fix is a generated `tsvector` column + GIN (or pg_trgm expression indexes) and one RPC doing the search in a single round-trip. Also missing: index on `card_events.logged_by_staff_id`. Both are additive migrations, safe for `db push`.

### 2.2 Workflow cohesion — **3.5 / 5**

The core loop (project → board/topics → card → events → brief/readiness/notifications) hangs together, and the June 2026 lifecycle fields are consumed correctly everywhere I checked (`brief/queries.ts:93,131,146,175,183,203,211`; `gates/readiness-rules.ts:71–93`; `notifications/producers.ts:49`). No dead intelligence layers remain. Gaps:

| # | Finding | Evidence |
|---|---------|----------|
| W1 | Gate recompute is a **manual button**; cells go stale until someone clicks it | `gates/recompute.ts`, `components/schedule/RecomputeButton.tsx` |
| W2 | 7 retired event kinds still clutter filters/labels (marked "lama") — inert but noisy | `EventRow.tsx`, `TimelineFilter.tsx` |
| W3 | `decisions` table and `decision` card_events coexist with **no link between them** — two sources of truth for the same concept | schema + `lib/brief/queries.ts:196` reads only events |
| W4 | Two known truncation TODOs: blockers `limit(100)` can drop newest; work-event query relies on implicit 1000-row cap | `brief/queries.ts:85,103` (verbatim TODO(scale) comments) |

### 2.3 Data relatability — **2.5 / 5**

The plumbing for a connected graph exists but is barely wired up:

- **`card_links` table exists** (depends_on / blocks / related_to / supersedes) but has no UI for creating or viewing links — already flagged as a deferred follow-up in the taxonomy plan.
- **No provenance chain:** a decision extracted from a client_request, or a card_event created from a `data_draft`, can't be traced backward (events have `draft_id`, nothing points the other way; `decisions` ↛ `card_events`).
- **Deadlines live in `area_gate_status`**, invisible to the assistant's context and to cards except via `NextDeadlineBadge`.
- Trello-imported cards carry `properties.trello_card_id` (GIN-indexed ✓) but events don't map back to source.

What "everything matches" needs is not a new schema — it's **surfacing `card_links` in the card sidebar + assistant**, and a provenance field on extracted entities. See §5.

### 2.4 Proactive advisor — **2 / 5**

All the ingredients exist; nothing ranks or pushes them:

- Brief computes blockers, needs-decision, awaiting-client, defects, expiring quotes, cascade risks, stale cells — but shows **top-5 per category, unranked by urgency**, and only when you visit `/brief`.
- `NextDeadlineBadge` already computes days-left/overdue per card (`components/schedule/NextDeadlineBadge.tsx:25–43`) — the only deadline-vs-today logic in the app, and it's per-card only.
- The assistant's retrieval **never fetches deadlines or gate status** (`retrieval.ts` — verified no `area_gate_status` query), so it cannot reason about timeline even when asked.
- Notifications are **in-app only** (no push/WhatsApp/email — confirmed, no integration code exists; WhatsApp was knowingly deferred).

**Computable TODAY with zero new data collection:** overdue gates (target_end_date < today, not passed), blockers + blocked_on, needs_decision + awaiting, open client_requests + awaiting, defects without later resolution, quotes expiring ≤7d, cascade risks, cards stale >30d. That is a complete "next-to-do" feed — it just needs one ranking function and a surface. What genuinely needs new data: effort weights, explicit dependencies, historical velocity, skill matrix.

### 2.5 Mobile, live-with-client UX — **2 / 5**

**The Expo app is not the mobile story** — it's a 3-commit stub (login + project list; Assistant and Inbox tabs are placeholder text). Recommendation: park it, invest in the web mobile viewport, revisit native only when push notifications or offline capture justify it.

Web mobile viewport findings:

| # | Finding | Evidence | Live-with-client impact |
|---|---------|----------|------|
| M1 | Board on mobile = **all columns stacked vertically full-width** (verified: `flex-col` mobile, `md:w-56` only at md+). With 15 auto-seeded topics that's a very long scroll with no column jump/tabs | `Board.tsx:77`, `Column.tsx:15` | finding one topic mid-meeting = scroll hunting |
| M2 | **Tap targets far below 44px:** filter chips ~22px tall at 10px font; "× bersihkan" is bare 10px text; status badges 8.5px font | `globals.css` `.chip`, `BoardFilter.tsx:66`, `MiniCard.tsx:15` | mis-taps one-handed at arm's length |
| M3 | No loading feedback on nav (no skeletons anywhere) — board/card/brief are blank during fetch | P4 above | on cellular, app looks frozen for 1–3s |
| M4 | Card-detail sidebar (move/members/areas) is below the fold on mobile; keyboard can cover form inputs | `cards/[cardSlug]/page.tsx:54–170` | extra scrolling during capture |
| M5 | Chat is a proper full-screen sheet on mobile ✓ but **"…sedang memproses" has no timeout, no retry, no spinner** — a dropped request hangs forever | `ChatDock.tsx:26–34`, `MessageList.tsx:51` | the worst possible failure in front of a client |
| M6 | Optimistic card creation ✓ (ghost card renders instantly) but failure rollback is silent | `AddCardForm.tsx:32–42` | a "saved" note may silently not exist |
| M7 | No offline/flaky-connection handling anywhere (no queue, no retry, no connection state) | both surfaces | cellular dead spots = data loss risk |

### 2.6 Chatbot capture friction — **2.5 / 5**

The capture loop is well-designed (Tanya/Catat modes, schema-validated proposals, confidence score, audit trail), but slow and brittle:

Measured flow (capture with a query): input → POST (~50–100ms) → retrieval **~800–1000ms** (8-query loop) → Haiku `messages.create`, **no streaming, ~1–3s blind wait** → parse/validate (~20ms) → proposal renders → commit ~200–300ms. **Total: ~1.8–2.5s of dead air per capture** — on a good connection.

| # | Finding | Evidence |
|---|---------|----------|
| C1 | No streaming — `messages.create()` waits for the full completion | `lib/assistant/anthropic.ts:39` (verified), `api/assistant/capture/route.ts:88` |
| C2 | No retry/timeout on the POST; network blip = "Gagal: HTTP …", retype everything | `ChatDock.tsx:26–34` |
| C3 | Session lost on page refresh (sessionId only in component state) | `ChatDock.tsx:12` |
| C4 | No prompt caching; system + context rebuilt and re-billed every message | `anthropic.ts:42` |
| C5 | Capture can set the lifecycle fields ✓ (status/awaiting/blocked_on/issue) but **cannot touch deadlines, card status, or current_summary** | `capture/route.ts:19–47` vs schemas |
| C6 | Confidence score displayed but never gates anything — a 20%-confidence proposal saves identically to a 95% one | `ProposalCard.tsx:116–127` |

---

## 3. Prioritized findings — impact × effort

Ranked by **live-with-client impact ÷ effort**:

| Rank | Item | Findings | Effort | Impact |
|---|------|----------|--------|--------|
| 1 | Collapse the sequential query loops (brief → `Promise.all` + dedupe; search + retrieval → single `.or()` query) | P1 P2 P3 | S | −0.6 to −2s on brief, search, **and every chat message** |
| 2 | Chat resilience: stream the response, 15s timeout + retry with backoff, persist sessionId | C1 C2 C3, M5 | S–M | the live-capture experience stops feeling broken on cellular |
| 3 | `loading.tsx` skeletons for board / card / brief + 44px tap targets | P4 M2 M3 | S | perceived speed + mis-tap fix everywhere |
| 4 | Mobile board navigation: sticky column tabs / jump bar (or horizontal snap-scroll) | M1 | M | board becomes usable one-handed in a meeting |
| 5 | "Hari Ini" proactive advisor (see §5.1) | §2.4 | M | the app starts telling you what's next instead of waiting to be asked |
| 6 | DB migrations: FTS/tsvector for payload search + `logged_by_staff_id` index + brief RPC (one round-trip) | P2 P5 W4 | M | durable fix for search latency; removes the truncation TODOs |
| 7 | Assistant deadline-awareness: add gate deadlines to retrieval context; allow capture to propose deadlines | C5, §2.4 | M | timeline questions answerable in chat |
| 8 | Data-graph surfacing: card_links UI + provenance links (see §5.2) | §2.3 | M | inputs reference each other; "everything matches" |
| 9 | Auto-trigger gate recompute on relevant card_events | W1 | S | matrix stops going stale |
| 10 | Polish: card-detail parallel fetch, column-scoped selects, confidence gate on proposals, hide retired kinds from filters | P6 P7 C6 W2 | S | cumulative small wins |

### Top 3 quick wins
1. **Query-loop collapse (Rank 1)** — a few hours of work, removes 7 round-trips from search, 7 from every assistant message, and ~6 from brief. The single biggest measured latency cut available.
2. **Chat streaming + retry + session persistence (Rank 2)** — converts the worst live failure mode (frozen "sedang memproses") into visible progress with recovery.
3. **Skeletons + tap targets (Rank 3)** — pure CSS/layout, no logic risk, transforms perceived mobile quality immediately.

---

## 4. Proposed implementation plan (sequenced)

Each phase is independently shippable and verifiable on the mobile viewport. All DB work is additive (`supabase db push`, never reset). Snapshot-commit the working tree before starting.

**Phase 1 — Latency quick wins (Ranks 1, 3, 10-partial).**
Brief `Promise.all` + merge the duplicate `area_gate_status` fetch; search/retrieval single-query rewrite; card-detail parallel fetch; scoped selects; `loading.tsx` skeletons for board/card/brief; 44px tap targets (`.chip`, filter buttons, badges).
*Risk: low. Verify: brief/search/board timings before vs after; mobile-viewport screenshots.*

**Phase 2 — Chat capture resilience (Rank 2 + C4, C6).**
SSE streaming from `/api/assistant/message` and `/capture`; 15s timeout + 3-retry exponential backoff in `ChatDock`; sessionId + history in localStorage; Anthropic prompt caching on system+context; low-confidence (<50%) warning before save.
*Risk: medium (API route shape changes). Verify: throttled-network test of full capture flow.*

**Phase 3 — DB hardening (Rank 6, 9).**
Migration: generated tsvector column + GIN on `card_events` hot text fields (or pg_trgm expression indexes); `logged_by_staff_id` index; `get_brief_data` RPC returning the whole brief in one round-trip (also fixes the `limit(100)`/1000-row TODOs); trigger or server-action hook to auto-recompute gate cells on relevant events.
*Risk: medium (live DB — additive only, test migration locally first). Verify: query plans + brief timing.*

**Phase 4 — Proactive advisor "Hari Ini" (Rank 5, 7).**
See spec §5.1. New ranked next-action feed + deadline data in assistant retrieval + capture able to propose deadlines.
*Risk: low-medium (new surface, no schema change needed for v1).*

**Phase 5 — Data graph + mobile board nav (Ranks 4, 8).**
card_links UI in card sidebar + "Terkait" section; provenance backlinks (draft→event already exists; add decisions→source event); mobile column tab bar with sticky header.
*Risk: low.*

**Explicit decision needed from you:** park the Expo app (recommended) or invest in it. Everything above assumes the web mobile viewport is the mobile product.

**Out of scope (deliberately):** WhatsApp/push delivery (deferred per plan — revisit after Phase 4 since the advisor makes notifications more valuable), historical velocity prediction, skill-based assignment, realtime granular board patching.

---

## 5. Feature specs — how new features connect to what exists

### 5.1 "Hari Ini" proactive advisor
One ranked feed computed from **existing data only**: overdue/near gates (`area_gate_status` target dates — reuse `NextDeadlineBadge` math), blocked work + `blocked_on`, `needs_decision` + `awaiting`, open client_requests + `awaiting`, expiring quotes, cascade risks (reuse `bottlenecks.ts`), stale cards. Rank = f(days-overdue, gate criticality, age). Surfaces: top section of `/brief`, a per-project strip above the board, and injected into assistant context so "apa selanjutnya?" answers from the same feed. No new tables; one query function (later folded into the Phase 3 RPC).

### 5.2 Connected inputs (data relatability)
v1 is surfacing, not schema: card sidebar gets "Terkait" (read/write `card_links`); capture proposals can include a suggested link when the AI detects a reference to an existing card (retrieval already finds candidate cards); decisions/extractions store `source_event_id`. Result: a client_request → the decision it spawned → the work it unblocks becomes a traversable chain — which also feeds the advisor's dependency awareness later.

### 5.3 Deadline-aware assistant
Retrieval adds one query (`area_gate_status` for the project's upcoming/overdue cells, ~30 rows) to the context block; capture prompt gains an optional `proposed_deadline` the user confirms on the ProposalCard before it writes to `area_gate_status` via a guarded mutation. Connects chat ↔ schedule ↔ advisor with no new storage.

---

## 6. Corrections to raw agent findings (for the record)
- ~~"Missing `project_staff(project_id)` index"~~ — **false**: PK `(project_id, staff_id)` covers it (`20260531000001_core_schema.sql:76`).
- ~~"Board requires horizontal scroll/pinch-zoom on mobile"~~ — mechanism corrected: it's a **vertical stack** of full-width columns; the severity (hard to navigate live) stands.
- "Add GIN(payload) to fix search" — corrected: GIN jsonb_ops does not accelerate `ilike`; the fix is tsvector FTS or pg_trgm (§4 Phase 3).
