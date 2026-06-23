# Mobile slice: Projects & Board — Design Spec

Slug: `projects-board`
Date: 2026-06-20
Status: Draft (design only — no implementation)

This spec covers the mobile-native parity of three web surfaces:
1. **Projects list** (the landing / "Matrix" tab) — grouped cover-card grid by development, with search + status filters.
2. **Project board** — topic columns of cards, the board filter strip, the mobile column carousel/tabs.
3. **Card create + move** with optimistic cache writes (the same pure helpers the web optimistic-move test exercises).

It also defines the first `@datum/core` extraction: the isomorphic board/projects/cards data-access + pure board-mapping logic that both `apps/web` and `apps/mobile` will consume.

---

## 1. Goal & scope

Deliver, natively on mobile via Expo Router + NativeWind + react-query, the read/grouping/board/create/move behavior that exists today in `apps/web`:

- **Projects landing** identical in grouping, filtering, covers, and developments to `apps/web/app/(app)/page.tsx` + `apps/web/components/projects/ProjectsList.tsx`.
- **Project board** identical in columns/cards/labels/deadline-chips and the filter+column-navigation model to `apps/web/components/board/Board.tsx` (which is *already* a mobile-shaped carousel + tabs layout — we mirror that interaction natively).
- **Create card** with the optimistic ghost-card behavior (`apps/web/components/board/AddCardForm.tsx` + `useAddCard`).
- **Move card** with optimistic column move (`apps/web/components/board/MoveCardControl.tsx` + `useMoveCard`), the exact behavior pinned by `apps/web/tests/unit/optimistic-board-move.test.ts`.
- **Create project** form parity with `apps/web/app/(app)/projects/new/page.tsx` + `apps/web/components/projects/ProjectCreateForm.tsx` (principal/admin only).
- **Create column (topic)** parity with `apps/web/components/board/AddColumnForm.tsx` + `createTopic`.

In scope for this slice's `@datum/core` extraction: the board read+map, projects-list read+map, developments read, grouping/filter/tint/cover helpers, and the create-card / create-topic / move-card / create-project mutations as client-injecting functions, plus the Zod input schemas for those mutations and the shared query-key factory.

Explicitly **not** in scope (owned by other slices): card detail / timeline / events / comments / attachments / members, advisor strip, chat dock, schedule/readiness, rooms, print, project settings/areas/members admin, search tiers. We extract only the board's *read* helpers it needs (`computeCardLabels`, `computeCardDeadlines`, `mapBoardBundle`); deeper card-detail logic is left for the Card Detail slice.

---

## 2. Web behavior mirrored — exact files + functions

### Projects landing (root `/`)
- `apps/web/app/(app)/page.tsx` — `HomePage()`: calls `getProjectsList(supabase)`, renders error / empty (`"Belum ada proyek yang ditugaskan."`) / list; computes `pendingDraftCount` (draft `card_event` `data_drafts`); fetches `getDevelopments(supabase)`; header copy `"{n} proyek aktif · {m} pengembangan."`, and the `+ Buat proyek` / Aktivitas / Morning brief / Cari action chips.
- `apps/web/components/projects/ProjectsList.tsx` — `ProjectsList()`: `useProjects(initialProjects)` (react-query, key `["projects"]`, `/api/projects`); local `query` + `status` state; `?dev=` URL scoping; `groupProjects(filterProjects(scoped, {query,status}))`; collapsible development sections (sticky search + status pills `Semua/Desain/Konstruksi/Finishing/Serah terima/Selesai`); empty filter result copy `"Tidak ada proyek yang cocok dengan filter."`; group header `▸/▾ {name} · {count}` + `area_label`.
- `apps/web/components/projects/ProjectCard.tsx` — `ProjectCard()`: cover `Image` from `project.cover_url`, fallback tinted `unitCode(project)` block via `developmentTint(development_name)`; `project_code` / `project_name` / `Client: {client_name ?? "-"}` / `statusLabel[status]`; links to `/project/{project_code}`. (`ProjectEditDialog` footer is settings-slice, out of scope here.)
- `apps/web/lib/projects/queries.ts` — `getProjectsList()` (joins `developments:development_id (name, area_label, sort_order)`, maps to `ProjectListItem`, derives `cover_url` via `coverImageUrl`) and `getDevelopments()`.
- `apps/web/lib/projects/grouping.ts` — `filterProjects()`, `groupProjects()`, `UNGROUPED_LABEL = "Belum dikelompokkan"` (ungrouped always last, sort by `sort_order` then name).
- `apps/web/lib/projects/cover.ts` — `coverImageUrl()` (public `project-covers` bucket URL).
- `apps/web/lib/projects/tint.ts` — `developmentTint()`, `TINTS`.

