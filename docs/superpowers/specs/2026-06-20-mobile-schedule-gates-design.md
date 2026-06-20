# Mobile Design Spec — Schedule & Gates (slug: `schedule-gates`)

Date: 2026-06-20
Status: Design (no implementation)
Slice: `schedule-gates` (mobile parity slice)

> Design doc only. No source files modified. Every behavior below is grounded in
> the cited web files; nothing here invents new server logic.

---

## 1. Goal & scope

Bring the web project **Schedule & Readiness** page to mobile at functional
parity, reshaped for a phone. On web this single page
(`apps/web/app/(app)/project/[slug]/schedule/page.tsx`) does five things:

1. Shows a **planned Gantt** of every (area × gate) window (`Gantt.tsx`).
2. Shows the **area × gate readiness matrix** (`AreaGateMatrix`).
3. Lets a member **recompute readiness** from `card_events` (`RecomputeButton` →
   `recomputeAreaGateStatus`).
4. Lets a member set/clear a **per-area handover target** that re-baselines that
   area's gate windows (`AreaTargetEditor` → `setAreaTargetDate`).
5. Explains the rule engine (`RulesViewer`).

Plus the **gate advance/confirm** flow, which lives off this page on web (it is
embedded in the advisor feed via `GateAdvanceConfirmAction` /
`GateAdvanceConfirm` → `markGatePassed`), but conceptually belongs to this slice
and is owned here on mobile.

**In scope for this mobile slice:**
- A read-first, phone-appropriate schedule view of the gate windows + readiness
  status per area (replacing the horizontal-scroll desktop Gantt — see §4).
- Per-area handover target set/clear (re-baseline).
- Recompute readiness (manual trigger + post-mutation re-fetch).
- Gate advance/confirm sheet (Lampiran-A reminder checklist + completed date).
- Rules explainer (collapsible reference).

**Explicitly NOT a literal port:** the desktop 960px-wide multi-month Gantt grid
is not viable on a ~380px viewport. §4 specifies the mobile replacement and §9
flags the trade-offs.

---

## 2. Web behavior mirrored — exact files + functions

Read and mirrored (do not re-derive behavior; reuse the cited logic):

| Concern | Web file | Function / symbol |
| --- | --- | --- |
| Page composition / data load | `apps/web/app/(app)/project/[slug]/schedule/page.tsx` | default `ProjectSchedulePage` (loads project by `project_code`, `fetchMatrix`, `getProjectScheduleCells`, `getAreaTargetDates`, stale count, latest recompute time) |
| Planned Gantt render | `apps/web/components/schedule/Gantt.tsx` | `Gantt`, `GateBar`, `monthsBetween`, `inferGates`, `STATUS_STYLE`, `STATUS_LABELS`, `ROW_HEIGHT` |
| Schedule cell read + overlay | `apps/web/lib/gates/schedule.ts` | `getProjectScheduleCells`, `getAreaTargetDates`, `getCardNextDeadline`, `recomputeProjectSchedule` (RPC `compute_project_schedule`) |
| Pure overlay math | `apps/web/lib/gates/schedule-overlay.ts` | `overlayAreaTargetDates`, `shiftIsoDate`, `ScheduledCell` type (re-anchors targeted areas; R4 "honest dates") |
| Board-wide next-deadline derivation | `apps/web/lib/gates/board-deadlines.ts` | `computeCardDeadlines`, `DeadlineCell`, `CardDeadline` (pure) |
| Readiness rule engine | `apps/web/lib/gates/readiness-rules.ts` | `evaluateGate`, `RELEVANT_KINDS`, `RULE_VERSION` (=2), `ReadinessState`, `GateResult` |
| Event ordering (supersession) | `apps/web/lib/cards/event-order.ts` | `compareEventTime` (used inside `evaluateGate`) |
| Recompute (rule engine, sticky-passed) | `apps/web/lib/gates/recompute.ts` | `recomputeProjectGates`, `recomputeAreaGateStatus` (FormData wrapper) |
| Recompute UI | `apps/web/components/schedule/RecomputeButton.tsx` | `RecomputeButton` |
| Per-area target editor | `apps/web/components/schedule/AreaTargetEditor.tsx` + `apps/web/lib/gates/area-target.ts` | `AreaTargetEditor`, `setAreaTargetDate` |
| Gate advance confirm | `apps/web/components/gates/GateAdvanceConfirm.tsx` + `apps/web/lib/gates/advance.ts` | `GateAdvanceConfirmAction`, `GateAdvanceConfirm`, `markGatePassed`, `getGateCheckpoints`, `MarkGatePassedInput`, `GateCheckpoint`, `ADVANCEABLE` |
| Rules explainer | `apps/web/components/schedule/RulesViewer.tsx` | `RulesViewer` (pure documentation; mirrors `RELEVANT_KINDS` inline) |
| Matrix read | `apps/web/lib/matrix/fetch-matrix.ts` | `fetchMatrix`, `MatrixData`, `MatrixArea`, `MatrixCell` |
| Gate labels | `apps/web/lib/gates/labels.ts` | `GATE_SHORT_NAME`, `gateLabel`, `gateShortName` |

