# Mobile Design Spec — Rooms & Areas (slug: `rooms-areas`)

Date: 2026-06-20
Status: Design (no implementation)
Slice: `rooms-areas` (mobile parity slice)

> Design doc only. No source files modified. Every behavior below is grounded in
> the cited web files; nothing here invents new server logic. Where a web file
> already contains the exact rule (room-stage derivation, area validation, the
> AI proposal normalizer), mobile reuses it through `@datum/core` rather than
> re-implementing it.

---

## 1. Goal & scope

This slice brings two tightly-coupled web surfaces to mobile at parity:

1. **Ruangan (Rooms)** — the read-first "one row per area" daily glance
   (`apps/web/app/(app)/project/[slug]/rooms/page.tsx` → `RoomsView`). Each room
   shows its single derived pipeline **stage**, **blocker count**, **next action**
   hint, and **relative last-activity**, sorted by urgency. Tapping a room
   deep-links to the project board scoped to that area.
2. **Area management + assisted setup** — the CRUD + AI-detection surface that
   lives in project settings on web (`AreasManager` table + `AddAreaForm` +
   inline `AreaEditRow`, plus the `AreaSetup` modal that calls `/api/areas/suggest`
   and applies a reviewed proposal via `applyAreaProposal`).

The two are one slice because rooms are *derived from* areas: a room is an area
with its gate cells folded into a single stage (`getProjectRooms` →
`fetchMatrix` → `deriveStage`). Editing/creating/detecting areas is the only way
to change which rooms exist, so the management surface is the natural mobile
companion to the rooms glance.

**In scope for this mobile slice:**

- Rooms list screen (urgency-sorted, read-only) per project, with stage chip,
  blocker badge, next-action line, relative time, and tap-through to the board.
- Areas manager screen: list areas, add area, edit area (inline → sheet on
  mobile), delete area (principal/admin only), reorder areas.
- Assisted "Deteksi ruangan otomatis" flow: request AI proposal, review +
  trim (toggle areas, rename, toggle low-confidence card links), apply.
- Empty / loading / error / offline states for every screen.

**Explicitly NOT a literal port:**

- The desktop `AreasManager` 7-column `min-w-[44rem]` horizontal-scroll **table**
  is not viable on a ~380px viewport. §4 specifies a card-list replacement with
  an edit **sheet** instead of an inline-table row.
- The `AreaSetup` `<dialog>` becomes a full-height mobile modal/sheet route.

The AI extraction itself (the Anthropic call in `extract.ts`) stays **server-side
only** — mobile does NOT call Anthropic directly. §3 / §5 specify how mobile
reaches it.

---

## 2. Web behavior mirrored — exact files + functions

Read and mirrored (reuse the cited logic; do not re-derive):

| Concern | Web file | Function / symbol |
| --- | --- | --- |
| Rooms page composition / not-found | `apps/web/app/(app)/project/[slug]/rooms/page.tsx` | default `ProjectRoomsPage` (loads via `getProjectRooms(slug)`, null → not-found branch, passes `now={Date.now()}`) |
| Rooms assembly (areas + cells + activity → rooms, sorted) | `apps/web/lib/rooms/queries.ts` | `getProjectRooms`, `ProjectRooms` type |
| Pure room derivation (stage / blockers / progress / next-action / sort / relative time) | `apps/web/lib/rooms/derive.ts` | `deriveStage`, `blockerCount`, `stageProgress`, `isHandoverReady`, `nextAction`, `sortRoomsByUrgency`, `relativeTimeId`, types `Room`, `RoomGateCell`, `RoomStage`, `NextAction`, `CellStatus` |
| Derivation contract (the locked behavior) | `apps/web/tests/unit/rooms-derive.test.ts` | full spec of every branch — mobile reuses the same module so these tests stay green |
| Rooms render (list, header, empty) | `apps/web/components/rooms/RoomsView.tsx` | `RoomsView`, `EmptyState` |
| Single room row (deep-link, layout, tone colors) | `apps/web/components/rooms/RoomRow.tsx` | `RoomRow`, `ACTION_TONE` |
| Stage chip (palette/symbol, shared with matrix legend) | `apps/web/components/rooms/StageChip.tsx` | `StageChip`, `STAGE_STYLE` |
| Matrix read (areas + per-(area,gate) cells) | `apps/web/lib/matrix/fetch-matrix.ts` | `fetchMatrix`, `MatrixData`, `MatrixArea`, `MatrixCell` |
| Gate labels | `apps/web/lib/gates/labels.ts` | `gateShortName`, `GATE_SHORT_NAME` |
| Area CRUD mutations + Zod | `apps/web/lib/projects/area-mutations.ts` | `createArea`, `updateArea`, `deleteArea`, `reorderAreas`, `CreateInput`, `UpdateInput`, `DeleteInput`, `ReorderInput`, `AREA_TYPES`, `AreaMutationResult`, `optStr`, `optNum` |
| Areas manager UI (table, add form, edit row, delete confirm) | `apps/web/components/projects/AreasManager.tsx` | `AreasManager`, `AddAreaForm`, `AreaEditRow`, `AREA_TYPE_OPTIONS`, `AREA_TYPE_LABELS`, `fmtAreaType`, `fmtSqm` |
| AI extraction (prompt + normalize + validate) | `apps/web/lib/areas/extract.ts` | `extractAreaProposal`, `normalizeProposal`, `normalizeAreaCode`, `parseModelJson`, `AREA_TYPES`, types `AreaProposal`, `ProposedArea`, `ProposedAssignment`, `ExtractCard`, `ExistingArea`, `AreaType`, `ModelRunner` |
| Suggest endpoint (auth + membership + card/area read + AI call) | `apps/web/app/api/areas/suggest/route.ts` | `POST` (Zod `Body`, `MAX_CARDS=200`, cost-free card select, existing-area read) |
| Apply reviewed proposal (insert areas + link cards) | `apps/web/lib/areas/suggest-mutations.ts` | `applyAreaProposal`, `ApplyInput`, `ApproveAreaSchema`, `ApproveAssignmentSchema`, `ApplyAreaProposalResult`, `ApplyAreaProposalInput` |
| Assisted-setup UI (review/apply phases) | `apps/web/components/area-setup/AreaSetup.tsx` | `AreaSetup`, `ReviewBody`, `AreaReviewCard`, `LOW_CONFIDENCE=0.5`, `AREA_TYPE_LABELS` |
| Current staff + delete gate | `apps/web/lib/auth/require-role.ts` | `getCurrentStaff`, `canManageAccess` (principal/admin) |
| Atomic reorder RPC | `packages/db/supabase/migrations/20260605000002_reorder_areas_rpc.sql` | `reorder_project_areas(p_project_id, p_area_ids)` (security invoker) |

