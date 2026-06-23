# Mobile slice: Brief & Review — design spec

Slug: `brief-review` · Date: 2026-06-20 · Status: draft

Native (Expo Router) parity for two surfaces of the web app:

1. **Morning Brief** — the cross-project "what needs attention today" dashboard
   (`apps/web/app/(app)/brief/page.tsx`): the ranked "Hari ini — prioritas"
   advisor feed plus six bottleneck sections, the cascade-risk gate list, and
   the "readiness perlu di-recompute" list.
2. **Review queue** — the principal's inbox of AI-proposed `card_event` drafts
   awaiting approve/reject (`apps/web/app/(app)/review/page.tsx` +
   `apps/web/components/review/ReviewItem.tsx`).

These are read-heavy dashboards plus exactly two mutations (approve / reject a
draft). They are an ideal early strangler slice because the underlying logic is
**already isomorphic by construction** — `getBriefData`, `getAdvisorData`, and
the `bottlenecks.ts` / `rank.ts` pure functions all already take a
`SupabaseClient<Database>` and import zero `next/*` or `server-only` modules.
The only web-coupled piece is the approve/reject mutation pair, which lives in
the 1090-line `apps/web/lib/cards/mutations.ts` god-module behind `revalidatePath`
and admin-client notification side effects.

---

## 1. Goal & scope

Deliver, on mobile, with full parity to web:

- A **Brief** screen (cross-project) that shows:
  - "Hari ini — prioritas" ranked advisor feed (top 10).
  - Six brief sections: pending drafts, decisions needed, blockers, defects
    (30d), awaiting client, expiring quotes — each with count + top-5 items +
    its exact empty-state copy.
  - "Gate berisiko (cascade)" list (top 12).
  - "Readiness perlu di-recompute" stale-by-project list.
- A **Review** screen: the list of `status='draft' & draft_type='card_event'`
  drafts, each rendered with project chip, kind label, high-risk badge,
  author, AI rationale, original input text, pretty payload fields, and the
  **Setujui & tambah ke kartu** / **Tolak (+ optional reason)** actions with
  the same per-item state machine as `ReviewItem.tsx`.
- The strangler extraction of the brief/advisor read path and the
  approve/reject draft mutations into a new `@datum/core` package, with web
  repointed to consume it.

**Out of scope** for this slice (called out fully in §11): creating drafts
(that comes from the Assistant capture flow / `createCardEventDraft`), the
gate-advance confirm sheet on `gate_ready` advisor rows, project-scoped advisor
(`getAdvisorData({ projectId })` used on the per-project page), and the
`review_queue` assignment table (the web review page does not use it today).

---

## 2. Web behavior mirrored — exact files & functions

Read and mirrored (do not invent behavior beyond these):

### Brief dashboard
- `apps/web/app/(app)/brief/page.tsx` — server component. Calls
  `getBriefData(supabase)` and `getAdvisorItems(supabase, { now: new Date(), limit: 10 })`
  concurrently, then renders `<AdvisorFeed>`, six `<BriefSection>`s, the cascade
  gate `<section>`, and the stale-by-project `<section>`. Header copy:
  "Morning brief" / "Apa yang butuh perhatian hari ini" / the cross-project
  summary line. Each `BriefSection` carries its exact emoji, title, and
  two-line empty message (copied verbatim to mobile i18n — see §4/§6).
- `apps/web/lib/brief/queries.ts` → `getBriefData(supabase): Promise<BriefData>`.
  Concurrent `Promise.all` of 7 queries; produces `pendingDrafts`, `blockers`,
  `defects`, `decisionsNeeded`, `awaitingClient`, `expiringQuotes` (each
  `{count, items: BriefItem[]}`), plus `gateRisks: GateRisk[]` and
  `staleByProject`. Helpers `daysAgo`, `ageMeta` (Bahasa age strings). Blocker
  supersession logic: newest-first window of 100 blocked work events, second
  query for later non-blocked work events bounded by `oldestBlockedAt`,
  superseded via `compareEventTime`; `count` reconciles the window tail.
