# Client Cache-First Loading (Trello-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board, projects list, and card-detail screens load instantly on revisit by rendering from a persistent IndexedDB cache and revalidating in the background, the way Trello does.

**Architecture:** TanStack Query holds screen data keyed by identity (`board/code`, `projects`, `card/code/slug`), persisted to IndexedDB via `idb-keyval`. RSC pages still server-render first paint and pass their data as `initialData` (no first-paint regression). The board read collapses to a single `get_board_bundle` Postgres RPC. Supabase Realtime is the primary freshness signal — it invalidates the query cache instead of doing a full `router.refresh()`. Mutations use TanStack optimistic updates built on pure, node-testable reducer helpers.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, `@tanstack/react-query` + `@tanstack/react-query-persist-client`, `idb-keyval`, Supabase (Postgres + Realtime, RLS), Vitest (node env), Playwright.

**Spec:** `docs/superpowers/specs/2026-06-14-board-client-cache-design.md`

**Conventions used below**
- Package manager is **pnpm** with workspaces. Web app commands: `pnpm --filter web <script>`.
- Unit tests run in **node** env (`apps/web/vitest.config.ts`, `include: tests/unit/**/*.test.ts`). Keep all testable logic in **pure functions**; React/DOM behavior is covered by Playwright e2e (the project has no jsdom unit setup — do not add React Testing Library).
- Run one unit file: `pnpm --filter web exec vitest run tests/unit/<file>`.
- Typecheck: `pnpm --filter web typecheck`. E2e: `pnpm --filter web test:e2e`.
- Commit after every task.

---

## File Structure

**New files**
- `apps/web/vercel.json` — Vercel region pin (Tier 1).
- `packages/db/supabase/migrations/20260614000001_get_board_bundle_rpc.sql` — the denormalized board read RPC.
- `apps/web/lib/query/keys.ts` — query-key builders.
- `apps/web/lib/query/client.ts` — QueryClient factory + cache buster constant.
- `apps/web/lib/query/persister.ts` — KV-backed persister (testable over an injected async KV).
- `apps/web/lib/query/idb-kv.ts` — production `idb-keyval` async KV + store handle.
- `apps/web/lib/query/hooks.ts` — `useBoard` / `useProjects` / `useCard`.
- `apps/web/lib/query/mutations.ts` — optimistic mutation hooks.
- `apps/web/app/providers.tsx` — `PersistQueryClientProvider` wrapper.
- `apps/web/app/api/board/[code]/route.ts`
- `apps/web/app/api/projects/route.ts`
- `apps/web/app/api/card/[code]/[slug]/route.ts`
- `apps/web/lib/projects/queries.ts` — extracted home-list query.
- `apps/web/components/projects/ProjectsList.tsx` — client wrapper for the home grid.
- `apps/web/components/board/CardDetailClient.tsx` — client wrapper for the cached card sections.
- `apps/web/tests/unit/query-keys.test.ts`
- `apps/web/tests/unit/query-persister.test.ts`
- `apps/web/tests/unit/board-bundle.test.ts`
- `apps/web/tests/unit/optimistic-board-move.test.ts`
- `apps/web/tests/e2e/board-cache.spec.ts`

**Modified files**
- `apps/web/lib/cards/queries.ts` — split out `mapBoardBundle`; `getBoardForProject` calls the RPC.
- `apps/web/lib/cards/optimisticBoard.ts` — extract `applyAddCard`, add `applyMoveCard`.
- `apps/web/app/(app)/layout.tsx` — mount `<Providers userId=…>`.
- `apps/web/app/(app)/logout-button.tsx` — clear cache on logout.
- `apps/web/components/board/Board.tsx` — consume `useBoard`, realtime→invalidate, mutations.
- `apps/web/components/board/AddCardForm.tsx` — use `useAddCard`.
- `apps/web/components/board/MoveCardControl.tsx` — use `useMoveCard`.
- `apps/web/app/(app)/page.tsx` — render `<ProjectsList initialProjects=…>`.
- `apps/web/app/(app)/project/[slug]/page.tsx` — pass `initialBoard`.
- `apps/web/app/(app)/project/[slug]/cards/[cardSlug]/page.tsx` — pass card initial data.
- `apps/web/tests/unit/cards-queries.test.ts` — port board cases to `mapBoardBundle`.

---

## Phase 0 — Foundations (region pin + dependencies)

### Task 0.1: Pin the Vercel region to the database's region

**Files:**
- Create: `apps/web/vercel.json`

- [ ] **Step 1: Confirm the Supabase region**

Run:
```bash
curl -s -D - -o /dev/null https://nsmyazmxwdvwtdtqjrpx.supabase.co/rest/v1/ | grep -i cf-ray
```
Expected: a `cf-ray: …-SIN` or `…-CGK` style PoP. Then confirm the *project* region in the Supabase dashboard (Project Settings → General → Region). Use that region's Vercel code below (Singapore = `sin1`, Mumbai = `bom1`, Sydney = `syd1`). The working assumption is `sin1`.

- [ ] **Step 2: Write the region pin**

`apps/web/vercel.json`:
```json
{
  "regions": ["sin1"]
}
```
> Note: project root directory is `apps/web` (see `.vercel/project.json`), so `vercel.json` lives there. If the account is on Hobby and rejects a non-default region, set the Functions Region in the Vercel dashboard instead and delete this file.

- [ ] **Step 3: Commit**

```bash
git add apps/web/vercel.json
git commit -m "perf(web): pin Vercel functions to the database region (sin1)"
```

### Task 0.2: Add client-cache dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install**

Run:
```bash
pnpm --filter web add @tanstack/react-query@^5 @tanstack/react-query-persist-client@^5 idb-keyval@^6
```
Expected: the three packages appear under `dependencies` in `apps/web/package.json`.

- [ ] **Step 2: Verify it still typechecks/builds the dep graph**

