# Client cache-first loading (Trello-style) — design

- **Date:** 2026-06-14
- **Status:** Approved (design) — pending implementation plan
- **Author:** Wilson (with Claude)
- **Branch:** `feat/board-client-cache`

## Goal

Make the project board, projects list, and card-detail screens **load instantly on
revisit**, the way Trello does: render from a persistent client cache with zero
network on screen open, then revalidate in the background and patch the UI.

Success criteria:

- On any visit after the first, the screen paints from cache with **no blocking
  network request** (content visible before the API responds).
- Live correctness preserved: realtime changes and mutations still converge to the
  server truth, with the same optimistic UX as today.
- No regression to first-ever paint (still server-rendered).
- Existing e2e specs (board, add-card, comments, add-event) stay green.

## Non-goals

- Full offline *write* support (offline read falls out for free; offline mutations
  beyond the existing chat queue are out of scope).
- Caching every screen. Scope is **board + projects list + card detail**. Other
  screens (schedule, rooms, review, brief, search, settings) keep today's behavior.
- Replacing Server Actions as the write layer.

## Background — why it's slow today

Current architecture (web app): RSC pages fetch from Supabase on every visit via the
cookie-bound server client, pass data to client components; mutations are Server
Actions + `revalidatePath`; the board uses `useOptimistic` for add-card and realtime
calls `router.refresh()` (full server re-render) on any change.

Per board load there are ~9–11 sequential server→Supabase round-trips
(`auth.getUser()` runs 3×, `staff` 2×, plus the board's project → topics/cards/events
→ card_areas/gate_status waves and the advisor). With no Vercel region pin, functions
default to US East while the database is in Asia, so each round-trip can cross the
Pacific. Result: multi-second skeleton→content gap. Full analysis lives in the
session that produced this spec; the latency staircase: ~3.8s today → ~0.5s with a
region pin → ~0.25s fewer round-trips → ~0.1s (Trello-class) with this client cache.

This spec is **Tier 4** (client cache) bundled with **Tier 1** (region pin).

## Approach

Adopt the Trello model with **TanStack Query** (`@tanstack/react-query`) + a
**persistent IndexedDB cache** (`@tanstack/react-query-persist-client` + `idb-keyval`).
Keep the RSC pages as the **first-paint seed** (they pass their server-fetched data as
`initialData`), so we get SSR'd first paint *and* an instant persistent cache for
revisits.

```
Open screen
  ├─ IndexedDB has a fresh-enough entry?  ──yes──▶ render NOW (0 network) ─┐
  │                                                                        ├─▶ bg refetch ─▶ setQueryData ─▶ patch
  └─ no (first ever / busted) ─▶ RSC server-renders & seeds the query  ────┘
```

**Lessons folded in from the Trello tech-stack study** (the classic early write-up +
secondary summaries):

1. Trello's denormalized MongoDB "fast reads" → our single `get_board_bundle` RPC
   so the shell never sits over a slow refresh (§2a).
2. WebSocket push of card moves "almost instantly" to every open board →
   realtime-first freshness with idle backoff (§5, §1).
3. Thin 2k shell + <250k CDN bundle + cache subsequent visits → Next streaming shell
   + persistent IndexedDB **data** cache. We persist the *data*, not just the JS
   bundle, so revisits need zero data round-trip.

Trello is pure client-fetch; we keep SSR seeding for a content-not-skeleton first
paint (§4) — the one place we intentionally diverge.

## Architecture

### 1. Query provider + persistence

A new client component `apps/web/app/providers.tsx` mounting
`PersistQueryClientProvider`, rendered inside the **`(app)` layout**
(`apps/web/app/(app)/layout.tsx`) — it already loads the signed-in staff and wraps
exactly the cached screens; auth pages don't need it. Config:

- `QueryClient` defaults: `staleTime: 30_000`, `gcTime: 24h`,
  `refetchOnWindowFocus: true`, `refetchOnReconnect: true`, `retry: 1`.
- **Revalidation cadence (Trello-style backoff):** realtime push is the primary
  freshness signal (§5); periodic refetch is only a backstop. Allow focus refetch
  while the tab is visible; when hidden/idle, suspend interval refetch
  (`refetchIntervalInBackground: false`, no aggressive `refetchInterval`). The cache
  must not poll a board nobody is looking at.