- `apps/web/lib/brief/bottlenecks.ts` — pure: `findCascadeRisks(cells, todayIso)`
  (gate N window started but gate N-1 not `passed/ready_for_handoff/not_applicable`)
  and `findExpiringQuotes(vendorEvents, todayIso, windowDays=7)` (quote ≤ horizon
  on a card with no `pick`/`contract`). Types `ScheduleCell`, `GateRisk`,
  `QuoteEvent`. Constants `GATE_ORDER`, `SATISFIED`, `STATUS_LABELS`.
- `apps/web/lib/advisor/queries.ts` → `getAdvisorData(supabase, opts)` and the
  thin `getAdvisorItems(supabase, opts)`. Assembles `AdvisorSignal[]` from
  gates (overdue / soon ≤7d / cascade / `schedule_rot` >120d collapse /
  `gate_ready`), live blockers, open decisions, open client requests, expiring
  quotes, and stale active cards (filtered by `isTemplateCardTitle`), then calls
  `rankAdvisorItems`. `now` is always injected; per-source caps; gate grouping
  per (kind, project, gate, end). `PER_SOURCE_CAP = 25`, `STALE_DAYS = 30`,
  `GATE_SOON_WINDOW_DAYS = 7`, `SCHEDULE_ROT_DAYS = 120`.
- `apps/web/lib/advisor/rank.ts` — pure: `scoreItem`, `rankAdvisorItems`,
  `dueLabelFor`, `ageLabelFor` (the full scoring table in the file header).
- `apps/web/lib/advisor/types.ts` — `AdvisorItem`, `AdvisorSignal`,
  `AdvisorItemType`, `GateReadyTarget`, `AdvisorGateCell`.
- `apps/web/components/brief/AdvisorFeed.tsx` and `BriefSection.tsx` — the
  presentational shapes mobile re-implements in NativeWind.

### Review queue
- `apps/web/app/(app)/review/page.tsx` — server component. Direct query:
  `data_drafts` select with `projects:project_id`, `created_by:created_by_staff_id`
  joins, filtered `status='draft'`, `draft_type='card_event'`, ordered
  `created_at` desc, `limit(50)`. Error and empty states with exact copy.
- `apps/web/components/review/ReviewItem.tsx` — the per-draft card + the
  `pending → saving → approved | rejected | error` state machine; reject
  reveals an optional reason input; uses `approveCardEventDraft` /
  `rejectCardEventDraft` server actions, `renderPayload`, `eventKindLabel`.
- `apps/web/lib/cards/mutations.ts`:
  - `approveCardEventDraft(formData)` (lines 925–1001): loads draft, guards
    `status==='draft'` and `draft_type==='card_event'`, **re-validates payload**
    with `EventPayloadSchemas[kind]`, inserts a `card_events` row
    (`source_kind='chat'`, `cost_visible` from `COST_VISIBLE_KINDS`,
    `draft_id`), marks the draft `approved` (+ `promoted_record_type/id`), then
    web-only side effects: `recomputeProjectGates` for `GATE_RELEVANT_KINDS` and
    `notifyDraftApproved`, then `revalidatePath('/review')`.
  - `rejectCardEventDraft(formData)` (lines 1008–1046): updates the draft to
    `rejected` (+ reason) **guarded `.eq('status','draft')`**, then
    `notifyDraftRejected`, then `revalidatePath('/review')`.
- `apps/web/lib/cards/payload-render.ts` — `renderPayload`, `eventKindLabel`,
  `valueLabel`, `FIELD_LABELS`, `VALUE_LABELS`, `EVENT_KIND_LABELS` (all
  Bahasa). Mirrored as-is into core.
- `packages/types/src/event-kinds.ts` — already shared:
  `EventPayloadSchemas`, `EventKind`, `COST_VISIBLE_KINDS`, `HIGH_RISK_KINDS`,
  `parseEventPayload`. Reused directly; **no extraction needed**.

---

## 3. `@datum/core` surface to extract (the strangler step)