### Project board (`/project/[slug]`)
- `apps/web/app/(app)/project/[slug]/page.tsx` — `ProjectBoardPage()`: `getBoardForProject(supabase, slug)`; not-found copy `"Proyek tidak ditemukan: {slug}"`; header shows `{project_code} · {project_name}`; mobile one-row header (back + title + overflow menu) vs md two-row. (Advisor strip + ChatDock + settings/print/rooms/schedule links are other slices.)
- `apps/web/lib/cards/queries.ts` — `getBoardForProject()` (per-table reads under RLS: project, topics, cards, open-loop `card_events` of kinds `decision|client_request|work`, `card_areas`, `area_gate_status` cells), and the **pure** `mapBoardBundle(bundle, today)` which builds `Board = { project, columns: { topic, cards: CardWithLabels[] }[] }` using `computeCardLabels` + `computeCardDeadlines`. Types: `Board`, `BoardColumn`, `BoardBundle`.
- `apps/web/lib/cards/labels.ts` — `computeCardLabels(card, events)` (derived chips: `blocked`/`needs_decision`/`awaiting`/`pending`/`done`, Bahasa labels, max 3); `LABEL_STYLE`, `ACTOR_LABELS`, `CardWithLabels`, `LabelEvent`.
- `apps/web/lib/gates/board-deadlines.ts` — `computeCardDeadlines(links, cells, todayIso)` → `Map<cardId, {gateCode, targetEndDate}>`.
- `apps/web/components/board/Board.tsx` — `Board()`: `useBoard(code, initialBoard)`; realtime via `subscribeToProjectChanges` → `invalidateQueries(keys.board(code))`; filter state `query`/`statuses (default {"active"})`/`labelFilter`; `filteredColumns` memo (status set, label/overdue match via WIB `Asia/Jakarta` today, text match on title+summary); the **mobile column carousel** (`snap-x snap-mandatory`, IntersectionObserver tracking `activeTopicId`, `jumpToColumn`) — this is the native interaction we port directly.
- `apps/web/components/board/Column.tsx` — `Column()`: topic name header, empty-column copy `"Belum ada kartu di kolom ini"`, card list + `AddCardForm`.
- `apps/web/components/board/MiniCard.tsx` — `MiniCard()`: label chips + `DeadlineChip` (WIB-day math: `{gate} lewat {n} hari` / `{gate} hari ini` / `{gate} · {n} hari`, critical/warning/sand tiers), title, `current_summary` (2-line clamp), localized `last_event_at` (`id-ID`), Trello badge if `properties.trello_card_id`; optimistic ghost renders non-link with `opacity-70` + `aria-busy`.
- `apps/web/components/board/BoardFilter.tsx`, `BoardTabs.tsx` — the search/status/label filter strip and the column-tab strip (read for parity of controls + counts `matched/total`).
- `apps/web/components/board/AddColumnForm.tsx` — add-column input → `createTopic`.

### Create / move / create-project mutations
- `apps/web/lib/cards/mutations.ts`:
  - `createCard(formData)` — Zod `CreateCardInput` (`projectId/topicId/projectCode/title`), `toSlug()`, slug-uniqueness loop, insert `cards`, `revalidatePath`.
  - `createTopic(formData)` — Zod `CreateTopicInput` (`projectId/projectCode/name`), `toTopicCode()`, code-uniqueness loop, append at `max(sort_order)+1`, insert `topics` (`topic_type:"general"`), `23505` → "Kode kolom … sudah ada".
  - `moveCard(formData)` — Zod `MoveCardInput`, validates target topic belongs to the same project (`"Kolom tujuan ada di proyek lain"` / `"Kolom tujuan tidak ditemukan"`), updates `cards.topic_id`, `revalidatePath`.
