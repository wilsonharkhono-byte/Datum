# Mobile Foundation & Shared Architecture — Design Spec

Slice: `foundation` · Date: 2026-06-20 · Status: design (no code)

This is the **keystone** spec for the DATUM mobile parity build. It defines the
conventions every feature slice (board, card detail, assistant, inbox, search,
brief, members, schedule, review, activity, projects-new) inherits. It is grounded
in the real web app (`apps/web`), the existing mobile scaffold (`apps/mobile`),
the shared packages (`packages/db`, `packages/types`), and the locked architecture
brief. Where a downstream slice owns the deep design, this spec only specifies the
**shared plumbing** and points at the slice.

---

## 1. Goal & scope

Deliver the shared foundation that makes native mobile parity possible and keeps it
honest as features land:

1. **`@datum/core`** — a new isomorphic package holding data-access + domain logic
   extracted from `apps/web/lib`, with the HARD RULE that every export takes a
   `SupabaseClient<Database>` and imports nothing from `next/*`, `server-only`, or
   React. Establish its layout, build, tsconfig/package wiring, and the **strangler
   migration** recipe (with one concrete extract-and-repoint example that ships in
   this slice).
2. **Shared SANO tokens** — a single token source consumed by both web's Tailwind v4
   theme and mobile's NativeWind config, so the two apps never drift on color, type,
   spacing, radius.
3. **NativeWind setup** in `apps/mobile` (Tailwind for React Native) wired to those
   tokens.
4. **react-query foundation for mobile** — `QueryClient` factory, AsyncStorage
   persister mirroring web's idb-keyval offline cache, a shared query-key factory,
   and a Supabase Realtime → query-invalidation helper mirroring web's conventions.
5. **Full Expo Router IA tree** mapping **every** web App Router route to a mobile
   screen/tab/stack (the parity map). Downstream slices fill the screens; this slice
   lands the route skeleton + navigation contract.