New package `packages/core` (`@datum/core`), peer-depending on `@datum/db` and
`@datum/types`. HARD RULES restated: every export takes
`SupabaseClient<Database>`; no `server-only`, no `next/*`, no React. The brief
and advisor modules **already satisfy this** — extraction is largely a
*move + re-export*, which makes this slice the cheapest possible first cut of the
strangler.

### Pure logic (move verbatim, zero changes)
| core module | from | exports |
|---|---|---|
| `core/brief/bottlenecks.ts` | `apps/web/lib/brief/bottlenecks.ts` | `findCascadeRisks(cells: ScheduleCell[], todayIso: string): GateRisk[]`, `findExpiringQuotes(vendorEvents: QuoteEvent[], todayIso: string, windowDays?: number): QuoteEvent[]`, types `ScheduleCell`, `GateRisk`, `QuoteEvent` |
| `core/advisor/rank.ts` | `apps/web/lib/advisor/rank.ts` | `scoreItem(signal, now): number`, `rankAdvisorItems(signals, now, limit?): AdvisorItem[]`, `dueLabelFor(iso, now): string`, `ageLabelFor(iso, now): string` |
| `core/advisor/types.ts` | `apps/web/lib/advisor/types.ts` | `AdvisorItem`, `AdvisorSignal`, `AdvisorItemType`, `GateReadyTarget`, `AdvisorGateCell` |
| `core/cards/event-order.ts` | `apps/web/lib/cards/event-order.ts` | `compareEventTime(a, b): number`, type `OrderableEvent` |
| `core/cards/labels.ts` (`ACTOR_LABELS` only for this slice) | `apps/web/lib/cards/labels.ts` | `ACTOR_LABELS: Record<string,string>` |
| `core/cards/template-card.ts` | `apps/web/lib/cards/template-card.ts` | `isTemplateCardTitle(title): boolean` |
| `core/gates/labels.ts` | `apps/web/lib/gates/labels.ts` | `gateShortName(code): string`, `gateLabel(code): string` |
| `core/cards/payload-render.ts` | `apps/web/lib/cards/payload-render.ts` | `renderPayload(payload): RenderedField[]`, `eventKindLabel(kind): string`, `valueLabel(v): string`, `EVENT_KIND_LABELS`, type `RenderedField` |

### Data-access (move, taking `supabase` arg — already the signature)
| core module | from | exports |
|---|---|---|
| `core/brief/get-brief-data.ts` | `apps/web/lib/brief/queries.ts` | `getBriefData(supabase): Promise<BriefData>`, types `BriefItem`, `BriefData` |
| `core/advisor/get-advisor.ts` | `apps/web/lib/advisor/queries.ts` | `getAdvisorData(supabase, opts: GetAdvisorOpts): Promise<AdvisorData>`, `getAdvisorItems(supabase, opts): Promise<AdvisorItem[]>`, types `GetAdvisorOpts`, `AdvisorData` |

### New extraction from the mutations god-module (the real strangler win)
The web `approveCardEventDraft`/`rejectCardEventDraft` mix three concerns:
(a) DB transaction logic, (b) Zod re-validation, (c) web-only side effects
(`revalidatePath`, admin-client notifications, `recomputeProjectGates`).
Extract only (a)+(b) into core; leave (c) in the web wrapper.