- `apps/web/lib/projects/mutations.ts` — `createProject(formData)`: Zod `CreateProjectInput` (`projectCode` regex `^[A-Z0-9-]+$`, etc.), `canManageAccess` gate, insert `projects` (+ `principal_id`/`pic_id` by role), then insert `project_staff` for the creator (RLS access), AFTER-INSERT trigger seeds the 15-topic taxonomy, `23505` → "Kode proyek … sudah dipakai".
- Optimistic helpers (pure, already isolated): `apps/web/lib/cards/optimisticBoard.ts` — `makeOptimisticCard`, `applyAddCard`, `applyMoveCard`, `BoardCardView`. Pinned by `apps/web/tests/unit/optimistic-board-move.test.ts`.
- Client mutation wiring: `apps/web/lib/query/mutations.ts` — `useAddCard(code)` / `useMoveCard(code)`: `onMutate` cancels `keys.board(code)`, snapshots, applies pure helper to cache; `onError` rolls back; `onSettled` invalidates. **This is exactly the cache pattern mobile replicates** (with the mutation function calling `@datum/core` directly instead of a server action).
- Query plumbing: `apps/web/lib/query/keys.ts` (`board(code)`, `projects()`, `card(code,slug)`, `PERSISTED_KEY_ROOTS`), `hooks.ts` (`useBoard`/`useProjects`), `client.ts` (staleTime 30s, gcTime 24h, retry 1), `persister.ts` (`createKVPersister(kv,key)` over an injected async KV — directly reusable on mobile with AsyncStorage), `app/providers.tsx` (`PersistQueryClientProvider`, per-user namespace, `shouldDehydrateQuery` gated on `PERSISTED_KEY_ROOTS`), `lib/cards/realtime.ts` (`subscribeToProjectChanges(projectId, onChange)` — debounced `postgres_changes` on `cards/card_events/card_comments/topics`).

---

## 3. `@datum/core` surface to extract (the strangler step)

New package `@datum/core` (workspace pkg, isomorphic). HARD RULES per the brief: every export takes `SupabaseClient<Database>` as an arg; no `server-only`, no `next/*`, no React. Add path aliases `@datum/core` / `@datum/core/*` to `tsconfig.base.json`, `apps/web/tsconfig.json`, and `apps/mobile/tsconfig.json` (mirroring the existing `@datum/db` alias rows), and `@datum/core: workspace:*` to both apps' `package.json`. Add Metro/transpile config so Expo bundles the workspace package.

### Pure logic (move verbatim — no client needed)
| core module | from | exports |
| --- | --- | --- |
| `core/cards/optimisticBoard.ts` | `apps/web/lib/cards/optimisticBoard.ts` | `makeOptimisticCard`, `applyAddCard`, `applyMoveCard`, type `BoardCardView` |
| `core/cards/labels.ts` | `apps/web/lib/cards/labels.ts` | `computeCardLabels(card, events): CardLabel[]`, `LABEL_STYLE`, `ACTOR_LABELS`, types `CardLabel`, `CardLabelKind`, `CardWithLabels`, `LabelEvent` |
| `core/cards/event-order.ts` | `apps/web/lib/cards/event-order.ts` | `compareEventTime` (dep of labels) |
| `core/gates/board-deadlines.ts` | `apps/web/lib/gates/board-deadlines.ts` | `computeCardDeadlines(links, cells, todayIso): Map<string, CardDeadline>`, types `DeadlineCell`, `CardDeadline` |
| `core/projects/grouping.ts` | `apps/web/lib/projects/grouping.ts` | `filterProjects`, `groupProjects`, `UNGROUPED_LABEL`, type `ProjectGroup` |
| `core/projects/tint.ts` | `apps/web/lib/projects/tint.ts` | `developmentTint(name): Tint`, `TINTS`, type `Tint` |
| `core/projects/cover.ts` | `apps/web/lib/projects/cover.ts` | `coverImageUrl(path, supabaseUrl): string \| null` — **signature change**: take `supabaseUrl` as an arg instead of reading `process.env.NEXT_PUBLIC_SUPABASE_URL` (web passes its env, mobile passes `EXPO_PUBLIC_SUPABASE_URL`). |

Note `LABEL_STYLE` uses CSS-variable strings (`var(--flag-high-bg)`). Keep them as-is in core (they are just tokens); mobile maps the same `CardLabelKind` keys to resolved NativeWind/RN color values from the shared SANO token source (LOCKED DECISION 2). Do **not** consume the `var(...)` strings directly in RN.

