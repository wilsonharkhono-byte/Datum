# Mobile Foundation 1 — `@datum/core` Package & Demonstrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new isomorphic `@datum/core` workspace package and prove the strangler seam end-to-end by moving query/realtime/auth/projects logic out of `apps/web/lib`, repointing web at core, and keeping web fully green.

**Architecture:** `@datum/core` is a plain-TS package (built with tsup to ESM + d.ts so React Native's Metro can consume it). Every data-access export takes an injected `SupabaseClient<Database>` and imports nothing from `next/*`, `server-only`, `react`, `react-native`, or `expo*`. Web's old `lib/*` modules become thin re-exports (queries) or thin wrappers (modules that self-instantiated a client or read framework env). A guard test enforces the import ban.

**Tech Stack:** TypeScript, tsup, vitest, `@supabase/supabase-js`, `@tanstack/react-query` (peer), pnpm workspaces, Turbo.

**Reference spec:** `docs/superpowers/specs/2026-06-20-mobile-foundation-design.md` (§3, §5, §7, §10).

**Conventions for every task:** run commands from the repo root `/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain`. After each web repoint, `pnpm --filter web typecheck` and `pnpm --filter web test` MUST stay green. Commit after each task.

---

## File structure (created/modified by this plan)

**Created — `packages/core/`:**
- `package.json` — package manifest (`@datum/core`, tsup build)
- `tsconfig.json` — extends root base
- `tsup.config.ts` — ESM + dts build
- `vitest.config.ts` — node test runner
- `src/index.ts` — public barrel
- `src/client.ts` — `DatumClient` type alias
- `src/query/keys.ts`, `src/query/persister.ts`, `src/query/client.ts` — moved verbatim
- `src/realtime/project.ts`, `src/realtime/notifications.ts` — moved, client-injected
- `src/auth/current-staff.ts` — unified `getCurrentStaff` + `getCurrentStaffRow` + `canManageAccess`
- `src/projects/cover.ts`, `src/projects/list.ts` — demonstrator (cover takes `baseUrl`)
- `src/__guards__/no-forbidden-imports.test.ts` — enforces the import ban
- `src/query/keys.test.ts`, `src/query/persister.test.ts`, `src/realtime/project.test.ts`, `src/realtime/notifications.test.ts`, `src/auth/current-staff.test.ts`, `src/projects/list.test.ts` — unit tests

**Modified — repoints (web stays byte-compatible at its public API):**
- `tsconfig.base.json` — add `@datum/core` path aliases
- `apps/web/package.json` — add `"@datum/core": "workspace:*"`
- `apps/web/lib/query/{keys,persister,client}.ts` — re-export from core
- `apps/web/lib/cards/realtime.ts`, `apps/web/lib/notifications/realtime.ts` — wrap core (inject browser client)
- `apps/web/lib/auth/require-role.ts`, `apps/web/lib/auth/get-current-user.ts` — wrap core (inject server client)
- `apps/web/lib/projects/cover.ts`, `apps/web/lib/projects/queries.ts` — wrap core (inject `NEXT_PUBLIC_SUPABASE_URL`)

---

## Task 1: Scaffold the `@datum/core` package + wiring

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsup.config.ts`, `packages/core/vitest.config.ts`, `packages/core/src/client.ts`, `packages/core/src/index.ts`
- Modify: `tsconfig.base.json`, `apps/web/package.json`

- [ ] **Step 1: Create `packages/core/package.json`**

```jsonc
{
  "name": "@datum/core",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'lint via guard test'",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@datum/db": "workspace:*",
    "@datum/types": "workspace:*",
    "@supabase/supabase-js": "^2.106.2"
  },
  "peerDependencies": {
    "@tanstack/react-query": ">=5",
    "@tanstack/react-query-persist-client": ">=5"
  },
  "peerDependenciesMeta": {
    "@tanstack/react-query": { "optional": true },
    "@tanstack/react-query-persist-client": { "optional": true }
  },
  "devDependencies": {
    "@tanstack/react-query": "^5.101.0",
    "@tanstack/react-query-persist-client": "^5.101.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.7"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/core/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 4: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `packages/core/src/client.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

/** The single Supabase client type every core data-access function accepts.
    Web injects its server/browser client; mobile injects its anon client. */
export type DatumClient = SupabaseClient<Database>;
```

- [ ] **Step 6: Create `packages/core/src/index.ts` (barrel — grows as later tasks add modules)**

```ts
export type { DatumClient } from "./client";
```

- [ ] **Step 7: Add core path aliases to `tsconfig.base.json`**

In the `paths` object, alongside the existing `@datum/db` entries, add:

```jsonc
      "@datum/core": ["./packages/core/src"],
      "@datum/core/*": ["./packages/core/src/*"],
```

- [ ] **Step 8: Add the workspace dependency to `apps/web/package.json`**

In `dependencies`, alongside `"@datum/db": "workspace:*"`, add:

```jsonc
    "@datum/core": "workspace:*",
```

- [ ] **Step 9: Install + build**

Run: `pnpm install`
Then: `pnpm --filter @datum/core build`
Expected: install succeeds; build emits `packages/core/dist/index.js` and `packages/core/dist/index.d.ts` with exit 0.

- [ ] **Step 10: Verify the package typechecks**

Run: `pnpm --filter @datum/core typecheck`
Expected: exit 0, no errors.

- [ ] **Step 11: Commit**

```bash
git add packages/core tsconfig.base.json apps/web/package.json pnpm-lock.yaml
git commit -m "feat(core): scaffold @datum/core package + wiring"
```

---

## Task 2: Add the forbidden-imports guard test

**Files:**
- Create: `packages/core/src/__guards__/no-forbidden-imports.test.ts`

- [ ] **Step 1: Write the guard test**

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const BANNED = [
  /from\s+["']server-only["']/,
  /from\s+["']next(\/|["'])/,
  /from\s+["']react(\/|["'])/,
  /from\s+["']react-dom(\/|["'])/,
  /from\s+["']react-native(\/|["'])/,
  /from\s+["']expo(\b|\/)/,
  /import\s+["']server-only["']/,
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("@datum/core import hygiene", () => {
  it("never imports next/server-only/react/react-native/expo", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const re of BANNED) {
        if (re.test(text)) offenders.push(`${file} matched ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it passes (only `client.ts` exists so far)**

Run: `pnpm --filter @datum/core test`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__guards__/no-forbidden-imports.test.ts
git commit -m "test(core): ban next/server-only/react/native/expo imports"
```

---

## Task 3: Move the query/* modules (keys, persister, client) + repoint web

**Files:**
- Create: `packages/core/src/query/keys.ts`, `packages/core/src/query/persister.ts`, `packages/core/src/query/client.ts`, `packages/core/src/query/keys.test.ts`, `packages/core/src/query/persister.test.ts`
- Modify: `packages/core/src/index.ts`, `apps/web/lib/query/keys.ts`, `apps/web/lib/query/persister.ts`, `apps/web/lib/query/client.ts`

- [ ] **Step 1: Write failing tests for keys + persister**

`packages/core/src/query/keys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { keys, PERSISTED_KEY_ROOTS } from "./keys";

describe("query keys", () => {
  it("builds exact tuples", () => {
    expect(keys.board("ARIN-1")).toEqual(["board", "ARIN-1"]);
    expect(keys.projects()).toEqual(["projects"]);
    expect(keys.card("ARIN-1", "kitchen")).toEqual(["card", "ARIN-1", "kitchen"]);
  });
  it("declares the persisted roots", () => {
    expect(PERSISTED_KEY_ROOTS).toEqual(["board", "projects", "card"]);
  });
});
```

`packages/core/src/query/persister.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createKVPersister, type AsyncKV } from "./persister";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

function memoryKV(): AsyncKV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: async (k) => store.get(k) ?? null,
    setItem: async (k, v) => void store.set(k, v),
    removeItem: async (k) => void store.delete(k),
  };
}

const sample = { clientState: { queries: [], mutations: [] }, timestamp: 1, buster: "v1" } as unknown as PersistedClient;

describe("createKVPersister", () => {
  it("round-trips a persisted client through the injected store", async () => {
    const kv = memoryKV();
    const p = createKVPersister(kv, "datum.rq.user1");
    await p.persistClient(sample);
    expect(kv.store.has("datum.rq.user1")).toBe(true);
    const restored = await p.restoreClient();
    expect(restored).toEqual(sample);
    await p.removeClient();
    expect(await p.restoreClient()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @datum/core test`
Expected: FAIL — cannot find `./keys` / `./persister`.

- [ ] **Step 3: Create the three moved modules (verbatim copies of the web originals)**

`packages/core/src/query/keys.ts`:

```ts
export const keys = {
  board: (code: string) => ["board", code] as const,
  projects: () => ["projects"] as const,
  card: (code: string, slug: string) => ["card", code, slug] as const,
};

export const PERSISTED_KEY_ROOTS = ["board", "projects", "card"] as const;
```

`packages/core/src/query/persister.ts`:

```ts
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

export type AsyncKV = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** A react-query persister backed by any async key-value store. The store is
    injected so the production store and tests share one code path. */
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

`packages/core/src/query/client.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";

/** Bump when the persisted cache shape changes so stale cached data is dropped. */
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
        refetchIntervalInBackground: false,
        retry: 1,
      },
    },
  });
}
```

- [ ] **Step 4: Export them from the barrel**

Replace `packages/core/src/index.ts` contents with:

```ts
export type { DatumClient } from "./client";

export { keys, PERSISTED_KEY_ROOTS } from "./query/keys";
export { createKVPersister, type AsyncKV } from "./query/persister";
export { makeQueryClient, CACHE_BUSTER, CACHE_MAX_AGE } from "./query/client";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @datum/core test`
Expected: PASS (guard + keys + persister).

- [ ] **Step 6: Repoint web — replace the three web files with re-exports**

`apps/web/lib/query/keys.ts`:

```ts
export { keys, PERSISTED_KEY_ROOTS } from "@datum/core";
```

`apps/web/lib/query/persister.ts`:

```ts
export { createKVPersister, type AsyncKV } from "@datum/core";
```

`apps/web/lib/query/client.ts`:

```ts
export { makeQueryClient, CACHE_BUSTER, CACHE_MAX_AGE } from "@datum/core";
```

- [ ] **Step 7: Rebuild core (web imports the built dist) and verify web stays green**

Run: `pnpm --filter @datum/core build`
Then: `pnpm --filter web typecheck`
Then: `pnpm --filter web test`
Expected: typecheck exit 0; all web tests pass (incl. `tests/unit/query-keys.test.ts` and `query-persister.test.ts`, which now import through the re-export unchanged).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src apps/web/lib/query
git commit -m "refactor(core): move react-query keys/persister/client into @datum/core"
```

---

## Task 4: Move the realtime modules (client-injected) + repoint web

**Files:**
- Create: `packages/core/src/realtime/project.ts`, `packages/core/src/realtime/notifications.ts`, `packages/core/src/realtime/project.test.ts`, `packages/core/src/realtime/notifications.test.ts`
- Modify: `packages/core/src/index.ts`, `apps/web/lib/cards/realtime.ts`, `apps/web/lib/notifications/realtime.ts`

- [ ] **Step 1: Write failing tests (mock Supabase channel)**

`packages/core/src/realtime/project.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subscribeToProjectChanges } from "./project";
import type { DatumClient } from "../client";

type Handler = () => void;

function mockClient() {
  const registrations: { table: string; event: string; filter: string }[] = [];
  const handlers: Handler[] = [];
  const removeChannel = vi.fn();
  const channel = {
    on(_type: string, cfg: { table: string; event: string; filter: string }, h: Handler) {
      registrations.push({ table: cfg.table, event: cfg.event, filter: cfg.filter });
      handlers.push(h);
      return channel;
    },
    subscribe() { return channel; },
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel,
  } as unknown as DatumClient;
  return { client, registrations, handlers, removeChannel, channelFn: client.channel };
}

describe("subscribeToProjectChanges", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens one channel and registers 4 filtered listeners", () => {
    const { client, registrations } = mockClient();
    subscribeToProjectChanges(client, "P1", () => {});
    expect((client.channel as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("project:P1");
    expect(registrations.map((r) => r.table)).toEqual(["cards", "card_events", "card_comments", "topics"]);
    expect(registrations.every((r) => r.filter === "project_id=eq.P1")).toBe(true);
  });

  it("debounces onChange by 250ms", () => {
    const { client, handlers } = mockClient();
    const onChange = vi.fn();
    subscribeToProjectChanges(client, "P1", onChange);
    handlers[0]!(); // cards change
    handlers[0]!(); // rapid second change
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ kind: "card" });
  });

  it("cleanup removes the channel", () => {
    const { client, removeChannel } = mockClient();
    const stop = subscribeToProjectChanges(client, "P1", () => {});
    stop();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
```

`packages/core/src/realtime/notifications.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { subscribeToOwnNotifications } from "./notifications";
import type { DatumClient } from "../client";

function mockClient() {
  const regs: { event: string; filter: string }[] = [];
  const handlers: (() => void)[] = [];
  const removeChannel = vi.fn();
  const channel = {
    on(_t: string, cfg: { event: string; filter: string }, h: () => void) {
      regs.push({ event: cfg.event, filter: cfg.filter });
      handlers.push(h);
      return channel;
    },
    subscribe() { return channel; },
  };
  const client = { channel: vi.fn(() => channel), removeChannel } as unknown as DatumClient;
  return { client, regs, handlers, removeChannel };
}

describe("subscribeToOwnNotifications", () => {
  it("registers INSERT + UPDATE on the recipient filter and reports deltas", () => {
    const { client, regs, handlers } = mockClient();
    const onDelta = vi.fn();
    subscribeToOwnNotifications(client, "S1", onDelta);
    expect((client.channel as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("notifications:S1");
    expect(regs).toEqual([
      { event: "INSERT", filter: "recipient_staff_id=eq.S1" },
      { event: "UPDATE", filter: "recipient_staff_id=eq.S1" },
    ]);
    handlers[0]!();
    handlers[1]!();
    expect(onDelta).toHaveBeenNthCalledWith(1, { kind: "insert" });
    expect(onDelta).toHaveBeenNthCalledWith(2, { kind: "refresh" });
  });

  it("cleanup removes the channel", () => {
    const { client, removeChannel } = mockClient();
    subscribeToOwnNotifications(client, "S1", () => {})();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @datum/core test`
Expected: FAIL — cannot find `./project` / `./notifications`.

- [ ] **Step 3: Create the moved, client-injected modules**

`packages/core/src/realtime/project.ts` (note: `setTimeout`/`clearTimeout`, not `window.*`, so it runs in React Native):

```ts
import type { DatumClient } from "../client";

export type CardsChange = { kind: "card" | "event" | "comment" | "topic" };

/** Subscribe to changes on cards/card_events/card_comments/topics for one
    project. onChange fires after a 250ms debounce. Returns an unsubscribe.
    The Supabase client is injected so this is usable from web and React Native. */
export function subscribeToProjectChanges(
  supabase: DatumClient,
  projectId: string,
  onChange: (c: CardsChange) => void,
): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null;
  function emit(kind: CardsChange["kind"]) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => onChange({ kind }), 250);
  }
  const channel = supabase
    .channel(`project:${projectId}`)
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "cards", filter: `project_id=eq.${projectId}` },
      () => emit("card"),
    )
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "card_events", filter: `project_id=eq.${projectId}` },
      () => emit("event"),
    )
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "card_comments", filter: `project_id=eq.${projectId}` },
      () => emit("comment"),
    )
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "topics", filter: `project_id=eq.${projectId}` },
      () => emit("topic"),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
```

`packages/core/src/realtime/notifications.ts`:

```ts
import type { DatumClient } from "../client";

export type UnreadDelta = { kind: "insert" } | { kind: "refresh" };

/** Subscribe to notification inserts/updates for one staff member. Returns an
    unsubscribe. The Supabase client is injected (web + React Native). */
export function subscribeToOwnNotifications(
  supabase: DatumClient,
  staffId: string,
  onDelta: (d: UnreadDelta) => void,
): () => void {
  const channel = supabase
    .channel(`notifications:${staffId}`)
    .on(
      "postgres_changes" as never,
      { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_staff_id=eq.${staffId}` },
      () => onDelta({ kind: "insert" }),
    )
    .on(
      "postgres_changes" as never,
      { event: "UPDATE", schema: "public", table: "notifications", filter: `recipient_staff_id=eq.${staffId}` },
      () => onDelta({ kind: "refresh" }),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
```

- [ ] **Step 4: Export from the barrel** (append to `packages/core/src/index.ts`)

```ts
export { subscribeToProjectChanges, type CardsChange } from "./realtime/project";
export { subscribeToOwnNotifications, type UnreadDelta } from "./realtime/notifications";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @datum/core test`
Expected: PASS (all realtime tests + earlier tests).

- [ ] **Step 6: Repoint web — wrappers that inject the browser client**

`apps/web/lib/cards/realtime.ts`:

```ts
"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { subscribeToProjectChanges as core, type CardsChange } from "@datum/core";

export type { CardsChange };

export function subscribeToProjectChanges(
  projectId: string,
  onChange: (c: CardsChange) => void,
): () => void {
  return core(createSupabaseBrowserClient(), projectId, onChange);
}
```

`apps/web/lib/notifications/realtime.ts`:

```ts
"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { subscribeToOwnNotifications as core, type UnreadDelta } from "@datum/core";

export type { UnreadDelta };

export function subscribeToOwnNotifications(
  staffId: string,
  onDelta: (d: UnreadDelta) => void,
): () => void {
  return core(createSupabaseBrowserClient(), staffId, onDelta);
}
```

- [ ] **Step 7: Rebuild core + verify web green**

Run: `pnpm --filter @datum/core build`
Then: `pnpm --filter web typecheck`
Then: `pnpm --filter web test`
Expected: exit 0; web tests pass (incl. `tests/unit/realtime.test.ts`, which calls the web wrapper unchanged).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src apps/web/lib/cards/realtime.ts apps/web/lib/notifications/realtime.ts
git commit -m "refactor(core): move realtime subscriptions into @datum/core (client-injected)"
```

---

## Task 5: Move + unify the auth helpers + repoint web

**Files:**
- Create: `packages/core/src/auth/current-staff.ts`, `packages/core/src/auth/current-staff.test.ts`
- Modify: `packages/core/src/index.ts`, `apps/web/lib/auth/require-role.ts`, `apps/web/lib/auth/get-current-user.ts`

- [ ] **Step 1: Write failing tests**

`packages/core/src/auth/current-staff.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getCurrentStaff, canManageAccess, type CurrentStaff } from "./current-staff";
import type { DatumClient } from "../client";

function clientWith(user: { id: string } | null, staffRow: Record<string, unknown> | null) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: staffRow, error: null }),
          single: async () => ({ data: staffRow, error: null }),
        }),
      }),
    })),
  } as unknown as DatumClient;
}

describe("getCurrentStaff", () => {
  it("returns null when unauthenticated", async () => {
    expect(await getCurrentStaff(clientWith(null, null))).toBeNull();
  });
  it("returns null when the auth user has no staff row (orphan)", async () => {
    expect(await getCurrentStaff(clientWith({ id: "u1" }, null))).toBeNull();
  });
  it("maps a trimmed CurrentStaff", async () => {
    const staff = await getCurrentStaff(
      clientWith({ id: "u1" }, { id: "u1", full_name: "Wilson", role: "principal", email: "w@x.co" }),
    );
    expect(staff).toEqual({ id: "u1", full_name: "Wilson", role: "principal", email: "w@x.co" });
  });
});

describe("canManageAccess", () => {
  const base: CurrentStaff = { id: "u1", full_name: "X", role: "designer", email: null };
  it("is true for principal and admin only", () => {
    expect(canManageAccess(null)).toBe(false);
    expect(canManageAccess({ ...base, role: "designer" })).toBe(false);
    expect(canManageAccess({ ...base, role: "pic" })).toBe(false);
    expect(canManageAccess({ ...base, role: "site_supervisor" })).toBe(false);
    expect(canManageAccess({ ...base, role: "estimator" })).toBe(false);
    expect(canManageAccess({ ...base, role: "principal" })).toBe(true);
    expect(canManageAccess({ ...base, role: "admin" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @datum/core test`
Expected: FAIL — cannot find `./current-staff`.

- [ ] **Step 3: Create `packages/core/src/auth/current-staff.ts`**

```ts
import type { DatumClient } from "../client";
import type { Staff } from "@datum/db";

export type StaffRole =
  | "principal"
  | "designer"
  | "pic"
  | "site_supervisor"
  | "admin"
  | "estimator";

export type CurrentStaff = {
  id: string;
  full_name: string;
  role: StaffRole;
  email: string | null;
};

/** Trimmed current-staff shape (the `require-role` flavor). Null when not
    signed in or no staff row exists yet (orphan auth user). */
export async function getCurrentStaff(supabase: DatumClient): Promise<CurrentStaff | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("staff")
    .select("id, full_name, role, email")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    full_name: data.full_name,
    role: data.role as StaffRole,
    email: data.email,
  };
}

/** Full staff row (the `get-current-user` flavor). */
export async function getCurrentStaffRow(supabase: DatumClient): Promise<Staff | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("staff").select("*").eq("id", user.id).single();
  return data ?? null;
}

/** True when the caller may manage project access + invite new staff. */
export function canManageAccess(staff: CurrentStaff | null): staff is CurrentStaff {
  if (!staff) return false;
  return staff.role === "principal" || staff.role === "admin";
}
```

- [ ] **Step 4: Export from the barrel** (append to `packages/core/src/index.ts`)

```ts
export {
  getCurrentStaff,
  getCurrentStaffRow,
  canManageAccess,
  type StaffRole,
  type CurrentStaff,
} from "./auth/current-staff";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @datum/core test`
Expected: PASS.

- [ ] **Step 6: Repoint web — wrappers that inject the server client**

`apps/web/lib/auth/require-role.ts`:

```ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff as coreGetCurrentStaff } from "@datum/core";

export type { StaffRole, CurrentStaff } from "@datum/core";
export { canManageAccess } from "@datum/core";

/**
 * Loads the current staff row for the signed-in user. Returns null if the
 * caller is not signed in or has no staff row yet (edge: orphan auth user).
 */
export async function getCurrentStaff() {
  const supabase = await createSupabaseServerClient();
  return coreGetCurrentStaff(supabase);
}
```

`apps/web/lib/auth/get-current-user.ts`:

```ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaffRow } from "@datum/core";
import type { Staff } from "@datum/db";

export async function getCurrentStaff(): Promise<Staff | null> {
  const supabase = await createSupabaseServerClient();
  return getCurrentStaffRow(supabase);
}
```

- [ ] **Step 7: Rebuild core + verify web green (both call sites)**

Run: `pnpm --filter @datum/core build`
Then: `pnpm --filter web typecheck`
Then: `pnpm --filter web test`
Expected: exit 0. (`(app)/layout.tsx` uses `require-role`'s `getCurrentStaff`; other call sites use `get-current-user`'s — both keep their original return shapes.)

- [ ] **Step 8: Commit**

```bash
git add packages/core/src apps/web/lib/auth
git commit -m "refactor(core): unify getCurrentStaff/canManageAccess in @datum/core"
```

---

## Task 6: Demonstrator — move projects list/cover (cover takes baseUrl) + repoint web

**Files:**
- Create: `packages/core/src/projects/cover.ts`, `packages/core/src/projects/list.ts`, `packages/core/src/projects/list.test.ts`
- Modify: `packages/core/src/index.ts`, `apps/web/lib/projects/cover.ts`, `apps/web/lib/projects/queries.ts`

- [ ] **Step 1: Write failing tests**

`packages/core/src/projects/list.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { coverImageUrl } from "./cover";
import { getProjectsList, getDevelopments } from "./list";
import type { DatumClient } from "../client";

describe("coverImageUrl", () => {
  it("returns null for empty paths", () => {
    expect(coverImageUrl(null, "https://x.co")).toBeNull();
    expect(coverImageUrl(undefined, "https://x.co")).toBeNull();
    expect(coverImageUrl("", "https://x.co")).toBeNull();
  });
  it("builds an encoded public URL from the injected base", () => {
    expect(coverImageUrl("a b/c.png", "https://x.co")).toBe(
      "https://x.co/storage/v1/object/public/project-covers/a%20b/c.png",
    );
  });
});

function listClient(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      select: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
    })),
  } as unknown as DatumClient;
}

function developmentsClient(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      select: () => ({ order: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
    })),
  } as unknown as DatumClient;
}

describe("getProjectsList", () => {
  it("maps rows and resolves development + cover_url", async () => {
    const rows = [
      {
        id: "p1", project_code: "ARIN-1", project_name: "Karawang",
        client_name: "Nabil", location: "Karawang", status: "active",
        target_handover: null, development_id: "d1", cover_image_path: "x/y.png",
        developments: { name: "Citraland", area_label: "West", sort_order: 2 },
      },
    ];
    const out = await getProjectsList(listClient(rows), "https://x.co");
    expect(out[0]!.development_name).toBe("Citraland");
    expect(out[0]!.development_sort_order).toBe(2);
    expect(out[0]!.cover_url).toBe("https://x.co/storage/v1/object/public/project-covers/x/y.png");
  });
});

describe("getDevelopments", () => {
  it("returns rows verbatim", async () => {
    const rows = [{ id: "d1", name: "Citraland", area_label: "West", sort_order: 1 }];
    expect(await getDevelopments(developmentsClient(rows))).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @datum/core test`
Expected: FAIL — cannot find `./cover` / `./list`.

- [ ] **Step 3: Create `packages/core/src/projects/cover.ts`**

```ts
/** Build the public Supabase Storage URL for a project cover. The storage base
    URL is injected (web: NEXT_PUBLIC_SUPABASE_URL, mobile: EXPO_PUBLIC_SUPABASE_URL)
    so this stays free of framework-specific env access. */
export function coverImageUrl(path: string | null | undefined, baseUrl: string): string | null {
  if (!path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/storage/v1/object/public/project-covers/${encoded}`;
}
```

- [ ] **Step 4: Create `packages/core/src/projects/list.ts`**

```ts
import type { DatumClient } from "../client";
import { coverImageUrl } from "./cover";

export type ProjectListItem = {
  id: string; project_code: string; project_name: string;
  client_name: string | null; location: string | null;
  status: string; target_handover: string | null;
  development_id: string | null;
  development_name: string | null;
  development_area_label: string | null;
  development_sort_order: number | null;
  cover_image_path: string | null;
  cover_url: string | null;
};

export type DevelopmentOption = {
  id: string; name: string; area_label: string | null; sort_order: number;
};

type Row = {
  id: string; project_code: string; project_name: string;
  client_name: string | null; location: string | null;
  status: string; target_handover: string | null;
  development_id: string | null; cover_image_path: string | null;
  developments: { name: string; area_label: string | null; sort_order: number } | null;
};

export async function getProjectsList(
  supabase: DatumClient,
  coverBaseUrl: string,
): Promise<ProjectListItem[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, project_code, project_name, client_name, location, status, target_handover, development_id, cover_image_path, developments:development_id (name, area_label, sort_order)",
    )
    .order("project_code");
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    project_code: r.project_code,
    project_name: r.project_name,
    client_name: r.client_name,
    location: r.location,
    status: r.status,
    target_handover: r.target_handover,
    development_id: r.development_id,
    development_name: r.developments?.name ?? null,
    development_area_label: r.developments?.area_label ?? null,
    development_sort_order: r.developments?.sort_order ?? null,
    cover_image_path: r.cover_image_path,
    cover_url: coverImageUrl(r.cover_image_path, coverBaseUrl),
  }));
}

export async function getDevelopments(
  supabase: DatumClient,
): Promise<DevelopmentOption[]> {
  const { data, error } = await supabase
    .from("developments")
    .select("id, name, area_label, sort_order")
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []) as DevelopmentOption[];
}
```

- [ ] **Step 5: Export from the barrel** (append to `packages/core/src/index.ts`)

```ts
export { coverImageUrl } from "./projects/cover";
export {
  getProjectsList,
  getDevelopments,
  type ProjectListItem,
  type DevelopmentOption,
} from "./projects/list";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @datum/core test`
Expected: PASS (all core tests).

- [ ] **Step 7: Repoint web — wrappers that inject `NEXT_PUBLIC_SUPABASE_URL`**

`apps/web/lib/projects/cover.ts`:

```ts
import { coverImageUrl as coreCoverImageUrl } from "@datum/core";

export function coverImageUrl(path: string | null | undefined): string | null {
  return coreCoverImageUrl(path, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}
```

`apps/web/lib/projects/queries.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getProjectsList as coreGetProjectsList, getDevelopments } from "@datum/core";

export type { ProjectListItem, DevelopmentOption } from "@datum/core";

export function getProjectsList(supabase: SupabaseClient<Database>) {
  return coreGetProjectsList(supabase, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}

export { getDevelopments };
```

- [ ] **Step 8: Rebuild core + verify web green**

Run: `pnpm --filter @datum/core build`
Then: `pnpm --filter web typecheck`
Then: `pnpm --filter web test`
Expected: exit 0; the `/api/projects` route and `(app)/page.tsx` still import `getProjectsList`/`getDevelopments`/`coverImageUrl` from `@/lib/projects/*` unchanged and behave identically.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src apps/web/lib/projects
git commit -m "refactor(core): demonstrator — move projects list/cover into @datum/core"
```

---

## Task 7: Whole-repo verification gate

**Files:** none (verification only)

- [ ] **Step 1: Build core, then run the full monorepo gates via Turbo**

Run: `pnpm --filter @datum/core build`
Then: `pnpm typecheck`
Then: `pnpm test`
Expected: Turbo fans out; `@datum/core` builds first (it's now a dependency, `dependsOn: ["^build"]`), then web + db + core all typecheck and test green. Core tests run automatically (root `test` includes the new package).

- [ ] **Step 2: Confirm the import guard is enforced**

Run: `pnpm --filter @datum/core test`
Expected: the `import hygiene` test passes — core has zero `next`/`server-only`/`react`/`react-native`/`expo` imports.

- [ ] **Step 3: Final commit (if any uncommitted verification artifacts)**

```bash
git status --porcelain   # expect clean
```

---

## Self-Review (against the spec)

- **Spec §3.1/§3.5 package layout & wiring** → Task 1 (package.json, tsconfig, tsup, vitest, aliases, web dep). ✓
- **Spec §3.2 query/* + realtime + auth + projects signatures** → Tasks 3–6, with the two intended behavior changes recorded: realtime takes an injected client and uses `setTimeout` (RN-safe), and `coverImageUrl`/`getProjectsList` take an explicit `baseUrl`/`coverBaseUrl` (resolves open question §11.2 — `cover.ts` reads `NEXT_PUBLIC_SUPABASE_URL`). ✓
- **Spec §3.3/§3.4 strangler recipe + demonstrator** → Tasks 3–6 each do move → repoint → verify; Task 6 is the projects demonstrator. ✓
- **Spec §3.4 web repoints keep call sites unchanged** → web `queries.ts`/`cover.ts`/`require-role.ts`/`get-current-user.ts` wrappers preserve the original public signatures, so `/api/projects`, `(app)/page.tsx`, and `(app)/layout.tsx` need no edits. ✓
- **Spec §9 / open question §11.3 unify two getCurrentStaff** → Task 5 keeps both shapes (`getCurrentStaff`→`CurrentStaff`, `getCurrentStaffRow`→`Staff`). ✓
- **Spec §10 testing (keys, persister, realtime channel+debounce+removeChannel, projects mapping, canManageAccess truth table) + import ban** → Tasks 2–6 tests. ✓
- **Spec §10 CI** → no CI file change needed for core: root `pnpm typecheck`/`pnpm test` already fan out via Turbo once core exposes the scripts (Task 1) and is a dependency; verified in Task 7. (Mobile-specific CI lands in Foundation-2.) ✓
- **Out of scope here (deferred to Foundation-2):** NativeWind/tokens, the react-query Provider + AsyncStorage KV + session context + onlineManager, the Expo Router IA skeleton, mobile consuming `getProjectsList`, and the mobile lint CI step. The `makeQueryClient`/persister/keys are *available* from core now; Foundation-2 wires them into the app.

**Open question §11.1 (Metro config) and §11.4/§11.5 (react-query peer version, NativeWind version)** are deferred to Foundation-2, where the mobile app actually consumes the package — this plan only requires core to *build* a `dist/`, which Task 1 verifies.