Run: `pnpm --filter web typecheck`
Expected: PASS (no usage yet; just confirms install didn't break resolution).

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add tanstack-query + idb-keyval for client cache"
```

---

## Phase 1 — Single denormalized board read (RPC)

### Task 1.1: Create the `get_board_bundle` RPC migration

**Files:**
- Create: `packages/db/supabase/migrations/20260614000001_get_board_bundle_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- One round-trip board read: bundles project, topics, cards, open-loop events,
-- card_areas, and active gate-status rows as a single JSON object. Label and
-- deadline computation stays in TypeScript (mapBoardBundle); this function only
-- fetches. SECURITY INVOKER so the caller's RLS still applies.
create or replace function public.get_board_bundle(p_code text)
returns jsonb
language sql
stable
security invoker
as $$
  with proj as (
    select * from public.projects
    where upper(project_code) = upper(p_code)
    limit 1
  )
  select jsonb_build_object(
    'project', (select to_jsonb(p) from proj p),
    'topics', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'sort_order', t.sort_order)
        order by t.sort_order asc)
      from public.topics t where t.project_id = (select id from proj)
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id, 'slug', c.slug, 'title', c.title, 'topic_id', c.topic_id,
          'status', c.status, 'last_event_at', c.last_event_at,
          'current_summary', c.current_summary, 'properties', c.properties)
        order by c.last_event_at desc nulls last)
      from public.cards c where c.project_id = (select id from proj)
    ), '[]'::jsonb),
    'loop_events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id, 'card_id', e.card_id, 'event_kind', e.event_kind,
          'payload', e.payload, 'occurred_at', e.occurred_at, 'created_at', e.created_at))
      from public.card_events e
      where e.project_id = (select id from proj)
        and e.event_kind in ('decision', 'client_request', 'work')
    ), '[]'::jsonb),
    'card_areas', coalesce((
      select jsonb_agg(jsonb_build_object('card_id', ca.card_id, 'area_id', ca.area_id))
      from public.card_areas ca
      where ca.card_id in (select id from public.cards where project_id = (select id from proj))
    ), '[]'::jsonb),
    'gate_status', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'area_id', g.area_id, 'gate_code', g.gate_code, 'status', g.status,
          'target_start_date', g.target_start_date, 'target_end_date', g.target_end_date))
      from public.area_gate_status g
      where g.project_id = (select id from proj)
        and g.status in ('not_started', 'in_progress')
        and g.target_start_date is not null
    ), '[]'::jsonb)
  )
  where exists (select 1 from proj);

grant execute on function public.get_board_bundle(text) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration to the linked database**

Run: `pnpm --filter @datum/db migrate`
Expected: `supabase db push` applies `20260614000001_get_board_bundle_rpc.sql` with no error.
> If the Supabase CLI is not linked in this environment, hand this migration to the maintainer to push; the rest of Phase 1 can proceed (the refactor compiles without the DB), but Task 1.4's live check needs it applied.

- [ ] **Step 3: Smoke-test the RPC returns a bundle (optional, needs linked DB)**

Run (psql or Supabase SQL editor):
```sql
select jsonb_typeof(get_board_bundle('BDG-H1')) as t,
       jsonb_array_length(get_board_bundle('BDG-H1')->'cards') as cards;
```
Expected: `t = object`, `cards >= 0`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/supabase/migrations/20260614000001_get_board_bundle_rpc.sql
git commit -m "feat(db): get_board_bundle RPC for single-round-trip board read"
```

### Task 1.2: Split `getBoardForProject` into a pure `mapBoardBundle` + RPC fetch

**Files:**
- Modify: `apps/web/lib/cards/queries.ts:21-109`

- [ ] **Step 1: Write the failing test for `mapBoardBundle`**

Create `apps/web/tests/unit/board-bundle.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mapBoardBundle, type BoardBundle } from "@/lib/cards/queries";

const bundle: BoardBundle = {
  project: { id: "p1", project_code: "BDG-H1", project_name: "BDG H1" } as BoardBundle["project"],
  topics: [
    { id: "t1", code: "A05", name: "A05 — Kusen", sort_order: 3 },
    { id: "t2", code: "A09", name: "A09 — Detail Kamar Mandi", sort_order: 6 },
  ],
  cards: [
    { id: "c1", slug: "pintu", title: "Pintu utama", topic_id: "t1", status: "active",
      last_event_at: "2024-11-05", current_summary: null, properties: null },
    { id: "c2", slug: "master", title: "Master bathroom", topic_id: "t2", status: "active",
      last_event_at: "2026-05-20", current_summary: null, properties: null },
  ],
  loop_events: [
    { id: "e1", card_id: "c2", event_kind: "decision",
      payload: { topic: "marmer", status: "needs_decision", awaiting: "client" },
      occurred_at: "2026-06-01T00:00:00Z", created_at: "2026-06-01T00:00:00Z" },
  ],
  card_areas: [],
  gate_status: [],
};