6. **Auth/session formalization** — promote the ad-hoc `_layout.tsx` gate into a
   reusable session context + a typed `useSession()` and a logout that clears the
   persisted cache (mirroring web's `clearIdbCache` on logout).
7. **Mobile CI** — add typecheck/lint/test for `apps/mobile` and the new
   `@datum/core` to `.github/workflows/ci.yml` and `turbo.json`.

**Out of scope here:** the actual feature screens' designs (each is its own slice),
push notifications, file-upload UI, and any new DB migration. This slice does not
move business logic beyond the single demonstrator extraction.

---

## 2. Web behavior mirrored — exact files & functions

Everything below is read from the real tree; nothing invented.

### 2.1 Supabase clients
- `apps/web/lib/supabase/client.ts` → `createSupabaseBrowserClient()` (anon,
  `@supabase/ssr` browser client, cookie session).
- `apps/web/lib/supabase/server.ts` → `createSupabaseServerClient()` (anon, cookie
  store from `next/headers`).
- `apps/web/lib/supabase/admin.ts` → `createSupabaseAdminClient()` (service-role,
  `import "server-only"`, RLS-bypass; **never** ported to mobile).
- `apps/mobile/lib/supabase/client.ts` → already exports a singleton `supabase`
  (anon, `@supabase/supabase-js`, `AsyncStorage` session, `autoRefreshToken`,
  `persistSession`, `detectSessionInUrl:false`). This is the mobile analogue of the
  browser client and is the **only** Supabase entry point for mobile.

### 2.2 react-query stack (web)
- `apps/web/lib/query/client.ts` → `makeQueryClient()`, `CACHE_BUSTER = "v1"`,
  `CACHE_MAX_AGE = 24h`. Defaults: `staleTime 30_000`, `gcTime = CACHE_MAX_AGE`,
  `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchIntervalInBackground:false`,
  `retry:1`.
- `apps/web/lib/query/persister.ts` → `createKVPersister(kv: AsyncKV, key)` +
  the `AsyncKV` interface (`getItem/setItem/removeItem` async string KV). The store
  is injected so prod + tests share one path — this is the seam mobile reuses.
- `apps/web/lib/query/idb-kv.ts` → `idbKV: AsyncKV` (idb-keyval store
  `datum-cache/rq`) + `clearIdbCache()` (wipe on logout so a shared device leaks
  nothing).
- `apps/web/lib/query/keys.ts` → `keys` factory (`board(code)`, `projects()`,
  `card(code, slug)`) + `PERSISTED_KEY_ROOTS = ["board","projects","card"]`.
- `apps/web/lib/query/hooks.ts` → `useBoard`, `useProjects`, `useCard` (each
  `useQuery` with `initialData` + a `fetchJson` over `/api/...`).
- `apps/web/lib/query/mutations.ts` → `useAddCard`, `useAddComment`, `useMoveCard`
  — the canonical **optimistic update** pattern: `onMutate` cancels queries,
  snapshots `prev`, writes optimistic state (`optimistic:` id), `onError` rolls back
  to `prev`, `onSettled` invalidates.
- `apps/web/app/providers.tsx` → `Providers({ userId })` wraps
  `PersistQueryClientProvider` with a **per-user** persister key
  (`datum.rq.${userId}`), `maxAge`, `buster`, and `shouldDehydrateQuery` gated to
  `PERSISTED_KEY_ROOTS`.

### 2.3 Realtime (web)
- `apps/web/lib/cards/realtime.ts` → `subscribeToProjectChanges(projectId, onChange)`:
  one channel `project:${projectId}`, four `postgres_changes` listeners
  (`cards`, `card_events`, `card_comments`, `topics`, each filtered
  `project_id=eq.${projectId}`), a **250ms debounce** before firing `onChange`,
  returns an unsubscribe that calls `supabase.removeChannel`. `CardsChange.kind` ∈
  `card|event|comment|topic`. (Requires `topics` in the realtime publication —
  migration `20260615000001`.)
- `apps/web/lib/notifications/realtime.ts` → `subscribeToOwnNotifications(staffId, onDelta)`:
  channel `notifications:${staffId}`, INSERT + UPDATE on `notifications` filtered
  `recipient_staff_id=eq.${staffId}`, `UnreadDelta.kind` ∈ `insert|refresh`.
- Realtime publications declared in migrations `20260601000016_realtime_publications.sql`
  and `20260615000001_topics_realtime_publication.sql`.

### 2.4 Auth/session + roles (web)
- `apps/web/middleware.ts` → redirects unauth → `/login`, auth-on-`/login` → `/`,
  never redirects `/api`. Mobile's analogue already lives in
  `apps/mobile/app/_layout.tsx` (segment-based redirect to `/(auth)/login`).
- `apps/web/lib/auth/get-current-user.ts` → `getCurrentStaff(): Staff | null`
  (selects full `staff` row; uses server client).
- `apps/web/lib/auth/require-role.ts` → a **second** `getCurrentStaff()` returning a
  trimmed `CurrentStaff` (`id, full_name, role, email`), `StaffRole` union
  (`principal | designer | pic | site_supervisor | admin | estimator`), and
  `canManageAccess(staff)` (principal/admin). NOTE: two `getCurrentStaff` exist;
  the core extraction unifies them (see §3.4).
- `apps/web/app/(app)/layout.tsx` → loads staff, redirects to `/login` if missing,
  renders header (`DatumWordmark`, name·role·cost-visible, `NotificationBadge`,
  `LogoutButton`) and wraps children in `<Providers userId={staff.id}>`.

### 2.5 Web route inventory (the parity source of truth)
From `apps/web/app/**` (pages only; `loading.tsx` are skeletons, `print/` are PDF):

| # | Web route | Page file | Purpose |
|---|---|---|---|
| 1 | `/login` | `(auth)/login/page.tsx` | Email/password sign-in |
| 2 | `/` | `(app)/page.tsx` | Landing: grouped projects + dev groups + quick links (review/activity/brief/search/new) |
| 3 | `/projects/new` | `(app)/projects/new/page.tsx` | Create project |
| 4 | `/project/[slug]` | `(app)/project/[slug]/page.tsx` | **Board** (topics × cards) |
| 5 | `/project/[slug]/cards/[cardSlug]` | `…/cards/[cardSlug]/page.tsx` | Card detail (timeline, comments, attachments, members) |
| 6 | `/project/[slug]/cards/[cardSlug]/print` | `…/print/page.tsx` | Card PDF export |
| 7 | `/project/[slug]/members` | `…/members/page.tsx` | Project members / access |
| 8 | `/project/[slug]/rooms` | `…/rooms/page.tsx` | Areas/rooms |
| 9 | `/project/[slug]/schedule` | `…/schedule/page.tsx` | Gate schedule / readiness |
| 10 | `/project/[slug]/settings` | `…/settings/page.tsx` | Project settings |
| 11 | `/project/[slug]/print` | `…/print/page.tsx` | Project PDF export |
| 12 | `/activity` | `(app)/activity/page.tsx` | Activity feed |
| 13 | `/brief` | `(app)/brief/page.tsx` | Morning brief |
| 14 | `/notifications` | `(app)/notifications/page.tsx` | Notifications list |
| 15 | `/review` | `(app)/review/page.tsx` | Draft review queue |
| 16 | `/search` | `(app)/search/page.tsx` | Global search (tiers) |

API routes (consumed, not navigated): `/api/board/[code]`, `/api/card/[code]/[slug]`,
`/api/projects`, `/api/notifications/unread-count`, `/api/cards/[cardId]/next-deadline`,
`/api/assistant/{message,capture,snippet}`, `/api/areas/suggest`,
`/api/cron/analyze-attachments`, `/api/health`. On mobile these become **direct
`@datum/core` calls** (RLS-enforced) rather than HTTP — see §5.

---

## 3. `@datum/core` surface to extract

### 3.1 Package layout

```
packages/core/
  package.json          # name "@datum/core", workspace:* deps on @datum/db, @datum/types
  tsconfig.json         # extends ../../tsconfig.base.json
  tsup.config.ts        # build to dist (esm + dts) for RN/Metro + Next consumption
  vitest.config.ts      # core logic unit tests
  src/
    index.ts            # barrel re-exporting the public surface
    client.ts           # type-only: SupabaseClient<Database> alias (DatumClient)
    query/
      keys.ts           # SHARED query-key factory (moved from apps/web/lib/query/keys.ts)
      persister.ts      # createKVPersister + AsyncKV (moved from apps/web/lib/query)
      client.ts         # makeQueryClient + CACHE_* constants (moved)
    realtime/
      project.ts        # subscribeToProjectChanges (from apps/web/lib/cards/realtime.ts)
      notifications.ts  # subscribeToOwnNotifications (from apps/web/lib/notifications/realtime.ts)
    auth/
      current-staff.ts  # getCurrentStaff(supabase), StaffRole, canManageAccess
    projects/
      list.ts           # getProjectsList(supabase), getDevelopments(supabase)
    cards/
      ...               # (future slices) create.ts, move.ts, comment.ts — strangle mutations.ts
    validation/
      ...               # (future slices) Zod schemas reused by web wrappers + mobile
```

**HARD RULES enforced by lint/tsconfig (see §10):**
- No `import "server-only"`, no `next/*`, no `react`/`react-dom`, no
  `react-native`/`expo*`. (Add an `eslint no-restricted-imports` rule.)
- Every data-access fn signature is `(supabase: SupabaseClient<Database>, …args)`.
- Pure helpers (e.g. `mapBoardBundle`, key factory) may take no client.

> The query/* and realtime/* modules currently live in web as **`"use client"`**.
> Moving them to core: drop the `"use client"` directive (it is a Next/React
> bundler pragma, harmless-to-absent in plain TS); replace the realtime modules'
> `createSupabaseBrowserClient()` self-instantiation with an **injected** client
> param so the function takes `(supabase, projectId, onChange)` — this is the only
> behavior change and it's required by the HARD RULE.

### 3.2 Function signatures extracted in THIS slice

```ts
// core/client.ts
export type DatumClient = SupabaseClient<Database>; // from @datum/db

// core/query/keys.ts   (moved verbatim from apps/web/lib/query/keys.ts)
export const keys: {
  board(code: string): readonly ["board", string];
  projects(): readonly ["projects"];
  card(code: string, slug: string): readonly ["card", string, string];
};
export const PERSISTED_KEY_ROOTS: readonly ["board", "projects", "card"];

// core/query/persister.ts  (moved verbatim from apps/web/lib/query/persister.ts)
export type AsyncKV = { getItem(k:string):Promise<string|null>;
  setItem(k:string,v:string):Promise<void>; removeItem(k:string):Promise<void>; };
export function createKVPersister(kv: AsyncKV, key: string): Persister;

// core/query/client.ts  (moved verbatim from apps/web/lib/query/client.ts)
export const CACHE_BUSTER = "v1";
export const CACHE_MAX_AGE = 86_400_000;
export function makeQueryClient(): QueryClient;

// core/realtime/project.ts  (from apps/web/lib/cards/realtime.ts — now client-injected)
export type CardsChange = { kind: "card" | "event" | "comment" | "topic" };
export function subscribeToProjectChanges(
  supabase: DatumClient, projectId: string, onChange: (c: CardsChange) => void,
): () => void;

// core/realtime/notifications.ts  (from apps/web/lib/notifications/realtime.ts — client-injected)
export type UnreadDelta = { kind: "insert" } | { kind: "refresh" };
export function subscribeToOwnNotifications(
  supabase: DatumClient, staffId: string, onDelta: (d: UnreadDelta) => void,
): () => void;

// core/auth/current-staff.ts  (unifies the two web getCurrentStaff)
export type StaffRole =
  "principal" | "designer" | "pic" | "site_supervisor" | "admin" | "estimator";
export type CurrentStaff = { id:string; full_name:string; role:StaffRole; email:string|null };
export function getCurrentStaff(supabase: DatumClient): Promise<CurrentStaff | null>;
export function canManageAccess(staff: CurrentStaff | null): staff is CurrentStaff;

// core/projects/list.ts  (DEMONSTRATOR — moved from apps/web/lib/projects/queries.ts)
export type ProjectListItem = { /* …17 fields, unchanged… */ };
export type DevelopmentOption = { id:string; name:string; area_label:string|null; sort_order:number };
export function getProjectsList(supabase: DatumClient): Promise<ProjectListItem[]>;
export function getDevelopments(supabase: DatumClient): Promise<DevelopmentOption[]>;
```

> Note: `coverImageUrl` (used by `getProjectsList`) lives in
> `apps/web/lib/projects/cover.ts`. Its public-URL builder is isomorphic (string
> path → URL); it must move into `core/projects/cover.ts` alongside `list.ts`, or
> the function must accept the bucket base as an argument. Confirm there is no
> `next/*` import in `cover.ts` before moving (open question in §11).

### 3.3 The strangler recipe (the convention every slice follows)

Each slice does exactly this, then verifies `pnpm --filter web test` + `typecheck`:

1. **Identify** the smallest function(s) the slice needs from `apps/web/lib/...`.
2. **Move** the pure/isomorphic part into a focused `packages/core/src/<area>/<verb>.ts`,
   dropping `"use client"`/`server-only` and **injecting** the Supabase client as the
   first arg.
3. **Repoint web**: the old `apps/web/lib/...` module becomes a thin re-export or a
   thin wrapper. For **queries** that already take a client (e.g.
   `getProjectsList(supabase)`) the web file just re-exports from core. For
   **mutations** (the `"use server"` god-module), the web wrapper keeps
   `"use server"`, parses `FormData`, calls `await createSupabaseServerClient()`,
   calls the pure core fn, then does web-only side effects (`revalidatePath`,
   `redirect`).
4. **Mobile** imports the core fn directly with its anon `supabase` singleton.

### 3.4 Concrete demonstrator shipped in THIS slice

**Extract `getProjectsList` / `getDevelopments`** because `apps/web/lib/projects/queries.ts`
is *already isomorphic* (`getProjectsList(supabase: SupabaseClient<Database>)`),
making it the lowest-risk first move and a clean template.

- **Before:** `apps/web/app/api/projects/route.ts` and `apps/web/app/(app)/page.tsx`
  import from `@/lib/projects/queries`.
- **Move:** `getProjectsList`, `getDevelopments`, `ProjectListItem`,
  `DevelopmentOption`, and `coverImageUrl` → `packages/core/src/projects/{list,cover}.ts`.
- **Repoint (strangler step):** `apps/web/lib/projects/queries.ts` becomes
  `export { getProjectsList, getDevelopments } from "@datum/core";` (plus a
  type re-export). Every existing web import keeps working unchanged.
- **Verify:** `pnpm --filter web typecheck && pnpm --filter web test` stay green;
  `/api/projects` and the landing page behave identically (the function body is
  byte-identical, only its home moved).
- **Mobile reuse:** the Matrix tab replaces its inline
  `supabase.from("projects").select(...)` (`apps/mobile/app/(tabs)/matrix.tsx`)
  with `getProjectsList(supabase)` from `@datum/core`, gaining cover URLs +
  development grouping for free.

This proves the seam end-to-end (one function, one repoint, one mobile consumer)
without touching the 1090-line `apps/web/lib/cards/mutations.ts` — that god-module is
strangled incrementally by the board/card-detail/comment slices, each peeling off
`createCard` / `moveCard` / `createComment` into `core/cards/*.ts`.

### 3.5 Package wiring

- **`packages/core/package.json`**: mirror `packages/db` style but **with a build**
  because Metro (React Native) does not transpile TS from `node_modules` the way
  Next/Turbopack does. Use **tsup** → emit ESM + `.d.ts` to `dist/`.
  ```jsonc
  {
    "name": "@datum/core",
    "main": "./dist/index.js",
    "module": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
    "scripts": {
      "build": "tsup src/index.ts --format esm --dts --clean",
      "dev": "tsup src/index.ts --format esm --dts --watch",
      "typecheck": "tsc --noEmit",
      "test": "vitest run --passWithNoTests"
    },
    "dependencies": { "@datum/db": "workspace:*", "@datum/types": "workspace:*",
      "@supabase/supabase-js": "^2.106.2" },
    "peerDependencies": { "@tanstack/react-query": ">=5",
      "@tanstack/react-query-persist-client": ">=5" }
  }
  ```
  react-query is a **peer** (the apps own the version) — the query/* modules only use
  its types + `QueryClient` constructor.
- **tsconfig path aliases**: add to root `tsconfig.base.json` next to the existing
  `@datum/db` / `@datum/types` entries:
  ```jsonc
  "@datum/core": ["./packages/core/src"],
  "@datum/core/*": ["./packages/core/src/*"]
  ```
  and the same two lines in `apps/mobile/tsconfig.json`'s `paths` (it does not extend
  the base `paths` for app-local `@/*`, it redeclares them — see the existing file).
- **App deps**: add `"@datum/core": "workspace:*"` to `apps/web/package.json` and
  `apps/mobile/package.json`.
- **Metro**: Expo SDK 56 monorepo support resolves `workspace:*` packages via the
  default config; because core ships a built `dist/`, no extra
  `metro.config.js` `watchFolders`/`nodeModulesPaths` tweak is strictly required, but
  add a `metro.config.js` (currently absent in `apps/mobile`) that enables monorepo
  package resolution + symlinks to be safe (open question in §11 — verify against the
  exact SDK 56 docs at https://docs.expo.dev/versions/v56.0.0/ per `apps/mobile/AGENTS.md`).
- **Turbo `^build`**: web/mobile `build`/`typecheck`/`test` already
  `dependsOn: ["^build"]` in `turbo.json`, so `@datum/core build` runs first
  automatically once it's a dependency.

---

## 4. Mobile screens — Expo Router IA tree (the parity map)

Existing scaffold: `apps/mobile/app/_layout.tsx` (root Stack + auth gate),
`app/(auth)/login.tsx`, `app/(tabs)/{_layout,matrix,inbox,assistant,more}.tsx`.
This slice expands the four flat tab files into **nested stacks** so every web route
has a home. Tabs (locked): **Matrix · Inbox · Assistant · More**.

```
app/
  _layout.tsx                      # root Stack; SessionProvider + QueryProvider (this slice)
  (auth)/
    _layout.tsx                    # NEW: bare stack
    login.tsx                      # web #1 /login
  (tabs)/
    _layout.tsx                    # Tabs: matrix | inbox | assistant | more
    (matrix)/                      # NEW stack — "Matrix" tab owns projects + everything under a project
      _layout.tsx                  # Stack
      index.tsx                    # web #2 /            (landing: grouped projects)  [slice: landing]
      new.tsx                      # web #3 /projects/new                              [slice: projects-new]
      project/
        [slug]/
          index.tsx                # web #4 board                                     [slice: board]
          card/
            [cardSlug].tsx         # web #5 card detail                               [slice: card-detail]
          members.tsx              # web #7 members                                   [slice: members]
          rooms.tsx                # web #8 rooms/areas                               [slice: rooms]
          schedule.tsx             # web #9 schedule                                  [slice: schedule]
          settings.tsx             # web #10 settings                                 [slice: project-settings]
      activity.tsx                 # web #12 /activity (pushed from landing)          [slice: activity]
      brief.tsx                    # web #13 /brief    (pushed from landing)          [slice: brief]
      search.tsx                   # web #16 /search   (pushed from landing)          [slice: search]
      review.tsx                   # web #15 /review   (pushed from landing)          [slice: review]
    inbox.tsx                      # web #14 /notifications  (the Inbox tab IS notifications)  [slice: inbox]
    assistant.tsx                  # assistant chat (web has it in the board UI / API)         [slice: assistant]
    (more)/                        # NEW stack
      _layout.tsx
      index.tsx                    # account, role, language, logout, links to activity/brief/search/review
```

**Parity-map decisions / notes:**
- **Print routes (#6, #11)** have no native screen — native uses
  Share/Print sheet (`expo-print` / `expo-sharing`) invoked from card detail &
  project, not a route. Marked out of scope for foundation.
- **`/activity`, `/brief`, `/search`, `/review`** are reachable from the web landing
  as quick links; on mobile they live in the **Matrix stack** (push from the landing
  header) and are *also* surfaced from **More** so they're never buried. `/review` is
  principal/admin-relevant (draft queue) — gated by role in its own slice.
- **`/notifications` == Inbox tab.** Web has a `NotificationBadge` in the header; on
  mobile the unread count is a **tab badge** on Inbox (uses
  `subscribeToOwnNotifications`).
- **Assistant** has no standalone web *route* (it's embedded + `/api/assistant/*`);
  mobile promotes it to a first-class tab per LOCKED DECISION 4.
- `experiments.typedRoutes: true` is already on (`app.json`) → routes are
  type-checked; this slice must keep the tree compiling.

**Shared NativeWind primitives this slice ships** (in `apps/mobile/components/ui/`,
all token-driven — see §3 tokens): `Screen` (safe-area + oat bg), `Card`,
`Badge` (5-flag), `Text` (Space Grotesk weights/scale), `Button` (44dp min),
`Chip`, `EmptyState`, `ErrorState`, `Skeleton`, `OfflineBanner`. These mirror the
web treatments in `apps/web/app/globals.css` (`.chip`, `.skeleton`, the flag system,
the 44px touch rule) so look-and-feel matches.

**Every state, for foundation's own screens** (login, landing/Matrix list, More):
- **Loading:** `Skeleton` cards (mirror web `loading.tsx` + `.skeleton` pulse,
  respect reduced-motion).
- **Empty:** `EmptyState` with Bahasa copy (landing: "Belum ada proyek yang
  ditugaskan." — verbatim from `(app)/page.tsx`).
- **Error:** `ErrorState` with retry (landing: "Gagal memuat proyek: {msg}" — verbatim).
- **Offline:** `OfflineBanner` at top when `NetInfo`/`onlineManager` reports offline;
  cached data still renders from the persister (see §8).

---

## 5. Data fetching

Mobile reuses web's query keys and patterns verbatim (now from `@datum/core`):

- **Provider** (`apps/mobile/app/_layout.tsx`, this slice): a
  `PersistQueryClientProvider` (from `@tanstack/react-query-persist-client`) wrapping
  the tree, configured exactly like `apps/web/app/providers.tsx`:
  - `client = makeQueryClient()` (from core).
  - `persister = createKVPersister(asyncStorageKV, \`datum.rq.${session.user.id}\`)`
    — **per-user key** (same anti-leak rule as web).
  - `maxAge = CACHE_MAX_AGE`, `buster = CACHE_BUSTER`,
    `dehydrateOptions.shouldDehydrateQuery` gated to `PERSISTED_KEY_ROOTS`.
- **AsyncStorage KV adapter** (`apps/mobile/lib/query/async-kv.ts`, this slice):
  implements core's `AsyncKV` over `@react-native-async-storage/async-storage` —
  the RN twin of web's `idb-kv.ts`. Also exports `clearAsyncCache()` (mirrors
  `clearIdbCache`) called on logout.
- **Query keys:** `keys.projects()`, `keys.board(code)`, `keys.card(code, slug)` from
  `@datum/core` — identical strings → web and mobile caches are conceptually aligned
  (each device persists its own copy; keys are the contract).
- **Foundation's own queries:**
  - Matrix/landing: `useQuery({ queryKey: keys.projects(), queryFn: () =>
    getProjectsList(supabase) })` (direct core call, no `/api`).
- **`onlineManager` + `focusManager`:** wire React Native's `AppState` +
  `@react-native-community/netinfo` into react-query's managers so
  `refetchOnReconnect` / `refetchOnWindowFocus` (already in `makeQueryClient`) behave
  like web's window-focus/reconnect refetch.
- **Realtime channels** (helper shipped this slice, consumed by feature slices):
  `subscribeToProjectChanges(supabase, projectId, ({kind}) => qc.invalidateQueries(...))`
  and `subscribeToOwnNotifications(supabase, staffId, () =>
  qc.invalidateQueries({ queryKey: ["notifications"] }))`. A small
  `useRealtimeInvalidation` hook subscribes in `useEffect` and returns the cleanup —
  the mobile twin of how web components call these in effects
  (`components/board/Board.tsx`, `NotificationBadgeClient.tsx`).
- **Optimistic updates:** feature slices follow the web pattern in
  `apps/web/lib/query/mutations.ts` (cancel → snapshot `prev` → write `optimistic:`
  ghost → rollback on error → invalidate on settle). Foundation only documents the
  contract; it ships no mutations beyond demonstrating the read path.

---

## 6. Mutations & validation

Foundation introduces **no new mutations**; it establishes the convention:

- Mutation logic lives in `@datum/core` as pure
  `(supabase, input) => Promise<Result>` functions returning the discriminated
  `{ ok: true, … } | { ok: false, error }` shape web already uses (see
  `CreateCardResult` etc. in `apps/web/lib/cards/mutations.ts`).
- **Zod schemas** for inputs live in `packages/core/src/validation/*` and are
  imported by both the web `"use server"` wrapper (which parses `FormData` → object →
  `schema.parse`) and mobile (which builds the object directly from form state →
  `schema.parse`). This removes FormData coupling from the shared layer.
- `packages/types` (`@datum/types`, already depends on `zod`) holds cross-cutting
  domain enums/types (`src/domain.ts`, `src/event-kinds.ts`); `@datum/core` builds on
  it. Slice authors must check whether a schema belongs in `@datum/types` (pure
  shape) vs `@datum/core/validation` (DB-aware) — default to core unless the type is
  already public in `@datum/types`.

---

## 7. RLS & permissions notes (per role)

- **All access is RLS-enforced at the DB**, identically for web and mobile, because
  both use the **anon** key + the user's JWT. Migrations
  `20260531000002_rls_policies.sql`, `20260601000003/4_cards_rls*.sql`,
  `…_write_rls.sql` family, and `area_gate_status_write_rls` govern reads/writes.
  Mobile inherits all of it for free — no new policy work in this slice.
- **Service-role (`admin.ts`) is NEVER ported to mobile.** Any feature that today
  needs `createSupabaseAdminClient()` (e.g. inviting staff) stays a **web/server-only
  capability**; on mobile that action is hidden or routed to a future server
  endpoint. Foundation enforces this by lint-banning a service-role client in
  `@datum/core` and `apps/mobile`.
- **Role gating in UI:** `getCurrentStaff(supabase)` + `canManageAccess(staff)` from
  core decide whether to render management affordances (members management,
  `/projects/new`, `/review`). Roles: `principal`/`admin` → full incl. access mgmt;
  `designer`/`pic`/`site_supervisor`/`estimator` → standard. **cost-visible** is a
  separate `staff.cost_visible` flag (shown in web header) gating vendor/quote/invoice
  rows via RLS — mobile must respect it the same way (cost layer is a later slice).
- The board RPC `get_board_bundle` is `security definer`
  (`20260615000002_get_board_bundle_security_definer.sql`) — works the same called
  from mobile.

---

## 8. Offline behavior

Mirror web's offline-first cache, adapted to RN:

- **Read cache:** the AsyncStorage-backed `PersistQueryClientProvider` restores the
  last-good `board`/`projects`/`card` queries on cold start, so the app renders
  instantly offline (the same `staleTime 30s` / `gcTime 24h` / `buster v1` policy as
  web). `CACHE_MAX_AGE` (24h) bounds staleness; `CACHE_BUSTER` drops the store on
  shape changes.
- **Per-user namespacing:** persister key `datum.rq.${userId}`; on logout call
  `clearAsyncCache()` so a shared device leaks nothing (web parity:
  `clearIdbCache()`).
- **Network status:** `onlineManager` fed by NetInfo pauses queries when offline and
  resumes/refetches on reconnect (`refetchOnReconnect` already set). `OfflineBanner`
  communicates state.
- **Mutations offline:** foundation does not implement an offline mutation queue;
  feature mutations either disable their CTA when offline or surface a clear error.
  (A react-query mutation-resume/`PersistQueryClient` mutation cache is a possible
  later enhancement — flagged as out of scope.)
- **Realtime offline:** channels naturally drop offline and re-subscribe on
  reconnect; on resubscribe the slice's `onChange` triggers an invalidation to catch
  up missed events (same debounce-then-invalidate pattern as web).

---

## 9. Edge cases

- **Orphan auth user** (auth row but no `staff` row): web `getCurrentStaff` returns
  null → redirect. Mobile must do the same — `SessionProvider` treats
  `getCurrentStaff(supabase) === null` as "not fully provisioned" → sign out + show a
  login error, never a half-broken tab shell.
- **Token refresh mid-session:** `autoRefreshToken:true` already set in
  `apps/mobile/lib/supabase/client.ts`; `onAuthStateChange` updates the session
  context. On `SIGNED_OUT` (e.g. refresh failure) → clear cache + route to login.
- **Two `getCurrentStaff` definitions** in web today
  (`lib/auth/get-current-user.ts` returns full `Staff`;
  `lib/auth/require-role.ts` returns trimmed `CurrentStaff`). The core extraction
  must pick one canonical shape (proposal: keep both — a `getCurrentStaff` →
  `CurrentStaff` and a `getCurrentStaffRow` → `Staff` — to avoid breaking either
  caller) and repoint both web files to re-export. Verify both web call sites
  typecheck.
- **`refetchIntervalInBackground:false`** (web) means a backgrounded RN app won't
  poll — correct and battery-friendly; rely on realtime + focus refetch.
- **Cache-shape drift between web and mobile:** keys are shared but payload shapes
  must stay identical; since both now read through `@datum/core`, drift is structurally
  prevented as long as both consume the same core fn. Bump `CACHE_BUSTER` if a core
  return type changes.
- **NativeWind className typing** under `typedRoutes`/strict TS: ensure the
  `nativewind-env.d.ts` is included so `className` on RN components typechecks
  (mobile CI would otherwise fail).

---

## 10. Testing

- **Core logic — vitest** (`packages/core/vitest.config.ts`, mirrors
  `packages/db/vitest.config.ts`):
  - `keys` factory returns exact tuples; `PERSISTED_KEY_ROOTS` membership.
  - `createKVPersister` round-trips against an in-memory `AsyncKV` (the injected-store
    seam — same approach as web tests; cf. `apps/web/tests/unit/realtime.test.ts`).
  - `subscribeToProjectChanges` / `subscribeToOwnNotifications`: with a **mock
    SupabaseClient**, assert channel name, the 4 (resp. 2) `postgres_changes`
    registrations + filters, the 250ms debounce, and that the returned cleanup calls
    `removeChannel` (port `apps/web/tests/unit/realtime.test.ts`).
  - `getProjectsList` / `getDevelopments`: mock client, assert the select string,
    ordering, and the row→`ProjectListItem` mapping incl. `cover_url`.
  - `canManageAccess` truth table per role.
- **Mobile screens — @testing-library/react-native** (already a devDep; `jest-expo`
  preset configured in `apps/mobile/jest.config.js`):
  - Extend the existing `apps/mobile/tests/login.test.tsx` pattern.
  - `SessionProvider`/`useSession`: renders login when no session, tabs when session
    (mock `supabase.auth`).
  - Landing/Matrix screen: loading skeleton → list (mock `getProjectsList`), empty
    state ("Belum ada proyek…"), error state with retry, offline banner.
  - Tab badge: Inbox shows unread count from a mocked notifications query.
- **CI wiring** (`.github/workflows/ci.yml`):
  - Root `pnpm typecheck` / `pnpm test` already fan out via turbo to all packages, so
    once `@datum/core` and `apps/mobile` expose `typecheck`/`test` scripts +
    `dependsOn ^build`, they run automatically. Add an explicit
    **`pnpm --filter mobile lint`** step (expo lint) mirroring the existing
    non-blocking web-lint step, since mobile lint isn't part of root `lint` yet
    (`apps/mobile` has a `lint` script `expo lint`).
  - Add a lint rule (eslint `no-restricted-imports`) in `@datum/core` banning
    `next/*`, `server-only`, `react`, `react-native`, `expo*` — enforced in CI.
  - `turbo.json`: no structural change needed (tasks already declare
    `dependsOn:["^build"]`); optionally add `@datum/core`'s `build` outputs (`dist/**`
    is already covered by the existing `build.outputs: ["dist/**"]`).

---

## 11. Dependencies on other slices + Out of scope + Open questions

**This slice is a dependency of every other slice** (it ships the package, tokens,
providers, route tree, session). Downstream slices depend on `foundation` for:
`@datum/core` package + strangler recipe, shared query keys/persister/realtime,
NativeWind + tokens, the Expo Router skeleton, and `useSession`/role helpers.

**Foundation itself depends on:** nothing new — only existing `@datum/db`,
`@datum/types`, and the current mobile scaffold.

**Out of scope (owned elsewhere or deferred):**
- All feature screen designs (board, card-detail, assistant, inbox, search, brief,
  members, schedule, rooms, review, activity, projects-new) — each its own slice.
- Strangling `apps/web/lib/cards/mutations.ts` (1090 lines) — done piecemeal by the
  mutation-owning slices; foundation only demos the recipe on `projects/queries.ts`.
- Push notifications (`expo-notifications`), file upload UI, PDF/print, offline
  **mutation** queue, cost-layer gating UI.
- Any DB migration.

**Open questions (resolve during build):**
1. **Metro + workspace packages on Expo SDK 56** — confirm whether a
   `metro.config.js` with `watchFolders`/monorepo resolution is required for
   `@datum/core`'s built `dist/`, per the exact versioned docs
   (https://docs.expo.dev/versions/v56.0.0/) as mandated by `apps/mobile/AGENTS.md`.
   Decide tsup vs. consuming `src` directly via Metro transpile.
2. **`apps/web/lib/projects/cover.ts`** — verify it has no `next/*` import before
   moving `coverImageUrl` into `@datum/core`; if it builds a Supabase storage URL via
   an env var, decide env-injection strategy (web `NEXT_PUBLIC_*` vs mobile
   `EXPO_PUBLIC_*`).
3. **Unifying the two `getCurrentStaff`** — confirm both web call sites
   (`(app)/layout.tsx` via `require-role`, others via `get-current-user`) accept the
   dual-export plan without behavior change.
4. **react-query as peerDependency** — confirm mobile's installed
   `@tanstack/react-query` version (mobile currently has none in `package.json`; this
   slice adds it) matches web's `^5.101.0` so the persist-client APIs line up.
5. **NativeWind version** compatible with RN 0.85 / React 19 / Expo 56 — pin during
   build; ensure the shared token source format (JS object vs CSS vars) is consumable
   by both Tailwind v4 `@theme` (web `globals.css`) and the NativeWind/Tailwind
   config (mobile). Proposed source: a single `packages/core/src/tokens.ts` (the
   SANO `COLORS/TYPE/SPACE/RADIUS` objects from `SANO_Brand_Graphic_Standard.md` §9)
   that web's tailwind config and mobile's tailwind config both import.