**Key invariants that MUST carry to mobile verbatim (these are server/logic, not
UI):**

- **Sticky-passed cells.** `recomputeProjectGates` (recompute.ts:90-99, 109-122)
  loads cells where `status='passed' AND actual_end_date IS NOT NULL`, and on the
  upsert it skips writing `status`/`blocking_reason` for them while still
  refreshing `readiness_score`/`last_recomputed_at`/`stale`. A human "passed"
  decision must never be clobbered by a later recompute. Mobile must reuse the
  exact same function — never re-implement the loop.
- **Advance state guard.** `markGatePassed` only advances a cell whose status is
  in `ADVANCEABLE = {"ready_for_handoff","in_progress"}` (advance.ts:83,
  125-130), rejects already-passed / `actual_end_date != null`
  (advance.ts:122-124), and guards the UPDATE with `.is("actual_end_date", null)`
  so two racing confirms can't both win (advance.ts:139-156). Mobile reuses this
  unchanged.
- **Checklist is a reminder, never a gate.** Lampiran-A `getGateCheckpoints`
  items are surfaced but ticking never blocks the pass; persisting them is
  best-effort (advance.ts:16-21, 162-177). Mobile mirrors this exactly.
- **Overlay re-anchoring.** `overlayAreaTargetDates` re-anchors a targeted area's
  windows so its final gate ends on `target_date`, shifting all its cells by one
  delta (pure date translation, no scaling). Reused unchanged via core.
- **Schedule vs readiness are two different recomputes.** `compute_project_schedule`
  (the SQL RPC) writes `target_start_date`/`target_end_date` from
  `gates.active_weeks` + `projects.kickoff_date` (schedule.ts:31). `recomputeProjectGates`
  writes `status`/`readiness_score` from `card_events`. The web page's
  `RecomputeButton` triggers the **readiness** recompute. Mobile keeps the same
  separation.

---

## 3. `@datum/core` surface to extract (strangler step)

The gate/schedule logic is the cleanest extraction candidate in the repo: most of
it is already pure (`schedule-overlay.ts`, `board-deadlines.ts`,
`readiness-rules.ts`, `event-order.ts` have no `next/*`, no `server-only`). The
remaining files are `"use server"` action wrappers that mix the real query with
`revalidatePath`. The strangler move: extract the **query/logic body** into core
(taking `SupabaseClient<Database>` as the first argument), and leave the web
`"use server"` files as thin wrappers that call core then do the web-only
side-effects.

> HARD RULE reminder: every core export takes `SupabaseClient<Database>` (from
> `@datum/db`). No `server-only`, no `next/*`, no React.

### 3a. Pure logic (move as-is; no Supabase arg needed — they take data)

These already conform; they just move into core so mobile can import them without
pulling in Next.

- `core/gates/readiness-rules.ts`
  - `export function evaluateGate(gate: GateCode, input: GateInput): GateResult`
  - `export const RULE_VERSION = 2`
  - `export const RELEVANT_KINDS`, types `ReadinessState`, `GateInput`, `GateResult`
  - From `apps/web/lib/gates/readiness-rules.ts`.
- `core/gates/event-order.ts`
  - `export function compareEventTime(a: OrderableEvent, b: OrderableEvent): number`
  - From `apps/web/lib/cards/event-order.ts` (readiness-rules imports it; move
    together to keep the dependency inside core).
- `core/gates/schedule-overlay.ts`
  - `export function overlayAreaTargetDates(cells: ScheduledCell[], targetByArea: Map<string,string|null>, anchorGate?: string): ScheduledCell[]`
  - `export function shiftIsoDate(iso: string, days: number): string`
  - `export type ScheduledCell`
  - From `apps/web/lib/gates/schedule-overlay.ts`.
- `core/gates/board-deadlines.ts`
  - `export function computeCardDeadlines(links, cells: DeadlineCell[], todayIso: string): Map<string, CardDeadline>`
  - types `DeadlineCell`, `CardDeadline`
  - From `apps/web/lib/gates/board-deadlines.ts`.
- `core/gates/labels.ts`
  - `export const GATE_SHORT_NAME`, `gateLabel(code)`, `gateShortName(code)`
  - From `apps/web/lib/gates/labels.ts` (shared so mobile renders the same
    Indonesian gate names).

### 3b. Data-access logic (gain a `SupabaseClient<Database>` first arg)