describe("mapBoardBundle", () => {
  it("groups cards under topics in sort_order", () => {
    const board = mapBoardBundle(bundle, "2026-06-14");
    expect(board.project.project_code).toBe("BDG-H1");
    expect(board.columns.map((c) => c.topic.code)).toEqual(["A05", "A09"]);
    expect(board.columns[0]!.cards.map((c) => c.slug)).toEqual(["pintu"]);
  });

  it("derives open-loop labels and null deadline without area links", () => {
    const board = mapBoardBundle(bundle, "2026-06-14");
    const card = board.columns[1]!.cards[0]!;
    expect(card.labels.map((l) => l.kind)).toEqual(["needs_decision", "awaiting"]);
    expect(card.deadline).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/board-bundle.test.ts`
Expected: FAIL — `mapBoardBundle` / `BoardBundle` not exported.

- [ ] **Step 3: Refactor `queries.ts`**

In `apps/web/lib/cards/queries.ts`, add the bundle type + a typed RPC wrapper, then replace the body of `getBoardForProject` (lines 21-109) with a thin RPC call + `mapBoardBundle`. Keep all existing imports.

Add near the top (after existing imports):
```ts
export type BoardBundle = {
  project: Project;
  topics: Pick<Topic, "id" | "code" | "name" | "sort_order">[];
  cards: Pick<Card, "id" | "slug" | "title" | "topic_id" | "status" | "last_event_at" | "current_summary" | "properties">[];
  loop_events: { id: string; card_id: string; event_kind: string; payload: Record<string, unknown> | null; occurred_at: string; created_at: string }[];
  card_areas: { card_id: string; area_id: string }[];
  gate_status: DeadlineCell[];
};
```

Replace `getBoardForProject` with:
```ts
export async function getBoardForProject(
  supabase: SupabaseClient<Database>,
  projectSlug: string,
): Promise<Board> {
  // Single round-trip via the get_board_bundle RPC. Typed through a local cast so
  // this compiles whether or not types.generated.ts has been regenerated yet.
  const rpc = supabase.rpc as unknown as (
    fn: "get_board_bundle",
    args: { p_code: string },
  ) => Promise<{ data: BoardBundle | null; error: { message: string } | null }>;
  const { data, error } = await rpc("get_board_bundle", { p_code: projectSlug });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Project not found: ${projectSlug}`);
  return mapBoardBundle(data, new Date().toISOString().slice(0, 10));
}

/** Pure: turn a get_board_bundle payload into the Board the UI renders. Holds all
    label/deadline/grouping logic so it stays in one tested place. */
export function mapBoardBundle(bundle: BoardBundle, today: string): Board {
  const eventsByCard = new Map<string, LabelEvent[]>();
  for (const ev of bundle.loop_events) {
    const arr = eventsByCard.get(ev.card_id) ?? [];
    arr.push({
      event_kind: ev.event_kind,
      payload: ev.payload,
      occurred_at: ev.occurred_at,
      created_at: ev.created_at,
      id: ev.id,
    });
    eventsByCard.set(ev.card_id, arr);
  }

  const cards = (bundle.cards as unknown) as Card[];
  const deadlines = cards.length
    ? computeCardDeadlines(bundle.card_areas, bundle.gate_status, today)
    : new Map<string, CardDeadline>();

  const cardsByTopic = new Map<string, CardWithLabels[]>();
  for (const c of cards) {
    const labels = computeCardLabels(c, eventsByCard.get(c.id) ?? []);
    const withLabels: CardWithLabels = { ...c, labels, deadline: deadlines.get(c.id) ?? null };
    const arr = cardsByTopic.get(c.topic_id) ?? [];
    arr.push(withLabels);
    cardsByTopic.set(c.topic_id, arr);
  }

  const columns: BoardColumn[] = ((bundle.topics as unknown) as Topic[]).map((t) => ({
    topic: t,
    cards: cardsByTopic.get(t.id) ?? [],
  }));

  return { project: bundle.project, columns };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/unit/board-bundle.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Port the legacy board test off the `.from()` mock**

In `apps/web/tests/unit/cards-queries.test.ts`, the two `getBoardForProject` cases use a `.from().select()` chain mock that no longer matches the RPC. Delete those two `it(...)` blocks from the `describe("getBoardForProject")` block (their coverage now lives in `board-bundle.test.ts`). Leave the `getCardWithTimeline` describe block untouched.

- [ ] **Step 6: Run the full unit suite + typecheck**

Run: `pnpm --filter web exec vitest run && pnpm --filter web typecheck`
Expected: PASS. No reference to the removed board cases remains.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/cards/queries.ts apps/web/tests/unit/board-bundle.test.ts apps/web/tests/unit/cards-queries.test.ts
git commit -m "refactor(web): board read via get_board_bundle RPC + pure mapBoardBundle"
```

### Task 1.3: (Optional) Regenerate DB types

**Files:**
- Modify: `packages/db/src/types.generated.ts`

- [ ] **Step 1: Regenerate (needs linked Supabase CLI)**

Run: `pnpm --filter @datum/db types`
Expected: `get_board_bundle` appears under `Functions` in `src/types.generated.ts`. If the CLI isn't linked, skip — the local cast in Task 1.2 keeps everything compiling.

- [ ] **Step 2: Commit (only if the file changed)**

```bash
git add packages/db/src/types.generated.ts
git commit -m "chore(db): regenerate types for get_board_bundle"
```

---

## Phase 2 — Query infrastructure + persistence

### Task 2.1: Query keys

**Files:**
- Create: `apps/web/lib/query/keys.ts`
- Test: `apps/web/tests/unit/query-keys.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { keys } from "@/lib/query/keys";

describe("query keys", () => {
  it("builds stable, identity-scoped keys", () => {
    expect(keys.board("BDG-H1")).toEqual(["board", "BDG-H1"]);
    expect(keys.projects()).toEqual(["projects"]);
    expect(keys.card("BDG-H1", "master")).toEqual(["card", "BDG-H1", "master"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/query-keys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/lib/query/keys.ts`:
```ts
export const keys = {
  board: (code: string) => ["board", code] as const,
  projects: () => ["projects"] as const,
  card: (code: string, slug: string) => ["card", code, slug] as const,
};

export const PERSISTED_KEY_ROOTS = ["board", "projects", "card"] as const;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run tests/unit/query-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/query/keys.ts apps/web/tests/unit/query-keys.test.ts
git commit -m "feat(web): query-key builders"
```

### Task 2.2: KV-backed persister (testable over an injected store)

**Files:**
- Create: `apps/web/lib/query/persister.ts`
- Test: `apps/web/tests/unit/query-persister.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createKVPersister, type AsyncKV } from "@/lib/query/persister";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

function memoryKV(): AsyncKV & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: async (k) => dump.get(k) ?? null,
    setItem: async (k, v) => void dump.set(k, v),
    removeItem: async (k) => void dump.delete(k),
  };
}

const sample = { clientState: { queries: [], mutations: [] }, timestamp: 1, buster: "v1" } as unknown as PersistedClient;

describe("createKVPersister", () => {
  it("round-trips a persisted client", async () => {
    const kv = memoryKV();
    const p = createKVPersister(kv, "datum.rq.u1");
    await p.persistClient(sample);
    expect(kv.dump.has("datum.rq.u1")).toBe(true);
    const restored = await p.restoreClient();
    expect(restored).toEqual(sample);
  });

  it("returns undefined when nothing is stored", async () => {
    const p = createKVPersister(memoryKV(), "datum.rq.u1");
    expect(await p.restoreClient()).toBeUndefined();
  });

  it("removes the client", async () => {
    const kv = memoryKV();
    const p = createKVPersister(kv, "datum.rq.u1");
    await p.persistClient(sample);
    await p.removeClient();
    expect(kv.dump.has("datum.rq.u1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/query-persister.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/lib/query/persister.ts`:
```ts
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

export type AsyncKV = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** A react-query persister backed by any async key-value store. The store is
    injected so the production IndexedDB store and tests share one code path. */
export function createKVPersister(kv: AsyncKV, key: string): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await kv.setItem(key, JSON.stringify(client));
    },
    restoreClient: async () => {
      const raw = await kv.getItem(key);
      return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
    },
    removeClient: async () => {
      await kv.removeItem(key);
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run tests/unit/query-persister.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/query/persister.ts apps/web/tests/unit/query-persister.test.ts
git commit -m "feat(web): KV-backed react-query persister"
```

### Task 2.3: Production IndexedDB KV + QueryClient factory

**Files:**
- Create: `apps/web/lib/query/idb-kv.ts`
- Create: `apps/web/lib/query/client.ts`

- [ ] **Step 1: Implement the IndexedDB KV**

`apps/web/lib/query/idb-kv.ts`:
```ts
"use client";
import { get, set, del, clear, createStore } from "idb-keyval";
import type { AsyncKV } from "./persister";

const store = createStore("datum-cache", "rq");

export const idbKV: AsyncKV = {
  getItem: (k) => get<string>(k, store).then((v) => v ?? null),
  setItem: (k, v) => set(k, v, store),
  removeItem: (k) => del(k, store),
};

/** Wipe the entire cache store — used on logout so a shared device leaks nothing. */
export function clearIdbCache(): Promise<void> {
  return clear(store);
}
```

- [ ] **Step 2: Implement the QueryClient factory + buster**

`apps/web/lib/query/client.ts`:
```ts
import { QueryClient } from "@tanstack/react-query";

/** Bump when the persisted cache shape changes so old IndexedDB data is dropped. */
export const CACHE_BUSTER = "v1";
export const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: CACHE_MAX_AGE,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchIntervalInBackground: false, // Trello-style: don't poll a board nobody is viewing
        retry: 1,
      },
    },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/query/idb-kv.ts apps/web/lib/query/client.ts
git commit -m "feat(web): IndexedDB cache store + QueryClient factory"
```

### Task 2.4: Providers component + mount in the (app) layout

**Files:**
- Create: `apps/web/app/providers.tsx`
- Modify: `apps/web/app/(app)/layout.tsx`

- [ ] **Step 1: Implement Providers**

`apps/web/app/providers.tsx`:
```tsx
"use client";
import { useState } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { makeQueryClient, CACHE_BUSTER, CACHE_MAX_AGE } from "@/lib/query/client";
import { createKVPersister } from "@/lib/query/persister";
import { idbKV } from "@/lib/query/idb-kv";
import { PERSISTED_KEY_ROOTS } from "@/lib/query/keys";

export function Providers({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  // Namespace the persisted cache by user so a shared device never shows one
  // user's data to the next.
  const [persister] = useState(() => createKVPersister(idbKV, `datum.rq.${userId}`));

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            (PERSISTED_KEY_ROOTS as readonly string[]).includes(q.queryKey[0] as string),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
```

- [ ] **Step 2: Mount it in the (app) layout**

In `apps/web/app/(app)/layout.tsx`, import `Providers` and wrap the existing returned tree with it, passing the staff id. The layout already resolves `staff` (and redirects if absent), so `staff.id` is available.

Add import:
```tsx
import { Providers } from "@/app/providers";
```
Wrap the outermost `<div className="flex h-screen …">…</div>` so it becomes:
```tsx
return (
  <Providers userId={staff.id}>
    <div className="flex h-screen flex-col overflow-hidden bg-[#D2D0C4] text-[#141210]">
      {/* …unchanged… */}
    </div>
  </Providers>
);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 4: Verify the app still renders (no behavior change yet)**

Start the dev server and confirm a board still loads (still via RSC; the provider is just mounted).
Run: `pnpm --filter web dev` → open a project board → it renders as before. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/providers.tsx "apps/web/app/(app)/layout.tsx"
git commit -m "feat(web): mount PersistQueryClientProvider (user-namespaced IDB cache)"
```

---

## Phase 3 — JSON API routes

### Task 3.1: `GET /api/board/[code]`

**Files:**
- Create: `apps/web/app/api/board/[code]/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBoardForProject } from "@/lib/cards/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const board = await getBoardForProject(supabase, code);
    return NextResponse.json(board);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
```

- [ ] **Step 2: Manual check**

Start dev server, sign in, open a board so a session cookie exists, then in the browser console:
```js
await (await fetch(`/api/board/${location.pathname.split("/").pop()}`)).json()
```
Expected: a JSON object `{ project, columns: [...] }` matching the rendered board. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/board/
git commit -m "feat(web): GET /api/board/[code] (RLS-scoped board JSON)"
```

### Task 3.2: Extract projects query + `GET /api/projects`

**Files:**
- Create: `apps/web/lib/projects/queries.ts`
- Create: `apps/web/app/api/projects/route.ts`
- Modify: `apps/web/app/(app)/page.tsx:13-23`

- [ ] **Step 1: Extract the query**

`apps/web/lib/projects/queries.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type ProjectListItem = {
  id: string; project_code: string; project_name: string;
  client_name: string | null; location: string | null;
  status: string; target_handover: string | null;
};

export async function getProjectsList(
  supabase: SupabaseClient<Database>,
): Promise<ProjectListItem[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, project_code, project_name, client_name, location, status, target_handover")
    .order("project_code");
  if (error) throw error;
  return (data ?? []) as ProjectListItem[];
}
```

- [ ] **Step 2: Use it in the home page**

In `apps/web/app/(app)/page.tsx`, replace the inline `supabase.from("projects").select(...)` block with `getProjectsList(supabase)` (keep the separate `pendingDraftCount` query as-is). Import `getProjectsList`. The variable `projects` keeps the same shape downstream.

- [ ] **Step 3: Implement the route**

`apps/web/app/api/projects/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectsList } from "@/lib/projects/queries";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getProjectsList(supabase));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Typecheck + verify home still renders**

Run: `pnpm --filter web typecheck`
Expected: PASS. Dev-server check: home lists projects as before.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/projects/queries.ts apps/web/app/api/projects/ "apps/web/app/(app)/page.tsx"
git commit -m "feat(web): extract projects query + GET /api/projects"
```

### Task 3.3: `GET /api/card/[code]/[slug]`

**Files:**
- Create: `apps/web/app/api/card/[code]/[slug]/route.ts`

- [ ] **Step 1: Implement (card timeline + comments + members — the dynamic core)**

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCardWithTimelineByProjectCode, getCardComments, getCardMembers } from "@/lib/cards/queries";

export type CardPayload = Awaited<ReturnType<typeof getCardWithTimelineByProjectCode>> & {
  comments: Awaited<ReturnType<typeof getCardComments>>;
  members: Awaited<ReturnType<typeof getCardMembers>>;
};

export async function GET(_req: Request, { params }: { params: Promise<{ code: string; slug: string }> }) {
  const { code, slug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const detail = await getCardWithTimelineByProjectCode(supabase, code.toUpperCase(), slug);
    const [comments, members] = await Promise.all([
      getCardComments(supabase, detail.card.id),
      getCardMembers(supabase, detail.card.id),
    ]);
    return NextResponse.json({ ...detail, comments, members } satisfies CardPayload);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/card/
git commit -m "feat(web): GET /api/card/[code]/[slug] (timeline + comments + members)"
```

---

## Phase 4 — Board reads from cache + realtime-first

### Task 4.1: Query hooks

**Files:**
- Create: `apps/web/lib/query/hooks.ts`

- [ ] **Step 1: Implement**

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { keys } from "./keys";
import type { Board } from "@/lib/cards/queries";
import type { ProjectListItem } from "@/lib/projects/queries";
import type { CardPayload } from "@/app/api/card/[code]/[slug]/route";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export function useBoard(code: string, initialData: Board) {
  return useQuery({
    queryKey: keys.board(code),
    queryFn: () => fetchJson<Board>(`/api/board/${code}`),
    initialData,
  });
}

export function useProjects(initialData: ProjectListItem[]) {
  return useQuery({
    queryKey: keys.projects(),
    queryFn: () => fetchJson<ProjectListItem[]>(`/api/projects`),
    initialData,
  });
}

export function useCard(code: string, slug: string, initialData: CardPayload) {
  return useQuery({
    queryKey: keys.card(code, slug),
    queryFn: () => fetchJson<CardPayload>(`/api/card/${code}/${slug}`),
    initialData,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/query/hooks.ts
git commit -m "feat(web): useBoard/useProjects/useCard hooks"
```

### Task 4.2: Board consumes `useBoard` + realtime invalidates the cache

**Files:**
- Modify: `apps/web/components/board/Board.tsx:12-26`
- Modify: `apps/web/app/(app)/project/[slug]/page.tsx:83`

- [ ] **Step 1: Rewire Board to read from the query and invalidate on realtime**

In `apps/web/components/board/Board.tsx`:
- Change the signature from `{ board }: { board: BoardData }` to `{ initialBoard }: { initialBoard: BoardData }`.
- Derive the live board from the cache; drive realtime through the query client.

Replace lines 12-26 with:
```tsx
export function Board({ initialBoard }: { initialBoard: BoardData }) {
  const code = initialBoard.project.project_code;
  const queryClient = useQueryClient();
  const { data: board } = useBoard(code, initialBoard);
  const liveBoard = board ?? initialBoard;

  useEffect(() => {
    return subscribeToProjectChanges(initialBoard.project.id, () => {
      queryClient.invalidateQueries({ queryKey: keys.board(code) });
    });
  }, [initialBoard.project.id, code, queryClient]);
```
Update the imports at the top of the file:
```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBoard } from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";
```
Remove `useOptimistic`, `useTransition`, `useRouter`, and the `optimisticReducer` / `OptimisticBoardProvider` imports **only after** Task 5 moves add-card to a mutation. For this task, keep the optimistic provider working by seeding it from `liveBoard`: replace every later reference to `optimisticBoard` with `liveBoard`, and keep the existing `useOptimistic(liveBoard, optimisticReducer)` line but feed it `liveBoard`:
```tsx
  const [optimisticBoard, addOptimistic] = useOptimistic(liveBoard, optimisticReducer);
```
> Rationale: this task makes reads cache-first without disturbing the existing add-card UX; Task 5 then replaces the optimistic layer entirely. Keep `useOptimistic`/`useTransition` imports until then.

- [ ] **Step 2: Pass `initialBoard` from the page**

In `apps/web/app/(app)/project/[slug]/page.tsx`, change `<Board board={board} />` (line ~83) to `<Board initialBoard={board} />`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 4: Verify reads + realtime in the browser**

Dev server: open a board (renders from RSC seed). In another tab move/add a card → the first tab updates within ~1s (realtime → invalidate → refetch), with no full page flash. Reload the board → it paints immediately from the persisted cache. Stop the server.

- [ ] **Step 5: Run existing board e2e**

Run: `pnpm --filter web test:e2e tests/e2e/board.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/board/Board.tsx "apps/web/app/(app)/project/[slug]/page.tsx"
git commit -m "feat(web): board reads from IDB cache; realtime invalidates instead of router.refresh"
```

---

## Phase 5 — Board mutations → optimistic

### Task 5.1: Pure optimistic helpers (add + move)

**Files:**
- Modify: `apps/web/lib/cards/optimisticBoard.ts`
- Test: `apps/web/tests/unit/optimistic-board-move.test.ts`

- [ ] **Step 1: Write the failing test for `applyMoveCard`**

`apps/web/tests/unit/optimistic-board-move.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { applyMoveCard, applyAddCard } from "@/lib/cards/optimisticBoard";
import type { Board } from "@/lib/cards/queries";

const board: Board = {
  project: { id: "p1", project_code: "BDG-H1", project_name: "BDG H1" } as Board["project"],
  columns: [
    { topic: { id: "t1", code: "A", name: "A", sort_order: 1 } as Board["columns"][number]["topic"],
      cards: [{ id: "c1", slug: "x", title: "X", topic_id: "t1", status: "active", labels: [], deadline: null } as Board["columns"][number]["cards"][number]] },
    { topic: { id: "t2", code: "B", name: "B", sort_order: 2 } as Board["columns"][number]["topic"], cards: [] },
  ],
};

describe("applyMoveCard", () => {
  it("moves a card to the target column", () => {
    const next = applyMoveCard(board, "c1", "t2");
    expect(next.columns[0]!.cards).toHaveLength(0);
    expect(next.columns[1]!.cards.map((c) => c.id)).toEqual(["c1"]);
  });
  it("returns the board unchanged for an unknown card", () => {
    expect(applyMoveCard(board, "nope", "t2")).toBe(board);
  });
});

describe("applyAddCard", () => {
  it("appends a ghost card to the matching column", () => {
    const next = applyAddCard(board, "t2", "New one");
    expect(next.columns[1]!.cards.at(-1)!.title).toBe("New one");
    expect(next.columns[1]!.cards.at(-1)!.__optimistic).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/optimistic-board-move.test.ts`
Expected: FAIL — `applyMoveCard` / `applyAddCard` not exported.

- [ ] **Step 3: Implement the helpers**

In `apps/web/lib/cards/optimisticBoard.ts`, extract the add-card branch into `applyAddCard` and add `applyMoveCard`. Keep `optimisticReducer` delegating to `applyAddCard` so existing behavior/tests are unchanged.
```ts
export function applyAddCard(board: Board, topicId: string, title: string): Board {
  let matched = false;
  const columns = board.columns.map((col) => {
    if (col.topic.id !== topicId) return col;
    matched = true;
    return { ...col, cards: [...col.cards, makeOptimisticCard(topicId, title)] };
  });
  return matched ? { ...board, columns } : board;
}

export function applyMoveCard(board: Board, cardId: string, newTopicId: string): Board {
  let card: BoardCardView | undefined;
  for (const col of board.columns) {
    const found = col.cards.find((c) => c.id === cardId);
    if (found) { card = found; break; }
  }
  if (!card) return board;
  const moved: BoardCardView = { ...card, topic_id: newTopicId };
  const columns = board.columns.map((col) => {
    if (col.topic.id === card!.topic_id && col.topic.id !== newTopicId) {
      return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
    }
    if (col.topic.id === newTopicId) {
      return { ...col, cards: [...col.cards.filter((c) => c.id !== cardId), moved] };
    }
    return col;
  });
  return { ...board, columns };
}
```
And change `optimisticReducer`'s add-card branch body to `return applyAddCard(board, action.topicId, action.title);`.

- [ ] **Step 4: Run move + existing optimistic tests**

Run: `pnpm --filter web exec vitest run tests/unit/optimistic-board-move.test.ts tests/unit/optimistic-board.test.ts`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/cards/optimisticBoard.ts apps/web/tests/unit/optimistic-board-move.test.ts
git commit -m "feat(web): pure applyAddCard/applyMoveCard board reducers"
```

### Task 5.2: Optimistic mutation hooks

**Files:**
- Create: `apps/web/lib/query/mutations.ts`

- [ ] **Step 1: Implement `useAddCard` + `useMoveCard`**

```tsx
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "./keys";
import { applyAddCard, applyMoveCard } from "@/lib/cards/optimisticBoard";
import { createCard, moveCard } from "@/lib/cards/mutations";
import type { Board } from "@/lib/cards/queries";

export function useAddCard(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fd: FormData) => createCard(fd),
    onMutate: async (fd: FormData) => {
      const topicId = String(fd.get("topicId"));
      const title = String(fd.get("title"));
      await qc.cancelQueries({ queryKey: keys.board(code) });
      const prev = qc.getQueryData<Board>(keys.board(code));
      if (prev) qc.setQueryData(keys.board(code), applyAddCard(prev, topicId, title));
      return { prev };
    },
    onError: (_e, _fd, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.board(code), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.board(code) }),
  });
}

export function useMoveCard(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fd: FormData) => moveCard(fd),
    onMutate: async (fd: FormData) => {
      const cardId = String(fd.get("cardId"));
      const newTopicId = String(fd.get("newTopicId"));
      await qc.cancelQueries({ queryKey: keys.board(code) });
      const prev = qc.getQueryData<Board>(keys.board(code));
      if (prev) qc.setQueryData(keys.board(code), applyMoveCard(prev, cardId, newTopicId));
      return { prev };
    },
    onError: (_e, _fd, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.board(code), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.board(code) }),
  });
}
```
> `createCard`/`moveCard` are server actions returning `{ ok: false, error }` on failure rather than throwing. After `await`, if `res.ok === false`, throw so `onError` rolls back — handle that in the form (Task 5.3) by checking the result, or wrap here. Wrap here for a single rollback path:
```tsx
    mutationFn: async (fd: FormData) => {
      const res = await createCard(fd);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
```
Apply the same `if (!res.ok) throw` wrapping to `moveCard` in `useMoveCard`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/query/mutations.ts
git commit -m "feat(web): optimistic useAddCard/useMoveCard mutations"
```

### Task 5.3: Switch AddCardForm + MoveCardControl to the mutations; retire the old optimistic layer

**Files:**
- Modify: `apps/web/components/board/AddCardForm.tsx`
- Modify: `apps/web/components/board/MoveCardControl.tsx`
- Modify: `apps/web/components/board/Board.tsx`

- [ ] **Step 1: AddCardForm uses `useAddCard`**

In `apps/web/components/board/AddCardForm.tsx`, replace the `useOptimisticBoard` + `useTransition` + `createCard` flow with the mutation. The component already receives `projectCode`.
```tsx
"use client";
import { useState } from "react";
import { useAddCard } from "@/lib/query/mutations";

export function AddCardForm({ projectId, topicId, projectCode }: {
  projectId: string; topicId: string; projectCode: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const addCard = useAddCard(projectCode);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("topicId", topicId);
    fd.set("projectCode", projectCode);
    fd.set("title", trimmed);
    setTitle("");
    setOpen(false);
    addCard.mutate(fd, {
      onError: (err) => { setTitle(trimmed); setOpen(true); setError((err as Error).message); },
    });
  }
  // …rest of the JSX unchanged, but use `addCard.isPending` wherever `pending` was used…
}
```
Replace every `pending` reference in the JSX with `addCard.isPending`. Remove the `projectId` is still needed — keep it.

- [ ] **Step 2: MoveCardControl uses `useMoveCard`**

Open `apps/web/components/board/MoveCardControl.tsx`, find where it builds a `FormData` and calls `moveCard` (server action). Replace the direct call with `const move = useMoveCard(projectCode); move.mutate(fd, { onError: … })`. Ensure `projectCode` is in scope (it's part of the move FormData fields: `projectCode`). If the component doesn't already receive `projectCode` as a prop, add it and pass it from the caller (`CardHeader`/board). Use `move.isPending` for the disabled state.

- [ ] **Step 3: Retire the old optimistic provider in Board**

In `apps/web/components/board/Board.tsx`:
- Remove `useOptimistic`, `useTransition`, `optimisticReducer`, `OptimisticBoardProvider`, and the `api`/`addOptimistic` wiring.
- Render columns directly from `liveBoard` (rename the `filteredColumns` source from `optimisticBoard.columns` to `liveBoard.columns`).
- Remove the `<OptimisticBoardProvider value={api}>` wrapper (children render directly).
Delete now-unused files only if nothing else imports them: check `optimisticBoardContext.tsx` usages first (`grep -rn useOptimisticBoard apps/web`). If `AddCardForm` was the only consumer, delete `apps/web/lib/cards/optimisticBoardContext.tsx`.

- [ ] **Step 4: Typecheck + unit + e2e**

Run:
```bash
pnpm --filter web typecheck && \
pnpm --filter web exec vitest run && \
pnpm --filter web test:e2e tests/e2e/add-card.spec.ts tests/e2e/board.spec.ts
```
Expected: PASS. The add-card e2e still sees an instant ghost card and persistence.

- [ ] **Step 5: Verify add + move feel instant in the browser**

Dev server: add a card → appears instantly, survives reload. Move a card → moves instantly, other tabs follow via realtime. Force an error (e.g. offline) → the card reverts. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/board/
git commit -m "feat(web): board add/move use optimistic TanStack mutations"
```

---

## Phase 6 — Projects list from cache

### Task 6.1: ProjectsList client wrapper seeded from RSC

**Files:**
- Create: `apps/web/components/projects/ProjectsList.tsx`
- Modify: `apps/web/app/(app)/page.tsx`

- [ ] **Step 1: Build the client wrapper**

`apps/web/components/projects/ProjectsList.tsx`:
```tsx
"use client";
import { useProjects } from "@/lib/query/hooks";
import type { ProjectListItem } from "@/lib/projects/queries";
import Link from "next/link";

export function ProjectsList({ initialProjects }: { initialProjects: ProjectListItem[] }) {
  const { data: projects } = useProjects(initialProjects);
  const list = projects ?? initialProjects;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((p) => (
        <Link key={p.id} href={`/project/${p.project_code}`} className="rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] p-4 hover:border-[#7A6B56]">
          <div className="text-sm font-semibold text-[#141210]">{p.project_code} · {p.project_name}</div>
          <div className="mt-1 text-xs text-[#524E49]">{p.client_name ?? "—"} · {p.location ?? "—"}</div>
        </Link>
      ))}
    </div>
  );
}
```
> Match the exact card markup the current `page.tsx` renders for each project (copy its className structure and fields). The snippet above is the shape; mirror the live styling so the visual is unchanged.

- [ ] **Step 2: Render it from the home page**

In `apps/web/app/(app)/page.tsx`, replace the inline `projects.map(...)` grid with `<ProjectsList initialProjects={projects} />` (keep the header, search links, and `pendingDraftCount` badge as-is). Import `ProjectsList`.

- [ ] **Step 3: Typecheck + browser check**

Run: `pnpm --filter web typecheck`
Expected: PASS. Dev server: home renders the same; reload is instant from cache; navigating home→board→home shows cached home immediately.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/projects/ProjectsList.tsx "apps/web/app/(app)/page.tsx"
git commit -m "feat(web): projects list reads from IDB cache"
```

---

## Phase 7 — Card detail from cache

### Task 7.1: CardDetailClient wrapper seeded from RSC

**Files:**
- Create: `apps/web/components/board/CardDetailClient.tsx`
- Modify: `apps/web/app/(app)/project/[slug]/cards/[cardSlug]/page.tsx`

- [ ] **Step 1: Build the wrapper around the cached sections**

The card page loads many things; only the **dynamic** parts (timeline events, comments, members) move into the cache. The static editing affordances (areas, links, staff candidates, topics) stay as server-passed props.

`apps/web/components/board/CardDetailClient.tsx`:
```tsx
"use client";
import { useCard } from "@/lib/query/hooks";
import type { CardPayload } from "@/app/api/card/[code]/[slug]/route";
import { Timeline } from "@/components/board/Timeline";
import { CommentsSection } from "@/components/board/CommentsSection";
import { CardMembers } from "@/components/board/CardMembers";

export function CardDetailClient({
  code, slug, initialCard, ...rest
}: {
  code: string; slug: string; initialCard: CardPayload;
  // pass through the props Timeline/CommentsSection/CardMembers already require
  attachmentsByEvent: React.ComponentProps<typeof Timeline>["attachmentsByEvent"];
  candidates: React.ComponentProps<typeof CardMembers>["candidates"];
  projectId: string; projectCode: string;
}) {
  const { data } = useCard(code, slug, initialCard);
  const card = data ?? initialCard;
  return (
    <>
      <CardMembers projectId={rest.projectId} cardId={card.card.id} members={card.members} candidates={rest.candidates} />
      <Timeline events={card.events} attachmentsByEvent={rest.attachmentsByEvent} /* …existing props… */ />
      <CommentsSection cardId={card.card.id} comments={card.comments} projectCode={code} cardSlug={slug} />
    </>
  );
}
```
> Read the current card page JSX and match the exact props each of `Timeline`, `CommentsSection`, `CardMembers` expects. The wrapper's job is only to source `events`/`comments`/`members` from `useCard` instead of from server props; everything else passes through unchanged.

- [ ] **Step 2: Wire the page to pass `initialCard`**

In `apps/web/app/(app)/project/[slug]/cards/[cardSlug]/page.tsx`, after the existing server fetches, assemble `initialCard: CardPayload = { ...detail, comments, members }` (fetch `comments` alongside the existing `members` via `getCardComments`), and render the dynamic sections through `<CardDetailClient code={slug.toUpperCase()} slug={cardSlug} initialCard={initialCard} … />`. Keep `CardHeader`, `CardAreas`, `CardLinks`, `MoveCardControl`, `AddEventForm` exactly as they are.

- [ ] **Step 3: Typecheck + browser check**

Run: `pnpm --filter web typecheck`
Expected: PASS. Dev server: open a card → renders from RSC seed; navigate away and back → instant from cache; reload → instant.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/board/CardDetailClient.tsx "apps/web/app/(app)/project/[slug]/cards/[cardSlug]/page.tsx"
git commit -m "feat(web): card detail (timeline/comments/members) reads from IDB cache"
```

### Task 7.2: Card realtime + comment optimistic

**Files:**
- Modify: `apps/web/components/board/CardDetailClient.tsx`
- Modify: `apps/web/lib/query/mutations.ts`
- Modify: `apps/web/components/board/CommentInput.tsx`

- [ ] **Step 1: Invalidate the card query on realtime**

In `CardDetailClient`, subscribe with the existing `subscribeToProjectChanges(projectId, …)` and invalidate `keys.card(code, slug)` on change (mirrors Board Task 4.2). Replace any existing `router.refresh()` in the card screen (e.g. `CommentsRefresher`) usage with this invalidation, or have `CommentsRefresher` accept an `onChange` that invalidates.

- [ ] **Step 2: Add `useAddComment` optimistic mutation**

In `apps/web/lib/query/mutations.ts`:
```tsx
import { createComment } from "@/lib/cards/mutations";
import type { CardPayload } from "@/app/api/card/[code]/[slug]/route";

export function useAddComment(code: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fd: FormData) => {
      const res = await createComment(fd);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (fd: FormData) => {
      const body = String(fd.get("body") ?? "");
      await qc.cancelQueries({ queryKey: keys.card(code, slug) });
      const prev = qc.getQueryData<CardPayload>(keys.card(code, slug));
      if (prev) {
        const ghost = { id: `optimistic:${body}`, body, created_at: "", deleted_at: null, __optimistic: true } as unknown as CardPayload["comments"][number];
        qc.setQueryData<CardPayload>(keys.card(code, slug), { ...prev, comments: [...prev.comments, ghost] });
      }
      return { prev };
    },
    onError: (_e, _fd, ctx) => { if (ctx?.prev) qc.setQueryData(keys.card(code, slug), ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.card(code, slug) }),
  });
}
```
> Match the comment FormData field names to what `createComment` parses (read `lib/cards/mutations.ts` `CreateCommentInput`) and the ghost shape to `CardComment`.

- [ ] **Step 3: Use it in CommentInput**

Replace `CommentInput`'s direct `createComment` call with `useAddComment(code, slug).mutate(fd, { onError })`. Pass `code`/`slug` down from `CommentsSection` (it already has `projectCode`/`cardSlug`).

- [ ] **Step 4: Typecheck + comments e2e**

Run: `pnpm --filter web typecheck && pnpm --filter web test:e2e tests/e2e/comments.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/board/CardDetailClient.tsx apps/web/components/board/CommentInput.tsx apps/web/lib/query/mutations.ts
git commit -m "feat(web): card realtime invalidation + optimistic comment add"
```

> **Scope note (events & members):** `AddEventForm` and `CardMembers` keep their current server-action + `revalidatePath` flow; the card-query realtime invalidation (Step 1) keeps their data correct in the cache. Converting them to fully optimistic mutations is a fast-follow using the exact `useAddComment` shape (swap the action and the array touched) and is intentionally deferred to keep this plan's surface bounded.

---

## Phase 8 — Cache safety (logout/login)

### Task 8.1: Clear the cache on logout

**Files:**
- Modify: `apps/web/app/(app)/logout-button.tsx`

- [ ] **Step 1: Clear react-query + IndexedDB on sign-out**

In `apps/web/app/(app)/logout-button.tsx`, before/after calling `supabase.auth.signOut()`, clear both caches so a shared device leaks nothing:
```tsx
import { useQueryClient } from "@tanstack/react-query";
import { clearIdbCache } from "@/lib/query/idb-kv";

// inside the component:
const qc = useQueryClient();
async function handleLogout() {
  await supabase.auth.signOut();
  qc.clear();
  await clearIdbCache();
  router.push("/login"); // or existing redirect
}
```
Match the existing logout handler's structure (keep its current redirect/refresh behavior; just add `qc.clear()` + `await clearIdbCache()`).

- [ ] **Step 2: Typecheck + login e2e**

Run: `pnpm --filter web typecheck && pnpm --filter web test:e2e tests/e2e/login.spec.ts`
Expected: PASS.

- [ ] **Step 3: Manual check**

Dev server: log in as user A → open boards → log out → log in as user B. B sees no A-cached data (B's namespaced key is empty and the store was cleared). Stop the server.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/logout-button.tsx"
git commit -m "feat(web): clear query + IDB cache on logout"
```

---

## Phase 9 — End-to-end cache proof + full verification

### Task 9.1: E2e — board renders from cache before the API responds

**Files:**
- Create: `apps/web/tests/e2e/board-cache.spec.ts`

- [ ] **Step 1: Write the spec**

Reuse the login helper/pattern from `apps/web/tests/e2e/board.spec.ts` (copy its sign-in setup). Use a real project code present in the test data (the board spec uses one — reuse it).
```ts
import { test, expect } from "@playwright/test";
// import / inline the same sign-in steps board.spec.ts uses

test("board paints from cache before a slow API resolves", async ({ page }) => {
  // 1) sign in (same as board.spec.ts) and open the board once to seed the cache
  await page.goto("/project/BDG-H1");
  await expect(page.getByRole("heading", { name: /BDG-H1/ })).toBeVisible();

  // 2) make the board API slow, then reload
  await page.route("**/api/board/**", async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  const start = Date.now();
  await page.reload();

  // 3) cached content is visible well before the 3s API resolves
  await expect(page.getByRole("heading", { name: /BDG-H1/ })).toBeVisible({ timeout: 1200 });
  expect(Date.now() - start).toBeLessThan(2500);
});
```
> Replace `BDG-H1` with whatever project the e2e seed/login flow guarantees. If the heading selector differs, match the board header from `project/[slug]/page.tsx`.

- [ ] **Step 2: Run it**

Run: `pnpm --filter web test:e2e tests/e2e/board-cache.spec.ts`
Expected: PASS — cached board visible under ~1.2s despite the 3s API delay.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/board-cache.spec.ts
git commit -m "test(web): e2e proof board paints from cache before API resolves"
```

### Task 9.2: Full suite + final verification

- [ ] **Step 1: Run everything**

Run:
```bash
pnpm --filter web typecheck && \
pnpm --filter web exec vitest run && \
pnpm --filter web test:e2e && \
pnpm --filter web build
```
Expected: typecheck PASS, all unit PASS, all e2e PASS, production build succeeds.

- [ ] **Step 2: Confirm the spec's success criteria**

Walk the criteria in the spec §Goal: revisit paints with no blocking request (Task 9.1 proves it); realtime + optimistic preserved (Phases 4–5, 7); first paint not regressed (RSC seed everywhere); existing specs green (Step 1). Note any gaps.

- [ ] **Step 3: Finishing the branch**

Invoke `superpowers:finishing-a-development-branch` to choose merge/PR. (Branch base is `chore/db-types-search-text`; rebase onto `main` here if that branch hasn't merged.)

---

## Self-Review notes (author)

- **Spec coverage:** region pin (0.1) ✓; deps (0.2) ✓; single RPC §2a (1.1–1.2) ✓; provider+persister+user-namespacing+buster §1/§6 (2.x) ✓; API routes §2 (3.x) ✓; SSR seed §4 (4.2, 6.1, 7.1) ✓; realtime-first §5 (4.2, 7.2) ✓; idle backoff §1 (2.3 `refetchIntervalInBackground:false`) ✓; optimistic mutations §7 (5.x, 7.2; events/members deferred with explicit scope note) ✓; logout clear §6 (8.1) ✓; testing §Testing (board-bundle, keys, persister, move-reducer, board-cache e2e) ✓.
- **Type consistency:** `Board`, `BoardBundle`, `ProjectListItem`, `CardPayload`, `applyAddCard`/`applyMoveCard`, `keys.*`, `AsyncKV`, `createKVPersister`, `makeQueryClient`/`CACHE_BUSTER`/`CACHE_MAX_AGE`, `clearIdbCache` are defined once and referenced consistently.
- **Known judgement calls flagged in-plan:** RPC typed via local cast unless types regenerated (1.2/1.3); events/members optimistic deferred (7.2 note); card cache covers dynamic sections only (7.1).