### Reads (client-injecting)
```ts
// core/projects/queries.ts   (from apps/web/lib/projects/queries.ts)
export type ProjectListItem = { /* unchanged */ };
export type DevelopmentOption = { id: string; name: string; area_label: string | null; sort_order: number };
export function getProjectsList(
  supabase: SupabaseClient<Database>,
  opts?: { supabaseUrl?: string },          // for coverImageUrl; web/mobile pass their env
): Promise<ProjectListItem[]>;
export function getDevelopments(supabase: SupabaseClient<Database>): Promise<DevelopmentOption[]>;

// core/cards/board.ts   (from apps/web/lib/cards/queries.ts: getBoardForProject + mapBoardBundle)
export type Board = { project: Project; columns: BoardColumn[] };
export type BoardColumn = { topic: Topic; cards: CardWithLabels[] };
export type BoardBundle = { /* unchanged */ };
export function getBoardForProject(supabase: SupabaseClient<Database>, projectSlug: string): Promise<Board>;
export function mapBoardBundle(bundle: BoardBundle, today: string): Board;     // pure

// core/cards/topics.ts   (from apps/web/lib/cards/queries.ts)
export function getProjectTopics(supabase: SupabaseClient<Database>, projectId: string): Promise<Topic[]>;
```

### Mutations (client-injecting; return discriminated results, do NOT throw, NO revalidatePath)
```ts
// core/cards/create.ts   (from createCard in apps/web/lib/cards/mutations.ts)
export const CreateCardInput: z.ZodType<...>;            // projectId, topicId, title (drop projectCode — web-only revalidate concern)
export type CreateCardResult = { ok: true; slug: string; id: string } | { ok: false; error: string };
export function createCard(supabase: SupabaseClient<Database>, input: CreateCardInput): Promise<CreateCardResult>;

// core/cards/createTopic.ts   (from createTopic)
export const CreateTopicInput: z.ZodType<...>;            // projectId, name
export type CreateTopicResult = { ok: true; topicId: string } | { ok: false; error: string };
export function createTopic(supabase: SupabaseClient<Database>, input: CreateTopicInput): Promise<CreateTopicResult>;

// core/cards/move.ts   (from moveCard)
export const MoveCardInput: z.ZodType<...>;               // cardId, newTopicId, projectId
export type MoveCardResult = { ok: true } | { ok: false; error: string };
export function moveCard(supabase: SupabaseClient<Database>, input: MoveCardInput): Promise<MoveCardResult>;

// core/projects/create.ts   (from createProject)
export const CreateProjectInput: z.ZodType<...>;          // unchanged shape
export type CreateProjectResult = { ok: true; projectCode: string } | { ok: false; error: string; fieldErrors?: Record<string,string> };
export function createProject(supabase: SupabaseClient<Database>, input: CreateProjectInput, caller: { id: string; role: StaffRole }): Promise<CreateProjectResult>;
//   caller is passed in: core can't import require-role (server-only). Web resolves caller via getCurrentStaff(); mobile resolves it from its staff row.
//   Keep canManageAccess as a pure predicate in core/auth/access.ts: canManageAccess(role): boolean.
```

### Shared query keys
```ts
// core/query/keys.ts   (host the factory so web + mobile agree)
export const keys = { board: (code) => ["board", code], projects: () => ["projects"], card: (code, slug) => ["card", code, slug] } as const;
export const PERSISTED_KEY_ROOTS = ["board", "projects", "card"] as const;
```