```ts
// core/drafts/list-pending.ts
export type PendingDraft = {
  id: string; project_id: string; draft_type: string;
  proposed_payload: ProposedCardEvent;  // {kind, payload, card_id, occurred_at, rationale?}
  risk_level: string; source_type: string;
  original_input_text: string | null; created_at: string;
  created_by_staff_id: string | null;
  projects: { project_code: string; project_name: string } | null;
  created_by: { full_name: string | null } | null;
};
export async function listPendingCardEventDrafts(
  supabase: SupabaseClient<Database>,
  opts?: { limit?: number },          // default 50, matches web
): Promise<PendingDraft[]>;            // status='draft' & draft_type='card_event', created_at desc

// core/drafts/approve.ts
export type ApproveDraftResult =
  | { ok: true; eventId: string; projectId: string; projectCode: string | null;
      cardSlug: string | null; eventKind: EventKind; draftAuthorId: string | null;
      gateRelevant: boolean }                       // signals web needs for its side effects
  | { ok: false; error: string };
export async function approveCardEventDraft(
  supabase: SupabaseClient<Database>,
  args: { draftId: string; approverId: string },    // approverId = auth user id
): Promise<ApproveDraftResult>;
// Does exactly the web body 936–997 minus revalidate/notify/recompute:
// load+guard+re-validate (EventPayloadSchemas) → insert card_events → mark draft
// approved (+promoted_record_*). Returns the metadata the web wrapper feeds to
// recomputeProjectGates + notifyDraftApproved.

// core/drafts/reject.ts
export type RejectDraftResult =
  | { ok: true; projectId: string; draftAuthorId: string | null; eventKind: string }
  | { ok: false; error: string };
export async function rejectCardEventDraft(
  supabase: SupabaseClient<Database>,
  args: { draftId: string; rejectorId: string; reason?: string },
): Promise<RejectDraftResult>;
// Web body 1018–1042 minus notify/revalidate: update→rejected guarded
// .eq('status','draft'); returns metadata for notifyDraftRejected.
```

Validation schemas (`ApproveDraftInput`, `RejectDraftInput`) move into the core
modules; mobile and web both call through them. `EventPayloadSchemas` stays in
`@datum/types` (already shared) and is imported by `core/drafts/approve.ts`.

### Shared query keys (host in core, per the architecture brief)
Add to `@datum/core` (mirrors `apps/web/lib/query/keys.ts` conventions):
```ts
// core/query/keys.ts
export const keys = {
  brief: () => ["brief"] as const,
  advisor: (scope: "all" | { projectId: string }) => ["advisor", scope] as const,
  reviewDrafts: () => ["review", "drafts"] as const,
};
```
Web's existing `keys` factory stays for board/projects/card; this adds the three
new roots both apps agree on.