- Persister: async IndexedDB persister backed by `idb-keyval` (single store, key per
  user — see §6).
- `maxAge: 24h` and a **buster** string = build id (e.g. `NEXT_PUBLIC_BUILD_ID` /
  commit SHA) so a deploy invalidates stale shapes.
- `dehydrateOptions`: only persist queries whose key root is in an allowlist
  (`board`, `projects`, `card`) — never persist auth/ephemeral queries.

### 2. JSON API routes (the client data source)

Thin route handlers that reuse the **existing** server query functions so the shape
matches the RSC seed exactly and label/deadline logic stays in one place. Each uses
`createSupabaseServerClient()` (cookie-bound → **RLS enforced**; never service role)
and returns 401 if unauthenticated.

- `GET /api/board/[code]` → **one** `get_board_bundle(code)` RPC (see §2a), then
  `computeCardLabels` / `computeCardDeadlines` in TS — collapses today's ~6 query
  waves into a single round-trip
- `GET /api/projects` → the home projects list query (extract from
  `app/(app)/page.tsx` into `lib/projects/queries.ts` so route + page share it)
- `GET /api/card/[code]/[slug]` → `getCardWithTimelineByProjectCode` (+ comments +
  members, matching what the card page renders)

Middleware already allows `/api` through with its own auth, so no middleware change.

### 2a. Single denormalized board read (Trello's "fast reads" lesson)

Today `getBoardForProject` issues ~6 sequential/parallel Supabase queries (project →
topics/cards/loop-events → card_areas/gate_status). Replace the *fetching* with one
Postgres RPC `get_board_bundle(p_code text)` returning a single JSON object that
bundles all of it:

```
{ project, topics[], cards[], loop_events[], card_areas[], gate_status[] }
```

- The RPC is a **data bundler only** — it does NOT recompute labels/deadlines in SQL.
  The route still runs the existing, tested `computeCardLabels` and
  `computeCardDeadlines` on the bundle, producing the same `Board` shape. Label and
  lifecycle rules stay in one place (TS); no SQL/TS drift.
- `SECURITY INVOKER` so RLS still applies via the caller's session.
- `getBoardForProject` is refactored to call the RPC; **both** the RSC seed and the
  API route go through it, so first paint and background refetch share one fast read.
- New migration in `packages/db/supabase/migrations/`; regenerate
  `packages/db/src/types.generated.ts` (this branch already touches db types).

### 3. Query keys + hooks

`apps/web/lib/query/keys.ts`:

```
board(code)        => ['board', code]
projects()         => ['projects']
card(code, slug)   => ['card', code, slug]
```

Hooks in `lib/query/hooks.ts`: `useBoard(code, opts)`, `useProjects(opts)`,
`useCard(code, slug, opts)` — each wraps `useQuery` with `queryFn` = fetch the
matching API route. Each accepts `initialData` for the SSR seed.

### 4. SSR seed (no first-paint regression)

RSC pages keep fetching server-side and pass the result down:

- `<Board initialBoard={board}>` → inside, `const { data } = useBoard(code, { initialData: initialBoard })`.
- Home page → `<ProjectsList initialProjects={projects}>` → `useProjects({ initialData })`.
- Card page → `<CardDetail initialCard={detail}>` → `useCard(code, slug, { initialData })`.

`initialData` seeds the cache so first paint is server-rendered and immediately
persisted; subsequent visits hydrate from IndexedDB before the queryFn runs.

### 5. Realtime-first freshness (replaces `router.refresh()`)

Realtime push is the **primary** way the cache stays fresh — mirroring Trello pushing
a card move to every open board "almost instantly." `lib/cards/realtime.ts`'s callback
changes from `router.refresh()` to
`queryClient.invalidateQueries({ queryKey: keys.board(code) })` (and
`keys.card(code, slug)` on the card screen); the resulting background refetch (one RPC
read, §2a) patches only what changed — no full server re-render. The existing debounce
stays. Periodic polling is a backstop only, with idle backoff per §1 — when nobody is
looking at a board it neither polls nor refetches.

### 6. Shared-device cache safety (flagged item A — approved)

IndexedDB is per browser profile; a shared site device must not leak one user's
cached data to the next. Mitigations:

- The persisted IDB key is namespaced by the signed-in user id:
  `datum.rq.<userId>`.