### How web repoints (strangler verification)
- `apps/web/lib/cards/queries.ts` → re-export `getBoardForProject`, `mapBoardBundle`, `Board`, `BoardColumn`, `BoardBundle` from `@datum/core/cards/board` (keep the file as a thin re-export so the ~30 importers don't churn). Same for `getProjectTopics`.
- `apps/web/lib/cards/labels.ts`, `gates/board-deadlines.ts`, `cards/optimisticBoard.ts`, `cards/event-order.ts`, `projects/grouping.ts`, `projects/tint.ts` → become thin re-exports of the core modules.
- `apps/web/lib/projects/cover.ts` → keep a web wrapper `coverImageUrl(path)` that calls `core.coverImageUrl(path, process.env.NEXT_PUBLIC_SUPABASE_URL)`.
- `apps/web/lib/projects/queries.ts` → web `getProjectsList(supabase)` calls `core.getProjectsList(supabase, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL })`.
- `apps/web/lib/cards/mutations.ts` `createCard`/`createTopic`/`moveCard` and `apps/web/lib/projects/mutations.ts` `createProject` keep their `"use server"` `FormData` signatures but become **thin wrappers**: parse FormData → call the core function with `supabase` (+ `caller` for createProject) → on `ok` run the web-only `revalidatePath(...)` side effects → return the same result shape. Server action callers (`useAddCard`, `useMoveCard`, `ProjectCreateForm`, `AddColumnForm`) are unchanged.
- **Verify**: `apps/web` vitest stays green, especially `apps/web/tests/unit/optimistic-board-move.test.ts` (now importing the core helpers via the re-export), plus a typecheck/build of `apps/web`.

---

## 4. Mobile screens — Expo Router routes + NativeWind + states

Tabs already exist (`apps/mobile/app/(tabs)/_layout.tsx`: Matrix / Inbox / Asisten / Lainnya). Per LOCKED DECISION 4 we nest stacks. The **Matrix** tab becomes the Projects stack and hosts the board.

```
app/(tabs)/matrix/_layout.tsx       Stack
app/(tabs)/matrix/index.tsx         Projects landing  (replaces today's apps/mobile/app/(tabs)/matrix.tsx)
app/(tabs)/matrix/new.tsx           Create project    (principal/admin)
app/project/[code]/_layout.tsx      Stack (board pushed above tabs, full height)
app/project/[code]/index.tsx        Project board
```
Card detail (`app/project/[code]/cards/[slug]`) is the Card Detail slice; MiniCard taps will route there (the route just needs to exist).

### A. Projects landing — `matrix/index.tsx`
Mirrors `ProjectsList`. Components (NativeWind):
- **Header**: title `"Proyek"`, subtitle `"{n} proyek aktif · {m} pengembangan"`, a `+ Buat proyek` button (visible to all, gated server-side by RLS + `canManageAccess`; non-eligible users get a friendly error on submit — matches web, which shows the link to everyone), and the pending-draft chip if `pendingDraftCount > 0` (→ Inbox/Review, owned by Inbox slice; link target may be a stub this slice).
- **Sticky filter bar**: `TextInput` search (`"Cari proyek, klien, atau lokasi…"`) + horizontal `ScrollView` of status pills (`Semua/Desain/Konstruksi/Finishing/Serah terima/Selesai`), `aria`/`accessibilityState={{selected}}`.
- **Grouped list**: a `SectionList` (sections = developments from `groupProjects`), collapsible section headers `▸/▾ {name} · {count}` + `area_label`. Section body = a 2-column grid of `<ProjectCard>` (RN: `FlatList numColumns={2}` per section, or flex-wrap rows).
- **ProjectCard** (RN port of `ProjectCard.tsx`): `expo-image` cover from `cover_url` (already a dependency) or tinted fallback block showing `unitCode` via `developmentTint`; `project_code`, `project_name`, `Client: {client_name ?? "-"}`, status pill `statusLabel[status]`; `Pressable` → `router.push("/project/" + project_code)`. (Edit dialog omitted — settings slice.)

States:
- **Loading**: skeleton group cards (or spinner) while `useProjects` has no `initialData`. On a cold mobile start there's no SSR initialData, so the first paint may be the persisted cache (offline) or a skeleton.
- **Empty (no projects)**: `"Belum ada proyek yang ditugaskan."`
- **Empty (filtered)**: `"Tidak ada proyek yang cocok dengan filter."`
- **Error**: `"Gagal memuat proyek: {message}"` with a Retry (`refetch`).
- **Offline**: render last persisted `["projects"]` cache; show a subtle offline banner (see §8).

### B. Create project — `matrix/new.tsx`
Mirrors `ProjectCreateForm`. Fields: `Kode proyek *` (auto-uppercase, helper "Huruf besar, angka, dan tanda hubung saja"), `Nama proyek *`, `Klien`, `Lokasi`, `Status awal` (picker, default `design`), `Target serah terima` (native date picker). Submit calls `core.createProject(supabase, input, caller)`; on `ok` `router.replace("/project/" + projectCode)`; field errors map back (`projectCode` "Sudah ada", etc.).
States: idle / submitting (`"Menyimpan…"`, disabled) / field-error / general error / forbidden (non-principal/admin → the gate's Bahasa message). Cancel → `router.back()`.

### C. Project board — `project/[code]/index.tsx`
Mirrors `Board.tsx` (which is already designed as a mobile carousel + tab strip):
- **Header** (native stack header or custom): back chevron + `{project_code} · {project_name}` truncated + overflow menu (settings/print/rooms/schedule are other slices → menu can be a stub here).
- **BoardFilter** (RN): search `TextInput` (matches title + `current_summary`), status multi-select (default `{active}`), label filter chips (`needs_decision/blocked/awaiting/overdue`), and `matched/total` count. Same filtering logic as `Board.filteredColumns` — pull the WIB-day overdue rule from a shared helper (compute `Asia/Jakarta` today via `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" })`, available in Hermes/RN).
- **BoardTabs** (RN): horizontal `ScrollView` of `{name} · {count}` chips; tapping scrolls the carousel to that column; active chip tracks the visible column.
- **Column carousel**: a horizontal paged `FlatList` (`pagingEnabled`/snap, `~86vw` cards) of `<Column>`; `onViewableItemsChanged` (viewabilityConfig `itemVisiblePercentThreshold: 60`, mirroring the web IntersectionObserver `threshold: 0.6`) sets `activeTopicId`. Programmatic `scrollToIndex` for tab taps. Trailing **AddColumn** slide.
- **Column** (RN port of `Column.tsx`): topic name header, vertical card list (inner `FlatList`/`ScrollView`), empty copy `"Belum ada kartu di kolom ini"`, `<AddCardForm>` at the bottom.
- **MiniCard** (RN port of `MiniCard.tsx`): label chips (resolve `CardLabelKind` → SANO token colors), `DeadlineChip` with the same WIB-day text rules, title, 2-line-clamped `current_summary` (`numberOfLines={2}`), `last_event_at` localized (`toLocaleDateString("id-ID", …)` — RN Intl ok), Trello badge. Optimistic ghost: dimmed, non-pressable, `accessibilityState={{ busy: true }}`. Tap → `router.push("/project/" + code + "/cards/" + slug)`.
- **AddCardForm** (RN port): collapsed `+ tambah kartu` button → inline input; submit fires the optimistic add then collapses; on error restores the text + reopens + shows the message (exactly `AddCardForm.tsx`).
- **Move**: mobile uses a long-press / overflow on a MiniCard → action sheet of target columns (RN has no HTML `<select>`; mirror `MoveCardControl`'s "pick a target topic" model, not native drag-and-drop in v1). Choosing a column fires the optimistic move.

States:
- **Loading**: column skeletons while the board query resolves (no SSR initialData on mobile).
- **Empty board** (no topics): shouldn't happen post-seed, but render the AddColumn slide alone.
- **Empty column**: `"Belum ada kartu di kolom ini"`.
- **No filter matches**: `"Tidak ada kartu cocok. Coba ubah filter atau kata kunci."`
- **Project not found**: `"Proyek tidak ditemukan: {code}"` + back action (404 from the board query).
- **Error**: generic load error + Retry.
- **Offline**: serve persisted `["board", code]`; queue create/move (see §8).

NativeWind tokens (LOCKED DECISION 2): the web colors (`#FDFAF6`, `#141210`, `#B5AFA8`, `var(--oat-deep)`, `var(--sand-dark)`, the flag-* label colors, tint pairs) come from the single shared SANO token source. No raw hex in screens.

---

## 5. Data fetching — react-query keys, realtime, optimistic updates

**Provider** (`apps/mobile/app/_layout.tsx`): wrap in `PersistQueryClientProvider`. Reuse `core.query.keys` + `PERSISTED_KEY_ROOTS`, reuse web's `makeQueryClient` config values (staleTime 30s, gcTime 24h, `refetchOnReconnect: true`, retry 1 — `refetchOnWindowFocus` becomes RN AppState "active"). Reuse `createKVPersister` (it already takes an injected `AsyncKV`) with an AsyncStorage adapter (`getItem/setItem/removeItem` already match AsyncStorage's API), namespaced `datum.rq.{userId}` like web's providers.tsx.

**Queries** (mobile hooks calling `@datum/core` directly with the anon client — no `/api` round-trip; web uses route handlers because the board read needs the server cookie session, mobile has the session in the client):
- `useProjects()` → `queryKey core.keys.projects()` → `core.getProjectsList(supabase, { supabaseUrl: EXPO_PUBLIC_SUPABASE_URL })`. Also fetch `getDevelopments(supabase)` (own key `["developments"]` or co-fetched).
- `useBoard(code)` → `queryKey core.keys.board(code)` → `core.getBoardForProject(supabase, code)`.
- `useProjectTopics(projectId)` (for the move action sheet) → `core.getProjectTopics`.

**Realtime**: port `subscribeToProjectChanges(projectId, onChange)` into mobile (same supabase-js channel API, `postgres_changes` on `cards/card_events/card_comments/topics` filtered by `project_id`, 250ms debounce). On the board screen, subscribe on focus, `invalidateQueries(keys.board(code))` on change, unsubscribe on blur/unmount. Consider hosting `subscribeToProjectChanges` in `@datum/core/cards/realtime.ts` (it imports a supabase client only) so web+mobile share it; if so, inject the client rather than constructing it internally.

**Optimistic updates** (identical to `apps/web/lib/query/mutations.ts`):
- `useAddCard(code)`: `onMutate` → `cancelQueries(keys.board(code))`, snapshot, `setQueryData(keys.board(code), applyAddCard(prev, topicId, title, "optimistic:"+topicId+":"+uuid))`; `onError` rollback; `onSettled` invalidate. `mutationFn` = `core.createCard(supabase, input)` (throw on `!ok` for a single rollback path, like the web wrapper does).
- `useMoveCard(code)`: same shape with `applyMoveCard(prev, cardId, newTopicId)` + `core.moveCard`.
- `useAddColumn(code)`: `core.createTopic` then invalidate (no pure optimistic helper exists for topics today — match web, which just `revalidatePath`s; mobile invalidates).
- UUIDs: web uses `crypto.randomUUID()`; RN/Hermes may lack it — use `expo-crypto` `randomUUID()` or a small polyfill. (Add `expo-crypto`.)

---

## 6. Mutations & validation — reuse Zod from `@datum/core`

All input schemas live in core and are reused verbatim by mobile (and by the web wrappers): `CreateCardInput`, `CreateTopicInput`, `MoveCardInput`, `CreateProjectInput`. Mobile builds a plain input object (not `FormData`), `parse`s with the core schema, and calls the core function; field errors come back the same way (`createProject` → `fieldErrors`, e.g. `projectCode: "Sudah ada"`). Slug/code uniqueness loops and `23505` handling live in core and run identically. Move-target cross-project validation (`"Kolom tujuan ada di proyek lain"`) lives in core. zod is already a dep of `@datum/types`; `@datum/core` adds it directly.

---

## 7. RLS & permissions notes (per role)

Roles (`apps/web/lib/auth/require-role.ts`): `principal | designer | pic | site_supervisor | admin | estimator`. RLS enforces auth on both web and mobile equally (mobile uses the anon client with the user's session; the same policies apply).

- **Read board/projects**: RLS scopes `projects/topics/cards/card_events/card_areas/area_gate_status` to projects the caller is a member of (via `project_staff`). `getBoardForProject` already tolerates a failing open-loop/areas/gate sub-select (labels/deadlines just go empty) — keep that resilience in core.
- **Create card**: requires a signed-in staff row; insert is RLS-gated to accessible projects (any project member). Same on mobile.
- **Create column (topic)**: `topics_insert` RLS gates on project membership, not role (per the `createTopic` comment) — any member may add a column.
- **Move card**: RLS-gated update on `cards`; core additionally checks the target topic is in the same project.
- **Create project**: `canManageAccess` → principal/admin only. Mobile must resolve the caller's role (read the `staff` row for the session user) and pass `{ id, role }` to `core.createProject`; the UI should hide/disable create for non-eligible roles but **must not rely on UI gating** — core re-checks and RLS is the backstop. The follow-up `project_staff` insert (so the creator keeps access) and the topic-seeding trigger behave identically.

---

## 8. Offline behavior

- **Persisted reads**: `["board", code]`, `["projects"]`, `["card", …]` dehydrate to AsyncStorage via `createKVPersister` (gated by `PERSISTED_KEY_ROOTS`, 24h `maxAge`, `CACHE_BUSTER`). Cold launch offline shows last-seen projects + last-opened boards. Namespaced per `userId` so a shared device never leaks another user's cache (matches `apps/web/app/providers.tsx`).
- **Optimistic writes while offline**: the optimistic helpers already paint the ghost/move instantly. For true offline durability, register a react-query mutation cache + `defaultMutationOptions` with persisted, resumable mutations (or a light AsyncStorage outbox) so `createCard`/`moveCard` replay on reconnect (`onlineManager` wired to NetInfo). v1 acceptable minimum: optimistic paint + on-failure rollback with a "tersimpan saat online" retry affordance; full replay can be a fast follow if scope is tight.
- **Reconnect**: `refetchOnReconnect` + `onlineManager` (NetInfo) → board/projects refetch; realtime re-subscribes on focus.
- **Offline indicator**: a small banner when `onlineManager` reports offline.

---

## 9. Edge cases

- **No SSR initialData on mobile**: web seeds `useBoard`/`useProjects` from server-rendered props; mobile's first render has only persisted cache or nothing → must handle the no-data loading state (web's hooks assume `initialData`).
- **WIB day boundary**: overdue/`hari ini` must use `Asia/Jakarta`, not device locale/UTC (web does this in `Board.tsx` and `MiniCard.tsx`). Verify Hermes `Intl.DateTimeFormat` with `timeZone` works on target devices; if not, ship a small offset helper.
- **Duplicate same-title card adds**: optimistic ids must be unique (`optimistic:{topicId}:{uuid}`) to avoid `FlatList`/React key collisions — same reason web switched off the deterministic fallback in `useAddCard`.
- **Move to the same column**: no-op (mirror `MoveCardControl.submit` early return).
- **Move target in another project**: core returns `"Kolom tujuan ada di proyek lain"`; rollback + surface.
- **Realtime echo**: an optimistic add + the realtime insert both arrive; `onSettled` invalidate reconciles to the server row (drops the ghost). Debounce (250ms) avoids refetch storms during others' typing.
- **Optimistic ghost tap**: ghost is non-pressable (no real `slug` yet) — mirror MiniCard's `__optimistic` branch.
- **`cover_url` for fallback / broken images**: tinted `unitCode` block; `expo-image` needs an `onError` fallback to the tint block too.
- **`area_label` / `client_name` null**: render `-` / omit (matches web).
- **Project not found / RLS-denied board**: surface the not-found copy rather than a raw error.
- **Empty `current_summary` / `last_event_at`**: omit those rows (matches MiniCard conditionals).

---

## 10. Testing

**Core (vitest, in `packages/core`)** — move/extend the existing web unit tests:
- Port `apps/web/tests/unit/optimistic-board-move.test.ts` against `@datum/core/cards/optimisticBoard` (`applyMoveCard`, `applyAddCard`, unchanged-board identity for unknown ids). After extraction, the web copy imports through the re-export and must still pass.
- `mapBoardBundle`: topics→columns, label/deadline attachment, empty inputs.
- `computeCardLabels`: status-exclusive (closed/dormant), blocked-from-latest-work, open-decision + awaiting actor, open client request dedupe, max-3 cap.
- `computeCardDeadlines`: soonest-upcoming-else-earliest selection, areas with no scheduled cells.
- `groupProjects`/`filterProjects`: ungrouped-last ordering, sort_order then name, query+status filtering.
- `developmentTint`: stable hash, index 0 reserved for ungrouped.
- `coverImageUrl`: null in → null out, path encoding, injected base URL.
- Mutation input schemas: `CreateProjectInput` regex/required, `CreateCardInput`/`MoveCardInput`/`CreateTopicInput` validation. (DB-touching mutation bodies can use a mocked supabase client to assert the `23505`/cross-project branches.)

**Mobile (@testing-library/react-native)**:
- Projects landing: renders grouped sections, collapse toggles, search + status filtering, empty/filtered-empty/error states, navigation on card press.
- Board: renders columns from a seeded query cache, tab→carousel scroll, filter strip narrows cards, empty-column + no-match copy.
- AddCardForm: optimistic ghost appears immediately, error path restores text + reopens.
- Move action sheet: optimistic move + rollback on error.
- Create project: validation errors, forbidden role path, success navigation.
- Provider/persistence: AsyncStorage KV adapter round-trips through `createKVPersister`.

**Strangler regression**: run `apps/web` vitest + typecheck/build after repointing each module to confirm no behavior drift.

---

## 11. Dependencies on other slices + Out of scope

**Depends on / coordinates with:**
- **App shell / providers slice** — must establish the mobile `PersistQueryClientProvider`, the AsyncStorage KV adapter, `onlineManager`/NetInfo, and the SANO NativeWind token source (LOCKED DECISION 2/3). If that slice doesn't exist yet, this slice stands it up minimally.
- **Card Detail slice** — owns `app/project/[code]/cards/[slug]`; this slice only needs the route to exist for MiniCard taps.
- **Inbox/Review slice** — owns the pending-draft destination; the landing chip links to it (stub link acceptable).
- **`@datum/core` foundation** — this slice is the first concrete extraction; it creates the package and the strangler pattern other slices follow.

**Out of scope (this slice):**
- Card detail / timeline / events / comments / attachments / members (`apps/web/components/board/CardDetailClient.tsx`, `Timeline.tsx`, `CommentsSection.tsx`, `CardMembers.tsx`, `EventAttachments.tsx`, etc.).
- Project advisor strip (`ProjectAdvisorStrip`), chat dock (`ChatDock`), assistant.
- Project settings / areas / members admin / staff (`SettingsTabs`, `AreasManager`, `ProjectMembersList`, `ProjectEditDialog`), cover upload.
- Schedule & readiness, rooms, print, search tiers, bulk Trello import.
- Native drag-and-drop reordering within/between columns (web has no DnD either — move is a target-picker; keep parity).