Signatures change from web's implicit `createSupabaseServerClient()` to an
explicit client argument.

- `core/gates/schedule.ts`
  - `getProjectScheduleCells(sb: SupabaseClient<Database>, projectId: string): Promise<ScheduledCell[]>`
    — current body of `schedule.ts:49-70` (the two reads + `overlayAreaTargetDates`).
  - `getAreaTargetDates(sb, projectId): Promise<Map<string,string>>` — body of `schedule.ts:74-85`.
  - `getCardNextDeadline(sb, cardId): Promise<NextDeadline | null>` — body of `schedule.ts:98-136`.
  - `type NextDeadline` moves here.
- `core/gates/recompute.ts`
  - `recomputeProjectGates(sb: SupabaseClient<Database>, projectId: string, projectCode: string): Promise<RecomputeResult>`
    — the whole body of `recompute.ts:37-130` **minus** the final `revalidatePath`
    (recompute.ts:128). Returns the same `RecomputeResult`. Sticky-passed logic
    (recompute.ts:90-122) moves verbatim.
  - Optionally `RecomputeInput` Zod schema for the FormData wrapper to reuse.
- `core/gates/advance.ts`
  - `markGatePassed(sb: SupabaseClient<Database>, staffId: string, input: MarkGatePassedInput): Promise<MarkGatePassedResult>`
    — body of `advance.ts:85-194` **minus** `getCurrentStaff()` (caller passes
    `staffId`) and **minus** the `revalidatePath` block (advance.ts:179-192).
    Keeps the Zod parse, membership+state guard, guarded UPDATE, and best-effort
    checkpoint upsert.
  - `getGateCheckpoints(sb, gateCode: string): Promise<GateCheckpoint[]>` — body
    of `advance.ts:38-57`.
  - `MarkGatePassedInput` Zod schema + `GateCheckpoint`, `MarkGatePassedResult`,
    `MarkGatePassedInput` types move here (so mobile validates with the same Zod).
- `core/gates/area-target.ts`
  - `setAreaTargetDate(sb: SupabaseClient<Database>, staffId: string, input: {areaId; projectId; targetDate: string|null}): Promise<AreaTargetResult>`
    — body of `area-target.ts:34-99` minus `getCurrentStaff()` and the two
    `revalidatePath` calls (area-target.ts:97-98). Keeps `TargetInput` Zod schema
    (the impossible-date round-trip guard).
- `core/gates/schedule-rpc.ts`
  - `recomputeProjectSchedule(sb, projectId): Promise<{ok:true; cellsUpdated:number}|{ok:false;error:string}>`
    — body of `schedule.ts` `recomputeProjectSchedule` minus FormData parse +
    revalidate. Calls `sb.rpc("compute_project_schedule", { p_project_id })`.
    (Web triggers this on kickoff change; mobile likely won't expose it in this
    slice — see §11 Out of scope — but extracting it keeps the module coherent.)
- `core/matrix/fetch-matrix.ts`
  - `fetchMatrix(sb, projectId): Promise<MatrixData | null>` — body of
    `apps/web/lib/matrix/fetch-matrix.ts:31-65`. Shared so the mobile schedule
    screen reads the same matrix shape. (This is also a dependency of the
    `area-gate-matrix` slice; coordinate — see §11.)

### 3c. Shared query keys (host in core)

Per LOCKED DECISION 1, host shared keys in core so web and mobile agree. Web's
`apps/web/lib/query/keys.ts` currently has only `board`/`projects`/`card`. Add a
**schedule/gates** namespace in `core/query/keys.ts`:

```
schedule: (projectId) => ["schedule", projectId]            // overlaid ScheduledCell[]
areaTargets: (projectId) => ["areaTargets", projectId]      // Map area→target
matrix: (projectId) => ["matrix", projectId]                // MatrixData
gateCheckpoints: (gateCode) => ["gateCheckpoints", gateCode] // static reference
```

Web re-exports these from core to retire the local duplication incrementally.

### 3d. How web repoints (verify web tests still pass after each)

1. `apps/web/lib/gates/recompute.ts` keeps `"use server"` + `recomputeAreaGateStatus(FormData)`;
   `recomputeProjectGates` becomes:
   `const sb = await createSupabaseServerClient(); const r = await core.recomputeProjectGates(sb, projectId, projectCode); if (r.ok) revalidatePath(...); return r;`
2. `apps/web/lib/gates/advance.ts` keeps `"use server"`; `markGatePassed` becomes:
   resolve `staff = await getCurrentStaff()` (auth gate stays in the web wrapper),
   `sb = await createSupabaseServerClient()`, call `core.markGatePassed(sb, staff.id, raw)`,
   then the existing `revalidatePath` block. `getGateCheckpoints` → thin wrapper.