- On **logout** and on **login as a different user**, call `queryClient.clear()` and
  delete other-user IDB entries. Logout button + auth callback wired to do this.

### 7. Mutations → TanStack optimistic (flagged item B — approved)

Move board/card mutations from `useOptimistic`+`router.refresh` to `useMutation`:

- `onMutate`: `cancelQueries`, snapshot previous, `setQueryData` to apply the
  optimistic change (reuse `optimisticReducer`'s ghost-card logic for add-card).
- `onError`: roll back to the snapshot.
- `onSettled`: `invalidateQueries` to reconcile with the server.
- Server Actions remain the write mechanism (validation + RLS). Their
  `revalidatePath` calls are left in place (harmless; they still serve any
  non-cached RSC consumer) but the cached UI is driven by the mutation + realtime.

Affected flows: add-card, move-card, create-event, comments (create/edit/delete),
card members. UX is unchanged: instant ghost/echo, auto-revert on error. The board's
`useOptimistic` + the realtime `router.refresh()` path are retired.

### 8. Region pin (Tier 1 — approved)

Pin Vercel functions to the database's region so the background refresh is also fast.
Add region config (e.g. `vercel.json`/`vercel.ts` `"regions": ["sin1"]`, or set in
the Vercel dashboard). Confirm the actual Supabase region first and match it
(`sin1` Singapore is the working assumption given ~90ms RTT from Jakarta).

## Files touched (estimate)

New:
- `packages/db/supabase/migrations/<ts>_get_board_bundle_rpc.sql` + regenerated
  `packages/db/src/types.generated.ts`
- `app/providers.tsx` (query/persist provider)
- `lib/query/{client.ts,keys.ts,hooks.ts,persister.ts}`
- `app/api/board/[code]/route.ts`, `app/api/projects/route.ts`,
  `app/api/card/[code]/[slug]/route.ts`
- `lib/projects/queries.ts` (extracted home query)
- `lib/query/mutations.ts` (useMutation wrappers, one hook per flow)
- `vercel.json` (or `vercel.ts`) region pin
- tests (see below)

Modified:
- `lib/cards/queries.ts` (`getBoardForProject` refactored to call `get_board_bundle`)
- root/`(app)` layout (mount provider)
- `components/board/Board.tsx` (consume `useBoard`, optimistic mutations, realtime)
- `components/board/AddCardForm.tsx`, `MoveCardControl.tsx` (useMutation)
- `app/(app)/page.tsx` + new `ProjectsList` client wrapper
- card detail page + `CardDetail` client wrapper, comment/event/member components
- `lib/cards/realtime.ts` (invalidate instead of refresh)
- logout button + auth callback (cache clear)
- `package.json` (deps)

## Testing

Unit:
- IDB persister round-trip (persist → restore) against a fake/memory IDB.
- Query-key builders.
- Optimistic `onMutate` reducers (reuse `optimistic-board.test` patterns):
  ghost-card add, move, error rollback.
- Cache buster + user-namespacing; `clear()` on logout.

E2e (Playwright):
- Existing board / add-card / comments / add-event specs stay green.
- New: open board, reload, assert board content is visible **before/without** the
  `/api/board` response (e.g. delay the route and assert cached content renders
  first, then patches).

## Risks / tradeoffs

- **Stale-on-shared-device** → mitigated by user-namespacing + logout clear (§6).
- **Shape drift between RSC seed and API refetch** → mitigated by both calling the
  same query functions and types.
- **Bundle size** → +~12kb gz for TanStack Query; acceptable.
- **Branch base** → `feat/board-client-cache` is branched off
  `chore/db-types-search-text` (current HEAD), so it carries those commits until that
  branch merges. Confirm this is fine or rebase onto `main`.

## Rollout / sequencing

1. Region pin (Tier 1) — independent, ship/confirm first.
2. `get_board_bundle` RPC + refactor `getBoardForProject` to use it (one read);
   regenerate db types.
3. Provider + persister + query infra; board read-from-cache (SSR seed + IDB).
4. Board realtime → invalidate (idle backoff); board mutations → optimistic.
5. Projects list.
6. Card detail (read + comment/event/member mutations).
7. Cache-safety (logout/login clear) + tests throughout.

## Out of scope

Offline writes, caching of non-listed screens, mobile (Expo) app changes.