### Key invariants that MUST carry to mobile verbatim (logic, not UI)

1. **Room stage is derived from gate cells, never re-read from events.**
   `getProjectRooms` reuses `fetchMatrix` cells and folds them with `deriveStage`
   (queries.ts:75-94). `deriveStage` picks the *furthest* `in_progress|blocked`
   gate as the active stage; else the furthest `passed|ready_for_handoff`; else
   `none` (derive.ts:42-61). A blocked-but-earlier gate does **not** pull the
   stage backward — its blocker is surfaced via `blockerCount`/`nextAction`
   (locked by `rooms-derive.test.ts:37-50`). Mobile reuses the exact module.

2. **Urgency sort order is fixed:** blockers desc → `stageProgress` desc →
   `lastActivityAt` desc → `sortOrder` asc (derive.ts:145-156;
   `rooms-derive.test.ts:140-153`). Reused via core, not re-sorted on the client.

3. **`relativeTimeId` is pure with injected `now`** (derive.ts:162-179). The web
   server passes `now={Date.now()}` once per request so all rows render
   deterministically. Mobile must pass a single `now` captured at render (and
   refresh it on focus / realtime tick) — never call `Date.now()` per row.

4. **Existing-area authority in the AI proposal.** `normalizeProposal` seeds the
   area map with existing areas (the model can't rename/retype them), merges only
   genuinely-new model codes, normalizes every `area_code`, drops assignments to
   unknown cards/codes, keeps one assignment per card (highest confidence),
   coerces off-enum `area_type` → `general`, clamps confidence to [0,1]
   (extract.ts:146-214). Mobile reuses this normalizer unchanged; it is the
   trust boundary for model output.

5. **Apply sends only NEW areas + kept links; existing codes are reused, not
   re-inserted.** `AreaSetup.apply()` filters `!isExisting` for the areas payload
   and only includes assignments whose area is included (AreaSetup.tsx:181-218).
   `applyAreaProposal` then skips codes that already exist, dedupes within the
   request, appends `sort_order` after current max, and upserts `card_areas` with
   `ignoreDuplicates` (suggest-mutations.ts:73-171). Mobile mirrors both the
   client filter and the server contract.

6. **Cost-free extraction input.** The suggest endpoint feeds the model ONLY
   `id/title/current_summary/topic.name` of **active** cards, newest-first, capped
   at 200 — never amounts, payloads, or vendor data (route.ts:56-63 + the
   `ExtractCard` doc-comment extract.ts:38-45). Mobile must hit the same
   server-side endpoint/core fn so this guarantee is preserved; mobile never
   assembles a prompt locally.

7. **Delete is principal/admin only at every layer.** `deleteArea` gates with
   `canManageAccess` (area-mutations.ts:193-196); `areas_delete` RLS stays
   `current_can_manage_projects()` (migration `20260612000001` comment lines
   22-23). Create/edit/reorder are open to any project member
   (`20260612000001_areas_staff_write_rls.sql`). Mobile mirrors exactly — show
   the delete affordance only when `canManageAccess` is true, and rely on RLS as
   the real enforcement.

8. **FK-protected delete + unique-code messages.** `deleteArea` maps Postgres
   `23503` → "Area tidak bisa dihapus karena masih terkait dengan kartu atau
   status gate." (area-mutations.ts:205-210); create/update map `23505` →
   `Kode area "X" sudah ada di proyek ini` (area-mutations.ts:93-95, 164-166).
   These Indonesian strings are returned by core and rendered verbatim on mobile.

9. **Reorder is one atomic RPC.** `reorderAreas` calls `reorder_project_areas`
   which renumbers in a single UPDATE under caller RLS and rejects foreign
   area_ids (area-mutations.ts:251-254; reorder RPC migration). Mobile reuses the
   same RPC via core — never loops per-row UPDATEs.

---

## 3. `@datum/core` surface to extract (strangler step)

> HARD RULE reminder: every core export takes `SupabaseClient<Database>` (from
> `@datum/db`) as its first argument (except the already-pure data-in/data-out
> functions). No `server-only`, no `next/*`, no React. The AI network call is the
> one piece that stays a server concern (see 3e).

### 3a. Pure room derivation (move as-is — already pure, no Supabase, no next/*)

`apps/web/lib/rooms/derive.ts` has zero `next/*` / `server-only` / React imports
— it is the cleanest extraction in the slice. Move the whole module to
**`core/rooms/derive.ts`** unchanged:

```ts
// core/rooms/derive.ts  (from apps/web/lib/rooms/derive.ts)
export function deriveStage(cells: RoomGateCell[]): RoomStage
export function blockerCount(cells: RoomGateCell[]): number
export function stageProgress(stage: RoomStage): number
export function isHandoverReady(cells: RoomGateCell[], stage: RoomStage): boolean
export function nextAction(stage: RoomStage, blockers: number, activeCards: number, handoverReady: boolean): NextAction
export function sortRoomsByUrgency(rooms: Room[]): Room[]
export function relativeTimeId(iso: string | null, now: number): string | null
export type Room, RoomGateCell, RoomStage, NextAction, CellStatus
```

Its only imports are `@datum/types` (`GateCodes`, `GateCode`) and two web modules:
`@/lib/gates/readiness-rules` (just the `ReadinessState` type) and
`@/lib/gates/labels` (`gateShortName`). Both should move with/alongside the
`schedule-gates` slice's `core/gates/*` extraction (see §11 dependency). If that
hasn't landed, this slice extracts the minimal `gateShortName` +
`GATE_SHORT_NAME` into `core/gates/labels.ts` and the `ReadinessState` union into
`core/gates/readiness-rules.ts` (type-only) so `derive.ts` resolves.

**Strangler step:** repoint `apps/web/lib/rooms/derive.ts` to re-export from
`@datum/core` (or delete it and update importers). The existing
`rooms-derive.test.ts` then imports the same logic and must stay green — that is
the verification gate for this extraction.

### 3b. Rooms assembly (extract query body; web wrapper resolves slug)

`getProjectRooms` (queries.ts) is async + reads Supabase but has **no `next/*`**.
Extract its body into core, taking the client + a resolved projectId. Keep slug→
project resolution where it belongs:

```ts
// core/rooms/get-rooms.ts
export type ProjectRooms = { projectId: string; projectCode: string; projectName: string; rooms: Room[] };
export async function getProjectRooms(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<ProjectRooms | null>
```

This calls `core.fetchMatrix(supabase, projectId)` (extracted by `schedule-gates`),
groups cells by area, runs the single `card_areas → cards(last_event_at)` join
for activity, then maps each area through `deriveStage`/`blockerCount`/
`isHandoverReady`/`nextAction` and `sortRoomsByUrgency` — byte-for-byte the
queries.ts:42-101 logic.

- **Web repoint:** `apps/web/lib/rooms/queries.ts` becomes a thin wrapper that
  resolves `project_code → id` (its current `projects` select, queries.ts:35-40)
  then calls `core.getProjectRooms(supabase, id)`. The web rooms page is unchanged.
- **Mobile:** resolves the project the same way the board/projects slice already
  does, then calls `core.getProjectRooms(supabase, id)` directly.

> Note: web today resolves by `project_code` (slug). Mobile navigates by
> project id/code per its router; offer a small `core/rooms/get-rooms-by-code.ts`
> helper `(supabase, code)` if mobile routes by code, so both sides share the
> resolution. Keep `fetchMatrix` as the single matrix read both slices import.

### 3c. Area CRUD logic (extract bodies; web keeps `"use server"` + `revalidatePath`)

`apps/web/lib/projects/area-mutations.ts` is `"use server"` and mixes the real
DB work with `revalidatePath`. Extract the pure DB+validation core, drop the
`FormData` coupling (core takes typed input), and leave web a thin
`"use server"` wrapper that parses `FormData`, calls core, then revalidates.

```ts
// core/areas/mutations.ts
export const AREA_TYPES: readonly AreaType[]            // shared single source
export const CreateAreaSchema, UpdateAreaSchema, DeleteAreaSchema, ReorderAreaSchema  // Zod
export type AreaMutationResult = { ok: true } | { ok: false; error: string }

export async function createArea(supabase: SupabaseClient<Database>, input: CreateAreaInput): Promise<AreaMutationResult>
export async function updateArea(supabase: SupabaseClient<Database>, input: UpdateAreaInput): Promise<AreaMutationResult>
export async function deleteArea(supabase: SupabaseClient<Database>, caller: CurrentStaff | null, input: DeleteAreaInput): Promise<AreaMutationResult>
export async function reorderAreas(supabase: SupabaseClient<Database>, input: ReorderAreaInput): Promise<AreaMutationResult>
```

Behavior preserved exactly:
- `createArea`: read max `sort_order`, append at end, insert, map `23505`
  (area-mutations.ts:73-97).
- `updateArea`: patch with optional `sort_order`, map `23505`
  (area-mutations.ts:140-168).
- `deleteArea`: takes the **resolved caller** (core can't call `getCurrentStaff`
  — that's a web `server-only` helper). The gate `canManageAccess(caller)` (also
  extracted to `core/auth/roles.ts` as a pure predicate) runs inside core; maps
  `23503` (area-mutations.ts:193-211).
- `reorderAreas`: calls the `reorder_project_areas` RPC (area-mutations.ts:251-254).

**Web repoint:** the four `"use server"` functions keep parsing `FormData` (their
`optStr`/`optNum`/`CreateInput.parse` lines) but delegate the DB work to core,
then run the existing `revalidatePath("/project/{code}/settings"|"/schedule")`
calls (area-mutations.ts:99-101 etc). Web's `AreasManager`/`AddAreaForm` keep
calling the server actions — unchanged.

**Mobile:** builds the typed input object directly (no FormData), resolves the
current staff from its session (the `staff` row for `auth.uid()` — mirror however
the projects/board slice resolves current staff on mobile), and calls
`core.createArea(supabase, input)` etc. RLS enforces membership/delete-role on
both sides.

> `getCurrentStaff` itself stays web-only (it uses the server client); the slice
> extracts only the pure `canManageAccess`/role predicate into `core/auth/roles.ts`
> so both platforms gate the delete UI identically. The DB DELETE policy is the
> real enforcement regardless.

### 3d. AI proposal normalization (move the pure core; keep the network seam)

`extract.ts` already separates the **pure normalizer** from the **network call**
via the injectable `ModelRunner` seam (extract.ts:275-320). Extract the pure half
to core; keep the Anthropic-bound default runner server-side.

```ts
// core/areas/extract.ts  (pure half — no Anthropic import)
export function normalizeProposal(raw: unknown, ctx: { cards: ExtractCard[]; existingAreas: ExistingArea[] }): AreaProposal
export function normalizeAreaCode(raw: string): string
export function parseModelJson(rawText: string): unknown
export const AREA_TYPES; export type AreaType, AreaProposal, ProposedArea, ProposedAssignment, ExtractCard, ExistingArea
```

The Anthropic-dependent `extractAreaProposal` + `defaultRunModel` +
`EXTRACT_SYSTEM` + `buildUserContent` stay in **`apps/web/lib/areas/extract.ts`**
(they import `@/lib/assistant/anthropic`, which is server-only). Web's
`extractAreaProposal` imports `normalizeProposal`/`parseModelJson` from core.

### 3e. Apply reviewed proposal (extract DB body; reuse Zod)

`applyAreaProposal` (suggest-mutations.ts) is `"use server"` + `revalidatePath`.
Extract the DB body to core:

```ts
// core/areas/apply-proposal.ts
export const ApplyProposalSchema, ApproveAreaSchema, ApproveAssignmentSchema  // Zod
export type ApplyAreaProposalInput, ApplyAreaProposalResult
export async function applyAreaProposal(
  supabase: SupabaseClient<Database>,
  caller: CurrentStaff | null,
  input: ApplyAreaProposalInput,
): Promise<ApplyAreaProposalResult>
```

Preserves: membership re-check via `projects` select (suggest-mutations.ts:62-71),
load existing codes→ids + max sort, insert only new/deduped areas mapping `42501`
RLS denials, upsert `card_areas` with `ignoreDuplicates` mapping `42501`, return
`{createdAreas, linkedCards}` (suggest-mutations.ts:73-178). Web wrapper adds the
three `revalidatePath` calls.

### 3f. The mobile "suggest" path (read + AI, server-side)

The AI call must stay server-side (Anthropic key, cost-free prompt guarantee).
Two viable options — **recommend Option A**:

- **Option A (reuse the existing HTTP endpoint):** mobile POSTs to
  `/api/areas/suggest` with `{projectId}` and the user's Supabase access token in
  the `Authorization` header (the endpoint already runs `getCurrentStaff` +
  membership RLS, route.ts:25-53). This is the *only* place mobile uses HTTP
  instead of calling core directly, and it's justified: the prompt-assembly + key
  live on the server. The endpoint returns `{ok, proposal, cards}` exactly as the
  web `AreaSetup` consumes (route.ts:105-111).
- **Option B (mobile assembles the read, server only runs the model):** mobile
  reads cards/existing-areas via core, then calls a thin server route that takes
  the prepared `ctx` and runs only `extractAreaProposal`. Rejected: it would put
  the cost-free card-selection rule on the client (invariant #6 risk) and
  duplicate route.ts:56-103. Keep selection server-side.

`applyAreaProposal` (the write) goes through **core directly** with the mobile
anon client (RLS enforces membership) — no HTTP needed.

### 3g. Shared query keys (host in core per LOCKED DECISION 1)

Web's `apps/web/lib/query/keys.ts` currently has only `board/projects/card`. Add
rooms/areas keys to the shared factory so web and mobile agree:

```ts
keys.rooms(projectId)        // ProjectRooms
keys.areas(projectId)        // Area[]
keys.areaProposal(projectId) // transient (AI proposal); not persisted
```

Mirror `PERSISTED_KEY_ROOTS` — persist `rooms` and `areas`, **never**
`areaProposal` (it's transient model output).

---

## 4. Mobile screens — Expo Router routes + NativeWind + states

Navigation under LOCKED DECISION 4. Rooms & Areas live under the Matrix tab's
project stack (the tab already lists projects, `apps/mobile/app/(tabs)/matrix.tsx`).
Proposed nested stack routes:

```
app/(tabs)/matrix/
  index.tsx                         # project list (exists, to be migrated to RQ)
  [code]/
    rooms.tsx                       # Rooms (Ruangan) glance        → screen A
    areas/
      index.tsx                     # Areas manager (list)          → screen B
      new.tsx                       # Add area (form sheet)         → screen C
      [areaId]/edit.tsx             # Edit area (form sheet)        → screen D
      detect.tsx                    # Assisted setup (AI review)    → screen E
```

`detect.tsx` and the add/edit forms present as **bottom sheets / modal-stack
screens** (`presentation: "modal"`), matching the web `AreaSetup` `<dialog>` and
the inline edit affordances.

All visuals use NativeWind with the shared SANO tokens (LOCKED DECISION 2). The
web uses CSS vars `--surface`, `--foreground`, `--sand`, `--sand-dark`,
`--sand-tint`, `--border`, `--text-secondary`, `--text-muted`, `--flag-critical`,
`--flag-ok`, `--flag-warning` and the literal hex set in RoomRow/StageChip
(`#C62828` urgent, `#E65100` in-progress, `#1565C0` ready, `#3D8B40` passed,
`#7A6B56` sand-dark, `#141210` ink). These MUST come from the shared token source,
not be re-hardcoded.

### Screen A — Rooms (Ruangan) — `matrix/[code]/rooms.tsx`

Mirrors `RoomsView` + `RoomRow` + `StageChip`.

- **Header:** eyebrow "Ruangan", project name (`projectName`), subline
  `{count} ruangan · Lihat matrix detail →` (link to the schedule screen). Back
  affordance to the board (web's `← {code} Board`, RoomsView.tsx:16-22).
- **List:** `FlatList` of room rows. Each row (≥56px tappable, RoomRow.tsx:25):
  - Line 1: `areaName` (truncate) + floor pill (uppercase, sand-dark) + blocker
    badge `{n} blocker` (red bg) when `blockers > 0`.
  - Line 2: `<StageChip>` (symbol + `Gate X · {shortName}` / `… selesai` /
    "Belum mulai", palette from `STAGE_STYLE`) + relative time
    (`relativeTimeId(lastActivityAt, now)`).
  - Line 3: `action.text` colored by `ACTION_TONE[action.tone]`
    (urgent/active/ready/idle), single-line truncate.
  - Chevron `›` trailing.
  - **Tap →** the project board scoped to this area. Web links
    `/project/{code}?area={areaCode}` (RoomRow.tsx:24); on mobile, navigate to the
    board route with an `area` param (the board may ignore it until board
    filtering lands — web does too; degrade gracefully).
- **States:**
  - *Loading:* skeleton rows (or RQ `initialData` from cache → instant; no
    spinner needed when persisted cache exists).
  - *Empty (no areas):* mirror `RoomsView.EmptyState` (RoomsView.tsx:55-72):
    "Proyek ini belum punya ruangan." + explainer + a button **"Buka Areas"**
    → `matrix/[code]/areas` (web links to settings?tab=areas; mobile links to the
    Areas screen) and a secondary **"Deteksi ruangan otomatis"** → `detect`.
  - *Error:* inline card with the error + "Coba lagi" (refetch).
  - *Offline:* render last persisted `rooms` with a subtle "Mode luring — data
    terakhir" banner; pull-to-refresh disabled-but-queued (§8).

### Screen B — Areas manager — `matrix/[code]/areas/index.tsx`

Mirrors `AreasManager` but as a **card list**, not a table (the `min-w-[44rem]`
table won't fit).

- **Header:** "Area" + `{areas.length} area` count + a primary button
  **"Deteksi ruangan otomatis"** (SparkIcon) → `detect` (AreasManager.tsx:128-135),
  and a **"+ Tambah area"** button → `new`.
- **List:** one card per area, sorted by `sort_order`. Each card shows:
  - `area_code` (mono), `area_name` (semibold).
  - meta row: floor (`floor ?? "—"`), type (`fmtAreaType`), `area_sqm`
    (`fmtSqm`, `id-ID` locale 0–2 dp), `sort_order`.
  - Actions: **edit** → `[areaId]/edit`; **hapus** (red) only when
    `canDelete` (= `canManageAccess(currentStaff)`), with a native
    `Alert.alert` confirm reproducing the web `confirm()` text:
    `Hapus area "{code} — {name}" dari proyek ini?` (AreasManager.tsx:105).
  - **Reorder:** long-press drag (a draggable `FlatList`) → on drop call
    `reorderAreas`. Web has no drag UI in `AreasManager` (it exposes `sort_order`
    as an editable number in the edit row, AreaEditRow.tsx:334-345) plus the
    `reorderAreas` action exists; mobile prefers drag-to-reorder as the
    phone-native equivalent and ALSO keeps `sortOrder` editable in the edit sheet
    for parity. Both funnel to the same `reorder_project_areas` RPC / `updateArea`.
- **States:**
  - *Empty:* mirror AreasManager.tsx:137-140: "Belum ada area. Tambah area
    pertama… untuk mengaktifkan matrix area × gate." + the add button.
  - *Loading / Error / Offline:* same pattern as Screen A.
  - *Mutation error:* inline error strip below the list (the verbatim
    Indonesian `res.error`), mirroring AreasManager.tsx:214-218.

### Screen C / D — Add / Edit area form — `areas/new.tsx`, `areas/[areaId]/edit.tsx`

One shared form component (mirrors `AddAreaForm` + `AreaEditRow`). Fields:
`areaCode` (mono, required), `areaName` (required), `floor` (optional, placeholder
"Lt. 1"), `areaType` (`Picker` from `AREA_TYPE_OPTIONS`, default `general`),
`areaSqm` (decimal keypad, optional). Edit additionally exposes `sortOrder`
(numeric keypad). Submit disabled until code+name non-empty (AddAreaForm.tsx:517,
AreaEditRow.tsx:352).

- Add → `core.createArea`; Edit → `core.updateArea`; both close the sheet on
  `{ok:true}`, surface `res.error` verbatim on failure (e.g. the `23505`
  "sudah ada" string). On add, AddAreaForm keeps the last `areaType` selected for
  runs of similar areas (AddAreaForm.tsx:411) — mirror that.
- **States:** idle / submitting (button "Menambah…" / "…") / error strip /
  success toast `Area "{code}" ditambahkan.` (AddAreaForm.tsx:406).

### Screen E — Assisted setup (Deteksi ruangan otomatis) — `areas/detect.tsx`

Full-height modal mirroring `AreaSetup`'s phase machine
(`loading | review | applying | done | error`, AreaSetup.tsx:36).

- **Header:** SparkIcon + "Deteksi ruangan otomatis" + close (disabled while
  `applying`).
- **loading:** mirror `LoadingState` — pulsing spark, "Menganalisis kartu…" +
  the "AI membaca judul…" sub-line (AreaSetup.tsx:319-331).
- **review (`ReviewBody`/`AreaReviewCard`):** the AI proposal as a reviewable
  list:
  - Per area: checkbox (`include`, default true), **editable name** input,
    meta row (`areaCode` mono · type label · floor) and a **"sudah ada" / "baru"**
    pill (`isExisting`). Disabling the area dims it and disables its inputs
    (AreaReviewCard.tsx:472-512).
  - Nested per area: card-link rows — checkbox (`include`, defaulted from
    `confidence >= LOW_CONFIDENCE = 0.5`, AreaSetup.tsx:130), card title
    (fallback `Kartu {id.slice(0,8)}`), confidence `{n}%` colored warning when
    `< 0.5` (AreaReviewCard.tsx:514-548). Empty: "Belum ada kartu yang jelas
    untuk area ini."
  - Footer summary `{newAreaCount} area baru · {checkedLinks} kartu ditautkan`
    + **Batal** / **Terapkan** (disabled when `nothingToApply`, AreaSetup.tsx:220,
    286-309).
  - Proposal-empty (no areas): mirror AreaSetup.tsx:416-424 italic explainer.
- **applying:** "Menerapkan…", inputs locked.
- **done (`DoneState`):** check badge + `{createdAreas} area baru dibuat ·
  {linkedCards} kartu ditautkan` + **"Hitung ulang readiness →"** (link to the
  schedule screen, AreaSetup.tsx:382-386) + **"Selesai"** (close, invalidate
  rooms+areas).
- **error:** `ErrorState` — message + "Coba lagi" (re-request the proposal,
  AreaSetup.tsx:334-355).

---

## 5. Data fetching — react-query keys, realtime, optimistic updates

Mobile uses `@tanstack/react-query` (LOCKED DECISION 3), calling `@datum/core`
directly with the mobile anon client (`apps/mobile/lib/supabase/client.ts`). No
HTTP layer except the suggest endpoint (§3f Option A).

### Query keys (from core, §3g)

- `keys.rooms(projectId)` → `core.getProjectRooms(supabase, projectId)` →
  `ProjectRooms`. Drives Screen A. `staleTime` ~30s; refetch on focus.
- `keys.areas(projectId)` → `supabase.from("areas").select(...).order("sort_order")`
  (wrap as `core.listAreas(supabase, projectId)`) → `Area[]`. Drives Screens B/C/D.
- `keys.areaProposal(projectId)` → POST `/api/areas/suggest` (§3f) → `{proposal,
  cards}`. `staleTime: 0`, `gcTime` short, **not persisted** — model output is
  transient and must be re-reviewed each time. Triggered when Screen E opens
  (mirrors `AreaSetup.load()` on mount, AreaSetup.tsx:135-141).

`now` for `relativeTimeId`: capture once at screen render in a ref; refresh on
focus + on realtime tick so relative times don't drift (web re-renders per request;
mobile re-derives on these triggers).

### Realtime (mirror `apps/web/lib/cards/realtime.ts` conventions)

Two concerns drive the rooms/areas screens: **area rows** (areas table) and
**gate cells** (`area_gate_status`, which changes the derived stage). Add a
channel modeled on `subscribeToProjectChanges`:

- Channel `rooms:{projectId}` subscribing to `postgres_changes` on:
  - `public.areas` filtered `project_id=eq.{projectId}` → invalidate
    `keys.areas` + `keys.rooms`.
  - `public.area_gate_status` filtered `project_id=eq.{projectId}` → invalidate
    `keys.rooms` (stage/blocker recompute).
  - `public.card_areas` (no project filter column → optionally subscribe on
    `cards`/`card_events` instead, since rooms' `lastActivityAt`/`activeCards`
    derive from card links; reuse the board slice's existing `cards`/`card_events`
    subscription rather than adding a second).
- Debounce ~250ms (realtime.ts:17-20) then `queryClient.invalidateQueries`.
- This makes a teammate's "apply proposal" (which inserts areas + links cards +
  marks gate cells stale, suggest-mutations.ts:155-159) appear live on both the
  Areas and Rooms screens.
- **Verify** `areas`, `area_gate_status`, `card_areas` are in the
  `supabase_realtime` publication. Web only confirmed cards/events/comments/topics
  (realtime.ts comment + migration `20260615000001`). If not published, fall back
  to refetch-on-focus + pull-to-refresh and flag a publication migration (§9/§11).

### Optimistic updates (mirror `apps/web/lib/query/mutations.ts` pattern:
`onMutate` cancel + snapshot + patch → `onError` rollback → `onSettled` invalidate)

- **createArea:** `onMutate` append a temp area (sort_order = max+1) to
  `keys.areas`; `onError` rollback + surface error; `onSettled` invalidate
  `keys.areas` + `keys.rooms`.
- **updateArea:** `onMutate` patch the cached area; rollback on error; invalidate
  `areas` + `rooms` on settle.
- **deleteArea:** `onMutate` remove from `keys.areas`; on error rollback and show
  the verbatim `23503` FK message; invalidate `areas` + `rooms`.
- **reorderAreas:** `onMutate` reorder + renumber the cached `areas` list
  instantly (this is the win for drag-to-reorder); rollback on error; invalidate
  `areas` + `rooms`.
- **applyAreaProposal:** NOT optimistic (server-batch insert + link). Show
  `applying`, then on success invalidate `rooms` + `areas` and show `DoneState`
  counts. Sticky correctness is the server's (it dedupes + ignores duplicate
  links).
- **suggest (proposal fetch):** not a mutation; plain query with retry on the
  manual "Coba lagi".

---

## 6. Mutations & validation — reuse Zod from core

All mutations reuse the **exact Zod schemas** extracted to core (§3c/§3e), so
mobile and web validate identically and return the same Indonesian messages:

- `createArea` / `updateArea`: `CreateAreaSchema` / `UpdateAreaSchema`
  (area-mutations.ts:38-46, 104-114) — `areaCode` 1–40 ("Kode area wajib"),
  `areaName` 1–120 ("Nama area wajib"), `floor` ≤40 optional, `areaType` ∈
  `AREA_TYPES` enum, `areaSqm` nonnegative ≤99999.99 optional, update adds
  `sortOrder` int 0–99999 optional. Mobile passes typed values (it parses its own
  numeric/decimal inputs to `number | undefined`, mirroring `optNum`).
- `deleteArea`: `DeleteAreaSchema` (uuid ids + code) **plus** the
  `canManageAccess(caller)` gate inside core (area-mutations.ts:181-196).
- `reorderAreas`: `ReorderAreaSchema` — `areaIds` uuid[] 1–200
  (area-mutations.ts:219-223). Mobile sends the array directly (no JSON-in-FormData
  round-trip that web does at area-mutations.ts:228-229).
- `applyAreaProposal`: `ApplyProposalSchema` (suggest-mutations.ts:16-35) —
  `projectId` uuid, `projectCode` 1–40, `areas` ApproveArea[] ≤200 (code/name/
  floor/`areaType` enum), `assignments` ApproveAssignment[] ≤2000 (cardId uuid +
  areaCode). Mobile builds the payload exactly as `AreaSetup.apply()` does:
  only `include && !isExisting` areas; only `include && includedCodes.has(code)`
  assignments (AreaSetup.tsx:186-201).
- AI proposal normalization: `normalizeProposal` (extract.ts) runs **server-side**
  inside the suggest endpoint; mobile receives an already-validated `AreaProposal`.
  Mobile must still defensively type the response (the proposal is data) but never
  re-runs the normalizer locally.

Core functions return the discriminated union
(`{ok:true,...} | {ok:false,error}`); mobile renders `error` verbatim (already
Indonesian). The **caller** (current staff) for `deleteArea`/`applyAreaProposal`
comes from the mobile session — resolve once and pass in; RLS is the real gate.

---

## 7. RLS & permissions notes (per role)

Roles: `principal / designer / pic / site_supervisor / admin / estimator`
(`packages/types/src/domain.ts`). Grounded in the migrations:

- **Read areas / area_gate_status / card_areas / cards:** gated by
  `current_can_read_project(project_id)` (project membership). `getProjectRooms`
  and the areas list rely on this — no extra app-layer auth
  (queries.ts:29-31 doc-comment). All six roles that are members can view Rooms +
  Areas.
- **Create area** (`areas_insert`, `20260612000001_areas_staff_write_rls.sql:11-13`):
  `with check (current_can_read_project(project_id))` — **any project member**,
  all roles. Web's `createArea` mirrors with a signed-in check only
  (area-mutations.ts:67-70 comment).
- **Edit / reorder area** (`areas_update`, same migration:17-20): any project
  member. `reorder_project_areas` runs **security invoker** so the `areas_update`
  policy gates it (reorder RPC migration:15) and it rejects foreign area_ids
  (errcode 22023).
- **Delete area** (`areas_delete`, unchanged): `current_can_manage_projects()` =
  **principal/admin only** (migration:22-23). Mobile shows the delete affordance
  only when `canManageAccess(currentStaff)` is true (mirrors `canDelete` prop,
  AreasManager.tsx:64-66) — but RLS is the enforcement; a non-admin's delete
  would be denied server-side regardless.
- **Apply proposal:** `applyAreaProposal` writes `areas` (insert) + `card_areas`
  (upsert) under the **session client** only, never service role
  (suggest-mutations.ts:11-14). Both inserts gate on membership; the code maps
  `42501` (RLS denial) to a clear Indonesian message
  (suggest-mutations.ts:124-129, 162-167). Mobile relies on the same RLS.
- **Suggest endpoint:** auth = signed-in staff (`getCurrentStaff`, route.ts:25-29)
  + membership read of the project (route.ts:43-53) before any AI call. Mobile's
  Option-A request carries the user's access token so the same checks apply.

Mobile must **not** add a stricter client role check than web (parity); it may
only mirror the principal/admin delete affordance.

---

## 8. Offline behavior

Mirror web's persistence (LOCKED DECISION 3): `@tanstack/react-query` +
AsyncStorage persister (mobile equivalent of web's idb-keyval persister in
`apps/web/lib/query`).

- **Persisted:** `keys.rooms(projectId)` and `keys.areas(projectId)` (add their
  roots to the mobile mirror of `PERSISTED_KEY_ROOTS`, keys.ts:7). Rooms and Areas
  open instantly from cache offline; a "Mode luring — data terakhir" banner shows
  when there's no connectivity.
- **NOT persisted:** `keys.areaProposal` — transient model output; the suggest
  flow requires connectivity + the Anthropic-backed endpoint. Offline, Screen E
  shows an offline message ("Deteksi ruangan butuh koneksi") instead of the
  loading state, with retry on reconnect.
- **Mutations offline:** create/update/delete/reorder go through React Query
  mutations. With the AsyncStorage persister + a mutation queue, optimistic
  patches show immediately and replay on reconnect; on failure they roll back and
  surface the verbatim error. **Conflict note:** `area_code` uniqueness and FK
  constraints are server-truth — a queued create that collides yields the `23505`
  message on replay; a queued delete that's now FK-bound yields `23503`. Surface
  these on reconnect rather than assuming success. (If a full offline mutation
  queue is out of scope for the foundation slice, degrade to: block writes while
  offline with a clear "butuh koneksi" message, and keep reads cache-first.)
- `applyAreaProposal` is online-only (it follows an online-only suggest call).

---

## 9. Edge cases

1. **Project has areas but no cards / no gate activity** → every room `stage:
   none`, `action: "Belum ada aktivitas — mulai dari kartu"` (derive.ts:120).
   Rooms list still renders; sort falls back to `sortOrder`.
2. **Project has no areas** → Rooms empty state (Screen A) routes to Areas /
   detect; Areas empty state prompts first add (Screen B).
3. **Blocked earlier gate behind an active later gate** → stage stays at the
   furthest active gate; blocker surfaced via badge + urgent next-action
   (invariant #1; `rooms-derive.test.ts:37-50`). Don't "fix" this on mobile.
4. **`relativeTimeId` future/clock-skew** → web returns "baru saja" for negative
   diffs (derive.ts:167). Mobile must pass a coherent `now`; device clock skew is
   accepted parity behavior.
5. **AI returns junk / unparseable** → `normalizeProposal` falls back to existing
   areas + no assignments (extract.ts:151-163); server already handles. Mobile
   shows the review with existing areas only (or the proposal-empty explainer).
6. **AI not configured** → suggest endpoint returns 503 +
   "Asisten belum dikonfigurasi…" (route.ts:113-121). Screen E error state shows
   it verbatim. (Per MEMORY: Anthropic key + SDK already wired for attachment
   understanding; confirm key present for the studio's deploy.)
7. **No active cards** → suggest returns `{ok:false, error:"Belum ada kartu
   aktif…"}` (route.ts:83-88). Screen E shows it; suggest "Tambah kartu dulu".
8. **Duplicate area_code** (manual or apply) → `23505` mapped to
   `Kode area "X" sudah ada di proyek ini` (area-mutations.ts:94, 165;
   apply dedupes silently, suggest-mutations.ts:92-105).
9. **Delete FK-bound area** → `23503` → "Area tidak bisa dihapus karena masih
   terkait dengan kartu atau status gate." (area-mutations.ts:205-210). Show in
   the Areas error strip.
10. **Non-admin attempts delete** → affordance hidden; if forced, RLS denies.
11. **Reorder set contains a foreign area_id** → RPC raises 22023
    (reorder migration:33-35); surface as a generic reorder failure + rollback.
12. **Realtime not published for areas/area_gate_status** → no live update;
    pull-to-refresh + focus refetch keep it fresh (flag migration, §11).
13. **Stale gate cells after apply** → the `card_areas` insert trigger marks
    affected cells stale (suggest-mutations.ts:155-156 comment); the room stage
    reflects the last recompute until a readiness recompute runs (owned by the
    `schedule-gates` slice). `DoneState`'s "Hitung ulang readiness →" routes
    there. Mobile mirrors this hand-off.

---

## 10. Testing

- **Core logic — vitest (reuses existing web tests):**
  - `core/rooms/derive.ts` is covered verbatim by the migrated
    `rooms-derive.test.ts` (all of `deriveStage`/`blockerCount`/`stageProgress`/
    `isHandoverReady`/`nextAction`/`sortRoomsByUrgency`/`relativeTimeId`). Moving
    the module must keep these green — the verification gate for the extraction.
  - `core/areas/extract.ts` `normalizeProposal`/`normalizeAreaCode`/
    `parseModelJson`: keep/port the existing extract unit tests (search
    `apps/web/tests/unit` for `extract`/`normalizeProposal`); cover the
    existing-wins, off-enum→general, confidence-clamp, one-per-card, unknown-code
    drop branches (extract.ts:146-214).
  - `core/areas/mutations.ts` + `core/areas/apply-proposal.ts`: unit-test against
    a fake/typed Supabase client — assert the `23505`/`23503`/`42501` mappings,
    dedupe, sort_order append, and `canManageAccess` delete gate.
- **Screens — @testing-library/react-native:**
  - Rooms list: renders stage chip text, blocker badge, action tone, relative
    time; empty state routes to Areas/detect; tap navigates to board with `area`
    param.
  - Areas manager: renders area cards, delete affordance hidden when
    `canDelete=false`, `Alert` confirm copy, reorder drag → `reorderAreas` called.
  - Add/Edit form: submit disabled until code+name, success/ error rendering, last
    `areaType` retained on add.
  - Detect (Screen E): phase machine (loading→review→applying→done), low-confidence
    links unchecked by default, `nothingToApply` disables Terapkan, apply payload
    excludes existing areas + unincluded links.
- **Realtime/offline:** integration test that a simulated `areas`/
  `area_gate_status` change invalidates the right keys; cache-first render with the
  persister offline; queued-mutation replay surfaces verbatim conflict errors.

---

## 11. Dependencies on other slices + Out of scope

**Depends on:**

- **`mobile-foundation`** — the shared `@datum/core` package scaffold, NativeWind
  + SANO tokens, React Query client + AsyncStorage persister + shared query-key
  factory, Supabase session/current-staff resolution, and the project-stack
  navigation shell. (`docs/.../2026-06-20-mobile-foundation-design.md`.)
- **`schedule-gates`** — owns the extraction of `core/matrix/fetch-matrix.ts`
  (`fetchMatrix`) and `core/gates/*` (`gateShortName`, `ReadinessState`,
  `GateCodes`). `core/rooms/get-rooms.ts` and `core/rooms/derive.ts` import these.
  Coordinate so the gate-label + matrix extraction lands once; if this slice runs
  first, extract the minimal `gateShortName`/`ReadinessState` and let
  schedule-gates adopt them.
- **`projects-board`** — owns the board route that the room rows deep-link into
  (`/project/{code}?area={areaCode}`) and the current-staff resolution pattern
  this slice reuses for the delete/apply caller.

**Out of scope:**

- Any change to the **AI extraction prompt / model selection** — the Anthropic
  call stays server-side and unchanged (extract.ts).
- **Readiness recompute** and gate advance/confirm — owned by `schedule-gates`;
  this slice only links to "Hitung ulang readiness →".
- **Board area-filtering** — the `?area=` param is a hook the board may ignore
  today (web does too, RoomRow.tsx:13-19); wiring board filtering is a board-slice
  concern.
- **`area_target_date`** (per-area handover re-baseline,
  `20260613000001_area_target_date.sql`) — schedule-gates' concern, not the areas
  manager.
- **Adding tables to the `supabase_realtime` publication** if `areas`/
  `area_gate_status`/`card_areas` aren't published — flagged as a verify/migration
  follow-up; mobile degrades to focus-refetch + pull-to-refresh until then.

---

### Open questions

1. **Suggest path:** confirm Option A (mobile → `/api/areas/suggest` with bearer
   token) vs a core+thin-route split. Recommended: Option A (keeps the cost-free
   card-selection rule server-side).
2. **Realtime publication:** are `areas`, `area_gate_status`, `card_areas` in
   `supabase_realtime`? If not, this slice ships focus-refetch only and files the
   publication migration.
3. **Offline writes:** is a mutation queue in the foundation slice, or do
   area writes block when offline (reads cache-first)? Affects §8.
4. **Project routing on mobile:** does the matrix stack route by `project_code`
   (slug, like web) or `id`? Determines whether `core/rooms/get-rooms-by-code.ts`
   is needed alongside the id-based core fn.
5. **Reorder UX:** confirm drag-to-reorder (recommended) over an editable
   `sort_order` field; both funnel to `reorder_project_areas`.