3. `apps/web/lib/gates/area-target.ts`, `schedule.ts` → same pattern (auth +
   revalidate stay in web; query body in core).
4. `apps/web/lib/matrix/fetch-matrix.ts` → wrapper over `core.fetchMatrix`.
5. `apps/web/lib/gates/{schedule-overlay,board-deadlines,readiness-rules,labels}.ts`
   become `export * from "@datum/core/..."` re-exports (or are deleted and
   importers repointed). Pure logic — the existing vitest unit tests
   (`apps/web/tests/unit/*` for overlay/rules/deadlines, if present) should pass
   unchanged once they import from core.
6. `RulesViewer.tsx` keeps its inline `RELEVANT_EVENTS_PER_GATE` mirror but its
   `RULE_VERSION` import repoints to core.

Verification gate per the strangler rule: run web unit + e2e after each file's
repoint; do not bundle all repoints into one commit.

---

## 4. Mobile screens — Expo Router routes, components, every state

Mobile today has flat tabs (`apps/mobile/app/(tabs)/_layout.tsx`: matrix / inbox
/ assistant / more) and a stub `matrix.tsx` that just lists projects. This slice
lands inside a **per-project nested stack under the Matrix tab** (LOCKED DECISION
4 — expand tabs into stacks).

### Routes (Expo Router)

```
app/(tabs)/matrix/_layout.tsx                 // Stack
app/(tabs)/matrix/index.tsx                   // project list (existing matrix.tsx moves here)
app/(tabs)/matrix/[code]/_layout.tsx          // per-project stack (shared with board/matrix slices)
app/(tabs)/matrix/[code]/schedule.tsx         // THIS SLICE: Schedule & Readiness
app/(tabs)/matrix/[code]/schedule/rules.tsx   // Rules explainer (pushed screen, not inline accordion)
```

The schedule screen is reached from a project's overview/board header (a
"Jadwal & Readiness" link, mirroring the web back-link
`apps/web/.../schedule/page.tsx:57-60`).

### Screen: `schedule.tsx` — the core decision

The desktop Gantt (`Gantt.tsx`) is a `min-w-[960px]` horizontally-scrolling grid:
left frozen 19rem of area+gate labels, then 8 gate rows per area across a
multi-month timeline. **This does not survive a 380px viewport** (flagged in §9).
Mobile replacement, read-first:

**Primary layout — vertical "Area accordion + per-gate timeline rows":**