### How web repoints (verify `apps/web` vitest still green after each)
1. `apps/web/lib/brief/bottlenecks.ts` → `export * from "@datum/core/brief/bottlenecks"`.
2. `apps/web/lib/brief/queries.ts` → re-export `getBriefData` + types from core
   (web's internal imports of `findCascadeRisks` etc. now resolve through core).
3. `apps/web/lib/advisor/{queries,rank,types}.ts` → re-export from core.
4. `apps/web/lib/cards/payload-render.ts`, `event-order.ts`, `gates/labels.ts`,
   `template-card.ts`, `labels.ts` (ACTOR_LABELS) → re-export from core (these
   have many other consumers; keeping the web path as a thin re-export avoids a
   wide refactor in this slice).
5. `apps/web/lib/cards/mutations.ts`: rewrite the bodies of
   `approveCardEventDraft`/`rejectCardEventDraft` to: build supabase server
   client + get user → call `core/drafts/approve|reject` → on `ok`, fire the
   web-only effects (`recomputeProjectGates` if `gateRelevant`,
   `notifyDraftApproved/Rejected`, `revalidatePath('/review')`) using the
   metadata returned by core. The `FormData`→args adapter stays web-side (the
   `ReviewItem` server-action contract is unchanged, so the web component does
   not change).
6. Existing web tests to keep green: any `bottlenecks`/`rank`/`brief` unit tests
   (vitest) — they should pass unchanged since the implementations only moved.

---

## 4. Mobile screens — Expo Router routes, components, every state

Existing tabs: `apps/mobile/app/(tabs)/{matrix,inbox,assistant,more}.tsx`
(placeholders today; `inbox.tsx` literally says "Inbox (Slice 4)"). This slice
owns **Brief** and **Review**. Decision: the **Inbox tab hosts the Brief**, and
**Review is a stack under Inbox** (the web review page is titled "Inbox
principal", so this matches the mental model and Locked Decision 4's "Inbox"
tab).

Routes (nested stack per Locked Decision 4):
```
app/(tabs)/inbox/_layout.tsx        # Stack
app/(tabs)/inbox/index.tsx          # Brief dashboard  (renamed from inbox.tsx)
app/(tabs)/inbox/review.tsx         # Review queue
```
Deep links from advisor/brief items that point at a card or schedule are routed
to the project stack (Matrix tab) once that slice exists; until then they no-op
gracefully or open a "buka di web" affordance (see §9).

### Brief screen (`inbox/index.tsx`)
NativeWind components (SANO tokens, Locked Decision 2):
- `BriefHeader` — "Morning brief" eyebrow + title + subtitle (i18n
  `brief.title` / `brief.subtitle`).
- `AdvisorFeedCard` — numbered `FlatList`/mapped rows; each row: rank index,
  title, optional detail, `ProjectChip`, `dueLabel`. `gate_ready` rows show a
  disabled-for-now "Tandai selesai" affordance (confirm sheet is out of scope —
  §11) — render the row but no action, identical to web minus the island.
- `BriefSectionCard` (reused 6×) — emoji + title + `(count)` + top-5
  `BriefItemRow`s (project chip, meta right-aligned, title, detail). The
  "pending drafts" section gets a "lihat semua →" affordance navigating to
  `inbox/review` when `count > items.length` (mirrors web `showAllHref`).
- `CascadeRiskCard` — list (slice 12) of project·area + "Gate X" badge + reason.
- `StaleByProjectCard` — grid/list of project + "{n} stale" badge.

States:
- **Loading**: skeleton rows for the advisor feed + 6 section placeholders
  (react-query `isPending`); show persisted cache instantly if present (§8).
- **Empty (per section)**: each `BriefSectionCard` renders its exact two-line
  Bahasa empty copy from web (e.g. pending drafts: "Tidak ada draft yang
  menunggu." + the assistant explainer). Advisor empty: "Tidak ada prioritas
  mendesak. 👍". Cascade empty: "Tidak ada gate yang berisiko terlambat
  berantai." Stale empty: "Semua readiness up-to-date." — all moved into
  `apps/mobile/messages/{en,id}.json` under `brief.*`.
- **Error**: full-screen retry card ("Gagal memuat" + retry button) when the
  combined query errors and no cache exists; if cache exists, show stale data
  with a small inline "gagal memperbarui" banner.
- **Offline**: render last persisted snapshot with an offline pill; pull-to-
  refresh queues a refetch on reconnect (§8).

### Review screen (`inbox/review.tsx`)
- `ReviewHeader` — "Inbox principal" eyebrow + "Perlu dicek" + explainer copy.
- `ReviewDraftCard` (mirror of `ReviewItem.tsx`): header band (project chip ·
  kind label · "Berisiko tinggi" badge when `risk_level==='high'` · createdAt
  via `toLocaleString('id-ID')`), author line, rationale blockquote, "Tulisan
  asli" block, payload `<dl>` from `renderPayload`, error banner, and the action
  row.
- `ReviewActionRow` — the `pending → saving → approved | rejected | error`
  state machine per card. "Setujui & tambah ke kartu" (primary). "Tolak"
  toggles an inline reason `TextInput` + confirm/cancel. Touch targets ≥44pt
  (consistent with the recent web touch-target fix on this branch).

States:
- **Loading**: 2–3 skeleton draft cards.
- **Empty**: dashed card — "Tidak ada item yang perlu dicek." + the
  assistant-explainer subline (exact web copy).
- **Error (list load)**: "Gagal memuat: {message}" retry card.
- **Per-card states**: `saving` → "Memproses…"; `approved` → green "Tersimpan
  di kartu" pill; `rejected` → "Ditolak."; `error` → red banner + actions
  remain (retry-able), exactly as web.
- **Offline**: list shows from cache; approve/reject are **disabled offline**
  with a tooltip/toast (see §8 — these are not safe to optimistic-queue).

---

## 5. Data fetching — react-query keys, realtime, optimistic updates

React-query (Locked Decision 3), AsyncStorage persister mirroring
`apps/web/lib/query/persister.ts` (`createKVPersister(AsyncStorage, key)`),
`makeQueryClient()` config copied from `apps/web/lib/query/client.ts`
(`staleTime 30s`, `gcTime 24h`, `refetchOnReconnect`).

Queries:
- `keys.brief()` → `getBriefData(supabase)`.
- `keys.advisor("all")` → `getAdvisorItems(supabase, { now: new Date(), limit: 10 })`.
  Note `now` is passed by the queryFn each run; this is fine (the data is
  recomputed server-side from rows, scoring is deterministic given `now`).
- `keys.reviewDrafts()` → `listPendingCardEventDrafts(supabase, { limit: 50 })`.

Realtime channels (mirror web realtime+invalidation conventions): subscribe to
postgres changes on:
- `card_events` (insert) → invalidate `brief` + `advisor` (a new event can clear
  a blocker / change counts) and `reviewDrafts` (approve inserts an event).
- `data_drafts` (insert/update) → invalidate `reviewDrafts`, `brief`
  (pendingDrafts count) and `advisor` is unaffected by drafts (advisor does not
  read `data_drafts`).
- `area_gate_status` (update) → invalidate `brief` + `advisor` (cascade /
  stale / overdue).
One channel per table, cleaned up on screen blur; debounce invalidations
(coalesce bursts) to avoid thrash, matching web's realtime debounce.

Optimistic updates:
- **Approve/reject**: optimistically remove the draft from the
  `keys.reviewDrafts()` list and decrement `brief.pendingDrafts.count`, with
  rollback on error (`onError` restores the cached snapshot). On settle,
  invalidate `reviewDrafts` + `brief`. This matches the web UX where the card
  flips to "Tersimpan/Ditolak" immediately. Because the actual writes are not
  idempotent and have server-side guards (`.eq('status','draft')`), do **not**
  retry automatically; surface error and let the user retry.

---

## 6. Mutations & validation — reuse Zod from core/types

- Approve: `core/drafts/approve.ts#approveCardEventDraft(supabase, {draftId, approverId})`.
  Re-validates with `EventPayloadSchemas[kind]` from `@datum/types` (defense in
  depth — the same `recheck.safeParse` the web does at mutations.ts:953). Mobile
  passes `approverId = (await supabase.auth.getUser()).data.user.id`.
- Reject: `core/drafts/reject.ts#rejectCardEventDraft(supabase, {draftId, rejectorId, reason?})`.
  `reason` validated `z.string().max(500).optional()` (the existing
  `RejectDraftInput` rule, moved into core).
- Mobile does **not** run `recomputeProjectGates` or notification producers —
  those are web-only (`recompute.ts` is `"use server"`;
  `notifications/producers.ts` uses `createSupabaseAdminClient`). On mobile the
  gate recompute happens naturally on next read/realtime, or via the web cron;
  notifications are produced by the web path. **Open question (§ below):**
  whether to extract a notifications-via-anon-client core helper so mobile-
  approved drafts still notify the draft author — flagged, not built here.
- i18n: all new mobile copy keyed under `brief.*` and `review.*` in
  `apps/mobile/messages/{en,id}.json`, Indonesian-first, copied verbatim from
  the web JSX strings (header copy, every section's empty message, button
  labels "Setujui & tambah ke kartu" / "Tolak" / "batal", status strings
  "Memproses…" / "Tersimpan di kartu" / "Ditolak.").

---

## 7. RLS & permissions notes (per role)

The mobile anon client relies entirely on RLS (Locked Decision 1) — same
enforcement as web. Roles: `principal, designer, pic, site_supervisor, admin,
estimator` (`staff_role` enum); `cost_visible` is a per-staff/per-project flag,
not a role.

- **Read brief/advisor** — `data_drafts_read`, `card_events_select`,
  `area_gate_status_read_visible`, `cards`/`projects` reads are all gated by
  `current_can_read_project(project_id)`. A user only sees rows for projects
  they're staffed on; cross-project visibility requires
  `current_has_cross_project_read()` (principals/admins). So a designer's brief
  is naturally scoped to their projects — same as web, no mobile-side filtering.
- **Vendor/quote rows** — `card_events_select` additionally hides
  `cost_visible=true` rows unless `current_cost_visible_for(project_id)`. So the
  "Quote akan kedaluwarsa" brief section and `quote_expiring` advisor items
  **degrade to empty** for non-cost-visible staff. Mirror web: do not special-
  case; the empty state copy already covers it. The `getBriefData` comment at
  queries.ts:126 documents exactly this.
- **Approve a draft** — inserting the `card_events` row requires the user be in
  `project_staff` for that project (`card_events_insert`). Marking the draft
  `approved` is allowed for the author OR a cross-project reader
  (`data_drafts_update_author_or_approver`). So a principal can approve any
  readable project's draft; a designer can only approve drafts they authored.
  **This matters on mobile**: the approve button must handle an RLS-denied
  update gracefully (the insert may succeed but the draft-status update is
  blocked) — surface the returned error. (Web has the same constraint;
  `approveCardEventDraft` returns the supabase error string.)
- **Reject** — same `data_drafts_update_author_or_approver`; the
  `.eq('status','draft')` guard means a concurrent approval makes reject a
  no-op (0 rows), which the UI should treat as "already handled, refresh".
- No new policies needed for this slice; `data_drafts` /`card_events` policies
  are sufficient. Confirm during build that the anon mobile client hits the
  same policies (it does — same Postgres, same `auth.uid()`).

---

## 8. Offline behavior

- **Reads**: persist `brief`, `advisor`, `reviewDrafts` queries via the
  AsyncStorage persister (`PERSISTED_KEY_ROOTS = ["brief","advisor","review"]`,
  mirroring web's `idb-keyval` roots). On cold start show the last snapshot
  instantly; refetch when online. `CACHE_BUSTER` + `CACHE_MAX_AGE` (24h) copied
  from web client config so stale shapes are dropped on upgrade.
- **Mutations (approve/reject)**: **not** queued offline. Both depend on
  server-side guards (`.eq('status','draft')`), produce a non-idempotent insert,
  and need fresh re-validation — queuing them risks double-promotion or stale
  approvals. When offline, disable the action buttons and show a toast
  ("Perlu koneksi untuk menyetujui/menolak"). This is a deliberate divergence
  from generic offline-mutation patterns, justified by the approval semantics.
- Pull-to-refresh on both screens forces `refetch` (and is the primary recovery
  path after reconnect).

---

## 9. Edge cases

- **Blocker supersession across the 100-row window** — mobile calls the same
  `getBriefData`, so the window + count-reconciliation logic
  (`liveBlockers.length + max(0, blockedCount - blockedEvs.length)`) is
  preserved automatically. No mobile reimplementation.
- **`schedule_rot` collapse** — projects with gates >120d overdue collapse to a
  single re-baseline advisor row and mute that project's per-cell overdue /
  cascade / gate_ready noise (advisor/queries.ts:181–284). Preserved via core.
- **Template cards** — `isTemplateCardTitle` filters Trello-import placeholder
  cards from the stale-card advisor source. Preserved via core.
- **Cost-blind users** — quote sections silently empty (RLS), §7.
- **Concurrent approval/rejection** — two principals act on the same draft: the
  second's update guard yields 0 rows → web returns "Draft sudah approved" /
  the reject becomes a no-op. Mobile shows the error and refetches the list
  (realtime also removes the row).
- **Deep links to cards/schedule** before the project stack ships — advisor and
  brief item `href`s are web paths (`/project/{code}/cards/{slug}`,
  `/project/{code}/schedule`). On mobile, parse the path to the native route
  when available; otherwise render the row as non-navigable (no broken link) or
  offer "buka di web". Do not crash on `href === "#"` (used when a card join is
  null).
- **`now` drift / timezone** — web uses local `new Date()` and `.slice(0,10)`
  for `todayIso`; on a phone in WIB this matches the studio. Keep the same
  (inject device `now`); the scoring/labels are deterministic given `now` and
  already unit-tested with injected `now`.
- **Missing joins** — `projects`/`cards` joins can be null (RLS or deleted
  parent); web falls back to `"?"` / `"(kartu)"` / `href "#"`. Mirror exactly.
- **Long payload text** — `renderPayload` marks `isLongText` at >80 chars; the
  RN `<dl>` equivalent must wrap, not truncate, long values.

---

## 10. Testing

- **vitest (core logic)** — the moved pure functions keep/extend their unit
  tests in `packages/core`: `findCascadeRisks`, `findExpiringQuotes`,
  `scoreItem`/`rankAdvisorItems`, `dueLabelFor`/`ageLabelFor`,
  `compareEventTime`, `isTemplateCardTitle`, `renderPayload`. New tests:
  `approveCardEventDraft`/`rejectCardEventDraft` against a mock
  `SupabaseClient<Database>` (or a Supabase test instance) asserting:
  guard on non-`draft` status, payload re-validation failure path, correct
  `card_events` insert fields (`source_kind:'chat'`, `cost_visible` from
  `COST_VISIBLE_KINDS`, `draft_id`), and the returned `gateRelevant` /
  notification metadata. `getBriefData`/`getAdvisorData` integration tests
  against seeded data (or reuse web's existing fixtures, now importing core).
- **Web regression** — after each repoint step, run `apps/web` vitest; the
  brief/advisor/bottleneck tests must stay green unchanged (proof the move was
  behavior-preserving).
- **@testing-library/react-native (screens)**:
  - Brief: renders the 6 sections with counts; each section's empty copy when
    items empty; advisor rows in rank order; cascade + stale lists; loading
    skeleton; error retry; offline pill from persisted cache.
  - Review: renders a draft card (chip, kind label, high-risk badge, rationale,
    original text, payload fields); approve → `saving` → `approved` pill;
    reject reveals reason input → confirm → `rejected`; error banner on failure;
    empty state; buttons disabled offline.
- **Manual** on device against live Supabase (per MEMORY: live DB), one
  principal + one designer login to verify RLS scoping and cost-blind empties.

---

## 11. Dependencies on other slices + Out of scope

**Depends on:**
- **`@datum/core` bootstrap** — this slice *creates* the package (tsconfig path
  alias in `tsconfig.base.json`, build/test wiring). It is a natural first
  strangler slice; if another slice lands the package first, consume it.
- **Mobile query/realtime infra** — the AsyncStorage persister + `makeQueryClient`
  + realtime subscription helper (Locked Decision 3). If a sibling "mobile
  data layer" slice owns this, depend on it; otherwise this slice stands up a
  minimal version mirroring `apps/web/lib/query`.
- **Auth** — already wired (`apps/mobile/lib/supabase/client.ts`).
- **Navigation into cards/schedule** — soft dependency on the Matrix/project
  stack slice for working deep links (degrades gracefully until then, §9).

**Out of scope (explicitly not built here):**
- Creating drafts (`createCardEventDraft`) — that's the Assistant capture slice.
- The `gate_ready` confirm sheet / `GateAdvanceConfirm` island
  (`apps/web/components/gates/GateAdvanceConfirm.tsx`) — `gate_ready` rows
  render read-only.
- Project-scoped advisor (`getAdvisorData({ projectId })`) used on the
  per-project page — only cross-project (`projectId` undefined) here.
- `review_queue` table (assignment/priority) — the web review page does not use
  it; skip.
- `recomputeProjectGates` and notification producers on mobile — web-only side
  effects; see the open question below.

**Open questions:**
- Should mobile-initiated draft approvals fire author notifications? Web does
  via `notifyDraftApproved` (admin client). Options: (a) extract a core
  notifications helper usable with the anon client + RLS insert policy on
  `notifications`, or (b) accept that mobile approvals don't notify until a
  shared notifications-core slice lands. Flagged, not decided.
- Confirm `notifications` RLS allows an anon-client insert by the approver (if
  we pursue option (a)).
- Whether to host `makeQueryClient`/persister in `@datum/core/query` (shared) or
  duplicate per app — brief favors shared query keys in core; the client config
  is small enough to share too. Decide during the data-layer slice.