- A `SectionList` (or `FlatList` of area cards). Each **area** is a card:
  - Header: `area_name` + `area_code` (NativeWind, SANO tokens). A 🎯
    **"Baseline ulang"** chip when the area has a `target_date` (mirrors
    page.tsx:120-127). Tapping the header expands the area.
  - Expanded body: one **gate row per gate A–H**, each showing:
    - The gate badge (`A`…`H`) + `gateShortName(code)` (from core labels).
    - A **single-area mini timeline bar** for that gate's
      `target_start_date → target_end_date`, scaled to the area's own min/max
      (NOT a shared project-wide axis — that's what forces 960px). Status color
      from the shared `STATUS_STYLE` token map.
    - A status pill (`STATUS_LABELS`: Belum mulai / Dikerjakan / Siap handoff /
      Terblokir / Lulus / Tidak relevan).
    - `blocking_reason` text inline when status is `blocked`.
    - Dates rendered `id-ID` (`12 Mar 2026`), matching web's locale formatting.
    - If status ∈ `{ready_for_handoff, in_progress}` and not passed → a
      **"Tandai selesai"** affordance opening the advance sheet (§ gate confirm).
  - Footer of the area card: **per-area target editor** affordance (see below).

This keeps each row scaled to its own dates, so it reads cleanly on a phone and
preserves the per-area "honest dates" story without a shared horizontal axis.

**Secondary view — "Timeline" toggle (optional, read-only):** a segmented
control at top: `Daftar` (the accordion above) / `Lini masa`. The `Lini masa` view
is a horizontally-scrollable port of `Gantt.tsx` for users who want the classic
view; it reuses the same `ScheduledCell[]` and `monthsBetween`/`pctOf` math. This
is the literal Gantt, explicitly opt-in and scroll-gated (§9). If timeboxed out,
ship only `Daftar`; mark `Lini masa` as a follow-up.

**Header region of the screen (mirrors page.tsx:54-84):**
- Title block: `{project_code} · {project_name}`, eyebrow "Jadwal & Readiness",
  subtext "Status per area × gate … rule engine v{RULE_VERSION}" + last recompute
  timestamp (`id-ID` medium/short) or "Belum pernah dihitung".
- **Stale banner** when `staleCount > 0`: "🔄 {n} sel butuh recompute —"
  (page.tsx:63-67). On mobile this is a tappable banner that runs recompute.
- **Recompute control** (mirrors `RecomputeButton`): a header button "Hitung
  ulang readiness" with pending state "Menghitung…" and a success/error toast.
- Link/row to the **Rules** pushed screen (replaces the inline `RulesViewer`
  accordion; full-screen reference reads better on mobile).

### Component inventory (NativeWind, SANO tokens)

| Component | Mirrors web | Notes |
| --- | --- | --- |
| `AreaScheduleCard` | area block of `Gantt.tsx` + page.tsx area-target card | accordion; holds gate rows + target editor |
| `GateRow` | `GateBar` + matrix cell | mini bar + status pill + advance affordance |
| `MiniGateBar` | `GateBar` | per-area-scaled bar, `STATUS_STYLE` colors |
| `StatusPill` | `STATUS_LABELS`/`STATUS_STYLE` | shared token map (move colors to shared tokens — LOCKED DECISION 2) |
| `AreaTargetSheet` | `AreaTargetEditor` | date picker (`@react-native-community/datetimepicker` or Expo equivalent — verify v56 docs), Simpan / Hapus / Batal |
| `GateAdvanceSheet` | `GateAdvanceConfirm` | bottom sheet; checklist + date + confirm |
| `RecomputeAction` | `RecomputeButton` | header button + toast |
| `RulesScreen` | `RulesViewer` | pushed screen; same 4 sections |
| `ScheduleTimeline` (optional) | `Gantt` | opt-in horizontal scroll port |

### Every state

- **Loading:** skeleton area cards (3-4 shimmer rows) while `useQuery` is
  fetching with no cached data. With cached data → show stale data + a subtle
  refreshing spinner in the header (react-query `isFetching`).
- **Empty (no areas):** mirror page.tsx:152-158 / Gantt empty —
  "Matrix belum tersedia." and, if areas exist but no dates,
  "Belum ada tanggal target. Set kickoff_date di proyek lalu hitung ulang."
  (Gantt.tsx:51-57). Project-not-found → "Proyek tidak ditemukan: {code}" with a
  back action (page.tsx:25-32).
- **Schedule never computed:** "Schedule belum dihitung. Klik 'Hitung ulang
  readiness'." (Gantt.tsx:40-46) — but on mobile point at the header recompute
  button.
- **Error:** query error → inline error card with retry. Mutation errors
  (recompute / advance / target) → toast with the server's Indonesian message
  verbatim (`res.error`), no rollback needed for recompute (idempotent); advance
  rolls back optimistic pill (§5).
- **Offline:** see §8. Read screens render from the AsyncStorage-persisted cache
  with an "Offline — data tersimpan" banner; mutations are disabled (or queued —
  §8) with a clear disabled affordance.

---

## 5. Data fetching — react-query keys, realtime, optimistic updates

Mobile uses `@tanstack/react-query` (LOCKED DECISION 3) calling `@datum/core`
directly with the mobile anon client (`apps/mobile/lib/supabase/client.ts`). No
HTTP API layer (web's `lib/query/hooks.ts` fetches `/api/...`; mobile skips that
and calls core functions in the `queryFn`).

### Query keys (from core, §3c)

- `keys.schedule(projectId)` → `core.getProjectScheduleCells(supabase, projectId)`
  → `ScheduledCell[]` (already overlaid). Drives the gate bars + status.
- `keys.matrix(projectId)` → `core.fetchMatrix(supabase, projectId)` → areas,
  gates, cells (blocking_reason, current_owner_id, status). Used for the area
  list + matrix-derived status. (Schedule cells carry status too; pick one source
  of truth — recommend `schedule` for bars/dates, `matrix` for area list +
  blocking_reason. They read the same `area_gate_status` table.)
- `keys.areaTargets(projectId)` → `core.getAreaTargetDates(supabase, projectId)`
  → which areas show the "Baseline ulang" chip.
- `keys.gateCheckpoints(gateCode)` → `core.getGateCheckpoints(supabase, gateCode)`
  → lazy-loaded when the advance sheet opens (mirrors `GateAdvanceConfirm`'s
  `useEffect` lazy load, advance.ts component lines 89-101). `staleTime: Infinity`
  (static reference data).

Stale/last-recompute metadata: two small reads mirroring page.tsx:39-52 (stale
count, latest `last_recomputed_at`). Either fold into a `keys.scheduleMeta(projectId)`
query or compute client-side from the matrix cells if those fields are added to
the select. Keep as a tiny separate query to match web's two head/limit reads.

### Realtime (mirror `apps/web/lib/cards/realtime.ts` conventions)

Add a channel for gate status, modeled on `subscribeToProjectChanges`:

- Channel `schedule:{projectId}` subscribing to `postgres_changes` on
  `public.area_gate_status` filtered `project_id=eq.{projectId}` (and optionally
  `areas` for `target_date` changes).
- Debounce ~250ms (matching realtime.ts:17-20), then
  `queryClient.invalidateQueries` for `keys.schedule(projectId)`,
  `keys.matrix(projectId)`, `keys.areaTargets(projectId)`.
- This makes a teammate's recompute or gate-pass appear live, exactly as web's
  board does for cards. Requires `area_gate_status` in the `supabase_realtime`
  publication — **verify**; web only added cards/events/comments/topics
  (realtime.ts comment + migration `20260615000001`). If not published, fall back
  to refetch-on-focus + manual pull-to-refresh and flag a migration follow-up
  (§9 / §11).

### Optimistic updates (mirror `apps/web/lib/query/mutations.ts` pattern)

Web's mutation pattern: `onMutate` cancel + snapshot + patch cache; `onError`
rollback to snapshot; `onSettled` invalidate. Mirror it:

- **Gate advance (`markGatePassed`):** `onMutate` set that (area,gate) cell's
  status to `passed` + `actual_end_date = completedDate` in the cached
  `schedule`/`matrix` data, and flip the sheet's button to "Ditandai selesai"
  (mirrors `GateAdvanceConfirmAction`'s `done` state). `onError` rollback +
  surface `res.error`. `onSettled` invalidate `schedule` + `matrix`. Note the
  server is the authority on the state guard — optimistic pass is allowed only
  when the local cell is in `ADVANCEABLE`; if the server rejects (race/blocked),
  rollback shows the real state.
- **Area target (`setAreaTargetDate`):** `onMutate` set/clear the area's target
  in `areaTargets` and re-run `overlayAreaTargetDates` locally over the cached
  `schedule` cells (the pure core fn — re-anchors instantly without a round-trip).
  `onError` rollback. `onSettled` invalidate `schedule` + `areaTargets`.
- **Recompute (`recomputeProjectGates`):** not optimistic (it's a server-side
  batch). Show pending, then invalidate `schedule` + `matrix` + scheduleMeta on
  success; toast `{cellsUpdated} sel diperbarui (rule v{ruleVersion})` (mirrors
  `RecomputeButton`). Sticky-passed cells stay passed (server guarantees).

---

## 6. Mutations & validation — reuse Zod from core

All three mutations reuse the **exact Zod schemas** extracted to core (§3b), so
mobile and web validate identically:

- `markGatePassed`: `MarkGatePassedInput` (advance.ts:63-74) — `projectId`/`areaId`
  uuid, `gateCode` ∈ `GateCodes`, optional `completedDate` matching `/^\d{4}-\d{2}-\d{2}$/`
  (default = server today), optional `checkedTemplateIds` uuid[] max 100.
- `setAreaTargetDate`: `TargetInput` (area-target.ts:13-26) — uuid ids, nullable
  `targetDate` with the impossible-date round-trip refinement (rejects
  `2026-02-31`). Mobile's date picker should emit `YYYY-MM-DD`; pass `null` to
  clear (Hapus).
- `recomputeProjectGates`: `RecomputeInput` (recompute.ts:10-13) — `projectId`
  uuid, `projectCode` non-empty.

Mobile calls the core function directly (e.g.
`core.markGatePassed(supabase, session.user's staffId, input)`); the core fn
parses with Zod and returns the discriminated-union result
(`{ok:true,...} | {ok:false,error}`) — mobile renders `error` verbatim (already
Indonesian). The **staffId** comes from the mobile session (the `staff` row for
`auth.uid()`); mirror however the board slice resolves current staff on mobile.
Confirmed-date default and `todayIso()` (local-tz, advance component lines 19-24)
should live in core or a shared util so mobile and web compute "today" the same.

---

## 7. RLS & permissions notes (per role)

Grounded in the migrations:

- **Read** (`area_gate_status_read_visible`, `20260531000002_rls_policies.sql:156`):
  any session that passes `current_can_read_project(project_id)` can read the
  schedule/matrix. No role gating beyond project membership.
- **Write to `area_gate_status`** (`20260603000001_area_gate_status_write_rls.sql`):
  INSERT + UPDATE both gated only by `current_can_read_project(project_id)` —
  **explicitly equal to read** because the table is a derived snapshot. DELETE is
  not permitted. Consequence: **any project member (principal, designer, staff)
  who can read the project can recompute readiness AND confirm a gate pass.**
  There is no principal-only gate at the DB level. The roles list is
  `principal/designer/pic/site_supervisor/admin/estimator`
  (`packages/types/src/domain.ts:2`). Mobile must NOT add a stricter client-side
  role check than web has (parity) — but the UI MAY soften the advance affordance
  for non-leads if product later wants it; out of scope here.
- **`gate_checkpoint_templates`** (`gate_checkpoint_templates_read_authenticated`,
  `20260531000002_rls_policies.sql:126`): readable by any authenticated user —
  static reference. Matches `getGateCheckpoints`'s "safe to read for anyone
  signed in" comment.
- **`area_gate_checkpoints`** (RLS enabled `20260531100005_rls_new_tables.sql:11`):
  the best-effort per-item audit upsert (`passed_by_staff_id`). Failure here never
  fails the pass (advance.ts:159-177) — so even if a member's RLS blocks the
  checkpoint write, the gate still passes. Mobile relies on this fail-open.
- **`areas.target_date` write** (`area-target.ts` writes under session RLS;
  `20260604000001_areas_and_card_areas_write_rls.sql`): same membership model;
  the core fn double-checks the area belongs to the project before writing.
- **Security model is identical on mobile:** mobile uses the **anon client with
  the user's session** (`apps/mobile/lib/supabase/client.ts`) — never
  service-role — so RLS enforces everything exactly as on web. The membership +
  state guards in the core functions are belt-and-suspenders on top of RLS.

---

## 8. Offline behavior

Per LOCKED DECISION 3 (AsyncStorage persister mirroring web's idb-keyval
`apps/web/lib/query/persister.ts`):

- **Reads:** `keys.schedule`, `keys.matrix`, `keys.areaTargets`,
  `keys.gateCheckpoints` are persisted, so the schedule screen renders fully from
  cache when offline. Show an "Offline — menampilkan data tersimpan" banner.
  Add these key roots to the mobile equivalent of web's `PERSISTED_KEY_ROOTS`
  (`apps/web/lib/query/keys.ts:7`).
- **`gateCheckpoints` cache** is especially valuable offline (static; lets the
  advance sheet render its checklist without network).
- **Mutations offline (recommended for v1 = block, not queue):**
  - Recompute requires the server batch → **disable when offline** with a clear
    message ("Perlu koneksi untuk hitung ulang").
  - Gate advance + target set: the safest v1 is to **disable while offline**
    (the advance state guard and the racing-confirm guard are server-side; queuing
    a pass that the server later rejects is confusing). The optimistic UX already
    makes online passes feel instant.
  - If a later iteration wants a mutation queue, model it on react-query's
    paused-mutations + a resume-on-reconnect handler; out of scope for this slice
    but note the hook is the same `mutationFn` returning `{ok,error}`.
- **Sticky-passed guarantee helps offline correctness:** even if a stale cached
  cell shows `ready_for_handoff` and the server already passed it, the next
  recompute/refetch reconciles, and the server's `.is("actual_end_date", null)`
  guard prevents a duplicate pass.

---

## 9. Edge cases

- **Gantt on small screens (the headline edge case):** the web Gantt is
  `min-w-[960px]` with a frozen 19rem label gutter (Gantt.tsx:82-84,107-114). A
  literal port forces two-axis scrolling that is unusable on a phone. → Mobile
  primary view is the per-area accordion with **per-area-scaled mini bars** (§4);
  the literal horizontal Gantt is an explicit opt-in "Lini masa" segment, not the
  default.
- **No dates yet** (`kickoff_date` unset, schedule never computed): cells exist
  with null `target_start_date`/`target_end_date`. Gantt.tsx:48-57 handles this;
  mobile shows the same "set kickoff / recompute" empty state and renders status
  pills without bars.
- **Overdue windows:** `computeCardDeadlines` / `getCardNextDeadline` fall back to
  the earliest (overdue) window when nothing is upcoming (board-deadlines.ts:52,
  schedule.ts:119). The "today line" (Gantt.tsx:74-76,162-168) becomes a
  per-row "Hari ini" marker or a relative "telat N hari" label on the area card.
- **Re-baselined area with no anchor cell:** `overlayAreaTargetDates` leaves an
  area's cells unchanged if it has a target but no final-gate cell with a stored
  `target_end_date` (schedule-overlay.ts:84-86). UI must not promise a shift it
  can't compute — show the target chip but keep default bars (matches web).
- **Sticky-passed + later block:** a passed cell whose underlying cards later go
  blocked must stay `passed` (recompute skips it). UI shows "Lulus" even if a
  child card is blocked — by design; do not surface a conflicting "Terblokir".
- **Racing confirm:** two members confirm the same gate; server's guarded UPDATE
  lets one win, the other gets "Gate ini sudah ditandai selesai"
  (advance.ts:153-156). Mobile shows that message and refetches.
- **Already-passed / blocked / not_started advance attempt:** server rejects with
  the specific Indonesian message (advance.ts:122-130). Mobile should only show
  the advance affordance for `ADVANCEABLE` states, but must still handle a stale
  optimistic attempt gracefully.
- **completedDate in the future:** web caps the date input at `today`
  (GateAdvanceConfirm `max={todayIso()}`); mobile date picker must set the same
  max. Server's Zod only checks format, so the UI cap is the real guard — keep it.
- **Timezone for "today":** advance uses local-tz `todayIso()`; recompute/markGate
  default uses server UTC date (advance.ts:132-133). Document that the displayed
  default date is local but the server stores what's sent — keep web's behavior.
- **Many areas (perf):** large projects = areas × 8 gates cells. Web loads all in
  one query; mobile should virtualize the area list (`FlatList`) and lazy-expand
  gate rows.

---

## 10. Testing

- **Core logic (vitest, in `packages/core`):** the pure functions move with their
  behavior, so port/share the existing web unit tests:
  - `overlayAreaTargetDates` — re-anchor delta, no-target passthrough, missing
    anchor passthrough, `shiftIsoDate` DST-safety (schedule-overlay.ts contract).
  - `evaluateGate` — not_started/in_progress/blocked/ready_for_handoff per
    `RELEVANT_KINDS`; supersession via `compareEventTime`; allDone gating
    (readiness-rules.ts:42-103).
  - `computeCardDeadlines` — upcoming vs overdue fallback (board-deadlines.ts).
  - `compareEventTime` — occurred_at → created_at → id tiebreak.
  - For the data-access core fns (`recomputeProjectGates`, `markGatePassed`,
    `setAreaTargetDate`), unit-test with a mocked `SupabaseClient` asserting:
    sticky-passed skip, ADVANCEABLE guard, guarded-UPDATE predicate, Zod
    rejections, fail-open checkpoint upsert.
- **Screens (`@testing-library/react-native`):**
  - `AreaScheduleCard` renders gate rows with correct status pills/colors and the
    "Baseline ulang" chip when targeted.
  - `GateAdvanceSheet` — lazy-loads checklist, ticking never disables confirm,
    confirm calls `markGatePassed` with the right input, error message renders,
    success flips to "Ditandai selesai".
  - `AreaTargetSheet` — Simpan sends `YYYY-MM-DD`, Hapus sends `null`, invalid
    date blocked by picker.
  - Empty / loading / error / offline states each render the right copy.
  - Optimistic: advance flips the pill immediately and rolls back on simulated
    server `{ok:false}`.
- **Parity guard:** keep the web e2e for the schedule page green through the
  strangler repoint (run after each repoint commit, per §3d).

---

## 11. Dependencies on other slices + Out of scope

**Depends on:**

- **`area-gate-matrix` slice** (sibling): both this slice and the matrix slice
  consume `core.fetchMatrix` and `core/gates/*` (status colors, labels,
  `area_gate_status` reads). Coordinate the `core/matrix/fetch-matrix.ts` and
  `core/gates/labels.ts` extraction so it's done once. If the matrix slice owns
  `fetchMatrix`, this slice imports it.
- **Project board / overview slice:** provides the per-project nested stack
  (`app/(tabs)/matrix/[code]/_layout.tsx`) and the navigation entry point
  ("Jadwal & Readiness" link) plus the **current-staff resolution** on mobile
  (the `staff.id` for `markGatePassed`/`setAreaTargetDate`). This slice assumes
  that exists; if not, it must define a minimal `useCurrentStaff()`.
- **Shared infra slices (assumed earlier):** the AsyncStorage react-query
  persister + `PERSISTED_KEY_ROOTS`, the shared SANO design tokens
  (`SANO_Brand_Graphic_Standard.md`) feeding NativeWind, and the
  `@datum/core` package scaffold itself (this slice creates `core/gates/*` +
  `core/matrix/*` if first to need them).
- **`card_events` / board mutation slice:** readiness is derived from
  `card_events`; this slice only **reads** them via `recomputeProjectGates`. The
  fire-and-forget post-event recompute (web's `createCardEvent` →
  `recomputeProjectGates`) belongs to the events slice; on mobile, that slice
  should call `core.recomputeProjectGates` after a gate-relevant event, OR this
  slice's manual recompute + realtime invalidation covers it.

**Out of scope for `schedule-gates`:**

- The full `AreaGateMatrix` interactive grid (owned by the matrix slice; this
  slice surfaces status inside the area accordion, not the full matrix UI).
- Editing `card_events` / the work-stream that *drives* readiness (board/events
  slices).
- `compute_project_schedule` triggering from kickoff-date editing on mobile
  (project-settings slice). `recomputeProjectSchedule` is extracted to core for
  coherence but not wired to a mobile screen here.
- A mutation **queue** for offline gate passes (v1 disables offline; queue is a
  later iteration).
- Adding `area_gate_status` to the realtime publication (a DB migration
  follow-up if not already published — flagged in §5/§9).
- Any change to the rule engine logic or `RULE_VERSION` (pure extraction only).
