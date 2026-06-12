# Bulk Trello Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull every in-scope WHA Studio Trello board through the connected Composio Trello toolkit and import each as a DATUM project, reusing the existing idempotent card/event/comment importer, and make imported projects searchable by name or client.

**Architecture:** Two phases. **Fetch** is agent-driven (Composio MCP is only callable by the agent): subagents fetch raw board JSON and dump it to `assets/Trello/.raw/`. A tested `normalize-raw.ts` converts raw boards into the legacy `TrelloBoard` JSON shape (plus a `_meta` block). **Import** is script-driven: an extended `import-trello.ts` auto-discovers those files, auto-creates a project per board (keyed on a new `projects.trello_board_id` column), and runs the existing import logic unchanged.

**Tech Stack:** TypeScript, `tsx`, Supabase JS (service role), PostgreSQL migrations (`supabase db push`), Vitest, Next.js App Router (search UI), Composio Trello MCP toolkit.

**Spec:** [docs/superpowers/specs/2026-06-12-bulk-trello-import-design.md](../specs/2026-06-12-bulk-trello-import-design.md)

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/supabase/migrations/20260612000002_projects_trello_board_id.sql` | Add `projects.trello_board_id` (unique, nullable); backfill the 2 pilot projects. |
| `packages/db/vitest.config.ts` | Vitest config for the db package (unit tests for pure libs). |
| `packages/db/scripts/lib/trello-normalize.ts` | Pure logic: scope/code/name/client derivation + raw→`TrelloBoard` normalization. |
| `packages/db/scripts/lib/select-boards.ts` | Pure logic: which boards are in scope. |
| `packages/db/scripts/lib/__tests__/trello-normalize.test.ts` | Unit tests for derivation + normalization. |
| `packages/db/scripts/lib/__tests__/select-boards.test.ts` | Unit tests for selection. |
| `packages/db/scripts/normalize-raw.ts` | Reads `assets/Trello/.raw/*.json`, writes normalized `assets/Trello/<name>/<shortLink>.json`. |
| `packages/db/scripts/import-trello.ts` | **Modify**: auto-discovery + `ensureProject` auto-create; existing import logic preserved. |
| `apps/web/lib/search/queries.ts` | **Modify**: add a `projects` result group (ilike on name/client/site + alias contains). |
| `apps/web/tests/unit/search-queries.test.ts` | Unit test for project search. |
| `apps/web/app/(app)/search/page.tsx` | **Modify**: render the Proyek result group. |

**Naming contract (used across tasks):**
- `Scope = "arin" | "arch" | "intr" | "wha"`
- `ProjectMeta = { scope: Scope; project_code: string; project_name: string; client_name: string | null; site_address: string | null; search_aliases: string[] }`
- `NormalizedBoard = { _meta: { trello_board_id: string; short_link: string; board_name: string } & ProjectMeta; lists: unknown[]; cards: unknown[]; actions: unknown[]; checklists: unknown[] }`
- Functions: `deriveScope(boardName)`, `deriveProjectMeta(boardName)`, `normalizeBoard(raw)`, `isInScope(board)`.

---

## Task 1: Migration — add `trello_board_id` and backfill pilots

**Files:**
- Create: `packages/db/supabase/migrations/20260612000002_projects_trello_board_id.sql`
- Modify (generated): `packages/db/src/types.generated.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 20260612000002_projects_trello_board_id.sql
-- Bulk Trello import: stable idempotency key linking a DATUM project to its Trello board.

begin;

alter table public.projects
  add column if not exists trello_board_id text;

create unique index if not exists projects_trello_board_id_key
  on public.projects (trello_board_id)
  where trello_board_id is not null;

-- Backfill the two pilot projects so re-importing their boards reuses the existing rows
-- instead of creating duplicates.
update public.projects set trello_board_id = '665e984287e87d6665545a17'
  where project_code = 'BDG-H1' and trello_board_id is null;
update public.projects set trello_board_id = '66ce848cf20cce1ccc3cea20'
  where project_code = 'PKW-PC1012' and trello_board_id is null;

commit;
```

- [ ] **Step 2: Push the migration to the linked Supabase project**

Run: `pnpm --filter @datum/db migrate`
Expected: `supabase db push` applies `20260612000002_projects_trello_board_id.sql` with no errors.

> NOTE: The Supabase project is LIVE and linked. Use `db push` only — never `db reset`.

- [ ] **Step 3: Regenerate TypeScript types**

Run: `pnpm --filter @datum/db types`
Expected: `packages/db/src/types.generated.ts` now includes `trello_board_id: string | null` on `projects` Row/Insert/Update.

- [ ] **Step 4: Verify the column and backfill**

Run:
```bash
cd "packages/db" && npx tsx -e "
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env') });
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await a.from('projects').select('project_code, trello_board_id').not('trello_board_id','is',null);
console.log(data);
"
```
Expected: prints `BDG-H1 → 665e98...` and `PKW-PC1012 → 66ce84...`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/20260612000002_projects_trello_board_id.sql packages/db/src/types.generated.ts
git commit -m "feat(db): add projects.trello_board_id for Trello import idempotency"
```

---

## Task 2: Vitest setup for the db package

**Files:**
- Create: `packages/db/vitest.config.ts`
- Modify: `packages/db/package.json`

- [ ] **Step 1: Add the vitest config**

```ts
// packages/db/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 2: Add a test script and vitest devDependency**

In `packages/db/package.json`, add to `"scripts"`:
```json
    "test": "vitest run",
```
and to `"devDependencies"`:
```json
    "vitest": "^2.1.0",
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: vitest resolved for `@datum/db` (it already exists in the workspace via apps/web).

- [ ] **Step 4: Verify the runner starts**

Run: `pnpm --filter @datum/db test`
Expected: `No test files found` (no tests yet) and exit 0 — confirms the runner is wired.

- [ ] **Step 5: Commit**

```bash
git add packages/db/vitest.config.ts packages/db/package.json
git commit -m "chore(db): add vitest for script unit tests"
```

---

## Task 3: Derivation logic (scope, code, name, client)

**Files:**
- Create: `packages/db/scripts/lib/trello-normalize.ts`
- Test: `packages/db/scripts/lib/__tests__/trello-normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/scripts/lib/__tests__/trello-normalize.test.ts
import { describe, expect, it } from "vitest";
import { deriveScope, deriveProjectMeta } from "../trello-normalize";

describe("deriveScope", () => {
  it("maps prefixes to scope", () => {
    expect(deriveScope("AR.IN - BDG H-1")).toBe("arin");
    expect(deriveScope("ARCH - BDG H-16")).toBe("arch");
    expect(deriveScope("INTR - CITRALAND M-8")).toBe("intr");
    expect(deriveScope("WHA - WORKING DRAWINGS")).toBe("wha");
  });
  it("defaults unknown prefixes to arin", () => {
    expect(deriveScope("PAKUWON AB1/28")).toBe("arin");
  });
});

describe("deriveProjectMeta", () => {
  it("splits site and client on the trailing ' - ' token", () => {
    const m = deriveProjectMeta("AR.IN - BUKIT DARMO GOLF I-23 - YENI KALIM");
    expect(m.scope).toBe("arin");
    expect(m.project_name).toBe("Bukit Darmo Golf I-23");
    expect(m.client_name).toBe("Yeni Kalim");
    expect(m.site_address).toBe("Bukit Darmo Golf I-23");
    expect(m.project_code).toBe("ARIN-BUKIT-DARMO-GOLF-I-23");
    expect(m.search_aliases).toContain("Yeni Kalim");
    expect(m.search_aliases).toContain("Bukit Darmo Golf I-23");
  });
  it("splits on the trailing underscore token", () => {
    const m = deriveProjectMeta("AR.IN - KARAWANG_NABIL");
    expect(m.project_name).toBe("Karawang");
    expect(m.client_name).toBe("Nabil");
    expect(m.project_code).toBe("ARIN-KARAWANG");
  });
  it("leaves client null when the trailing token looks like a unit", () => {
    const m = deriveProjectMeta("AR.IN - CITRALAND GA7/45");
    expect(m.client_name).toBeNull();
    expect(m.project_name).toBe("Citraland Ga7/45");
    expect(m.project_code).toBe("ARIN-CITRALAND-GA7-45");
  });
  it("keeps ARCH/INTR/WHA scope prefixes in the code", () => {
    expect(deriveProjectMeta("ARCH - BDG H-16").project_code).toBe("ARCH-BDG-H-16");
    expect(deriveProjectMeta("INTR - CITRALAND M-8").project_code).toBe("INTR-CITRALAND-M-8");
    expect(deriveProjectMeta("WHA - WORKING DRAWINGS").project_code).toBe("WHA-WORKING-DRAWINGS");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @datum/db test`
Expected: FAIL — `deriveScope`/`deriveProjectMeta` not exported.

- [ ] **Step 3: Implement the derivation logic**

```ts
// packages/db/scripts/lib/trello-normalize.ts

export type Scope = "arin" | "arch" | "intr" | "wha";

export interface ProjectMeta {
  scope: Scope;
  project_code: string;
  project_name: string;
  client_name: string | null;
  site_address: string | null;
  search_aliases: string[];
}

const PREFIX_TO_SCOPE: Array<{ re: RegExp; scope: Scope }> = [
  { re: /^AR\.?IN\b/i, scope: "arin" },
  { re: /^ARCH\b/i, scope: "arch" },
  { re: /^INTR\b/i, scope: "intr" },
  { re: /^WHA\b/i, scope: "wha" },
];

const SCOPE_TO_CODE_PREFIX: Record<Scope, string> = {
  arin: "ARIN",
  arch: "ARCH",
  intr: "INTR",
  wha: "WHA",
};

export function deriveScope(boardName: string): Scope {
  const name = boardName.trim();
  for (const { re, scope } of PREFIX_TO_SCOPE) {
    if (re.test(name)) return scope;
  }
  return "arin";
}

function stripPrefix(boardName: string): string {
  return boardName.trim().replace(/^(AR\.?IN|ARCH|INTR|WHA)\b[\s\-_:]*/i, "").trim();
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .trim();
}

// A unit/lot token contains digits or a slash (e.g. "GA7/45", "I-23", "H-16").
function looksLikeUnit(token: string): boolean {
  return /[0-9/]/.test(token);
}

function slugifyCode(site: string): string {
  return site
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34)
    .replace(/-+$/g, "");
}

export function deriveProjectMeta(boardName: string): ProjectMeta {
  const scope = deriveScope(boardName);
  const remainder = stripPrefix(boardName);

  let site = remainder;
  let client: string | null = null;

  const seps = [...remainder.matchAll(/\s+-\s+|_/g)];
  if (seps.length > 0) {
    const last = seps[seps.length - 1];
    const idx = last.index ?? 0;
    const head = remainder.slice(0, idx).trim();
    const tail = remainder.slice(idx + last[0].length).trim();
    if (head && tail && !looksLikeUnit(tail)) {
      site = head;
      client = titleCase(tail);
    }
  }

  const project_name = titleCase(site);
  const site_address = project_name || null;
  const project_code = `${SCOPE_TO_CODE_PREFIX[scope]}-${slugifyCode(site)}`.replace(/-+$/g, "");
  const search_aliases = Array.from(
    new Set([project_name, client, boardName.trim()].filter(Boolean) as string[]),
  );

  return { scope, project_code, project_name, client_name: client, site_address, search_aliases };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @datum/db test`
Expected: PASS (all derivation tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/lib/trello-normalize.ts packages/db/scripts/lib/__tests__/trello-normalize.test.ts
git commit -m "feat(db): Trello board name → project metadata derivation"
```

---

## Task 4: Raw board → `TrelloBoard` normalization

**Files:**
- Modify: `packages/db/scripts/lib/trello-normalize.ts`
- Modify: `packages/db/scripts/lib/__tests__/trello-normalize.test.ts`

- [ ] **Step 1: Add the failing normalization test**

Append to `trello-normalize.test.ts`:
```ts
import { normalizeBoard } from "../trello-normalize";

describe("normalizeBoard", () => {
  const raw = {
    id: "665e984287e87d6665545a17",
    shortLink: "QQQcBn6d",
    name: "AR.IN - BDG H-1",
    lists: [{ id: "l1", name: "A04 — Tangga", closed: false }],
    cards: [
      {
        id: "card1",
        name: "Pasang kusen",
        desc: "detail",
        idList: "l1",
        due: null,
        dueComplete: false,
        dateLastActivity: "2026-02-01T00:00:00Z",
        shortUrl: "https://trello.com/c/x",
        shortLink: "x",
        closed: false,
        attachments: [{ id: "a1", name: "foto", url: "https://img", mimeType: "image/jpeg", date: "2026-02-01T00:00:00Z" }],
        checklists: [{ id: "cl1", name: "Checklist", checkItems: [{ id: "ci1", name: "step", state: "incomplete" }] }],
      },
    ],
    actions: [
      { id: "act1", type: "commentCard", date: "2026-02-02T00:00:00Z", data: { card: { id: "card1" }, text: "hi" } },
      { id: "act2", type: "updateCard", date: "2026-02-02T00:00:00Z", data: { card: { id: "card1" } } },
    ],
  };

  it("builds _meta from the board name", () => {
    const b = normalizeBoard(raw);
    expect(b._meta.trello_board_id).toBe("665e984287e87d6665545a17");
    expect(b._meta.short_link).toBe("QQQcBn6d");
    expect(b._meta.project_code).toBe("ARIN-BDG-H-1");
  });

  it("hoists card checklists to a top-level array and sets idChecklists", () => {
    const b = normalizeBoard(raw);
    expect(b.checklists).toHaveLength(1);
    expect(b.checklists[0]).toMatchObject({ id: "cl1", idCard: "card1", name: "Checklist" });
    expect((b.cards[0] as { idChecklists: string[] }).idChecklists).toEqual(["cl1"]);
  });

  it("keeps only commentCard actions", () => {
    const b = normalizeBoard(raw);
    expect(b.actions).toHaveLength(1);
    expect((b.actions[0] as { type: string }).type).toBe("commentCard");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @datum/db test`
Expected: FAIL — `normalizeBoard` not exported.

- [ ] **Step 3: Implement `normalizeBoard`**

Append to `trello-normalize.ts`:
```ts
export interface NormalizedBoard {
  _meta: { trello_board_id: string; short_link: string; board_name: string } & ProjectMeta;
  lists: unknown[];
  cards: unknown[];
  actions: unknown[];
  checklists: unknown[];
}

interface RawCheckItem { id: string; name: string; state: string }
interface RawChecklist { id: string; name: string; checkItems?: RawCheckItem[] }
interface RawCard { id: string; checklists?: RawChecklist[]; [k: string]: unknown }
interface RawBoard {
  id: string;
  shortLink: string;
  name: string;
  lists?: unknown[];
  cards?: RawCard[];
  actions?: Array<{ type: string; [k: string]: unknown }>;
}

export function normalizeBoard(raw: RawBoard): NormalizedBoard {
  const meta = deriveProjectMeta(raw.name);
  const rawCards = raw.cards ?? [];

  const cards = rawCards.map((c) => ({
    ...c,
    idChecklists: (c.checklists ?? []).map((cl) => cl.id),
  }));

  const checklists = rawCards.flatMap((c) =>
    (c.checklists ?? []).map((cl) => ({
      id: cl.id,
      idCard: c.id,
      name: cl.name,
      checkItems: (cl.checkItems ?? []).map((it) => ({ id: it.id, name: it.name, state: it.state })),
    })),
  );

  const actions = (raw.actions ?? []).filter((a) => a.type === "commentCard");

  return {
    _meta: { trello_board_id: raw.id, short_link: raw.shortLink, board_name: raw.name, ...meta },
    lists: raw.lists ?? [],
    cards,
    actions,
    checklists,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @datum/db test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/lib/trello-normalize.ts packages/db/scripts/lib/__tests__/trello-normalize.test.ts
git commit -m "feat(db): normalize raw Trello board into importer JSON shape"
```

---

## Task 5: Board selection filter

**Files:**
- Create: `packages/db/scripts/lib/select-boards.ts`
- Test: `packages/db/scripts/lib/__tests__/select-boards.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/scripts/lib/__tests__/select-boards.test.ts
import { describe, expect, it } from "vitest";
import { isInScope } from "../select-boards";

describe("isInScope", () => {
  it("includes an open project board", () => {
    expect(isInScope({ name: "AR.IN - BDG H-1", closed: false }).include).toBe(true);
  });
  it("includes the WHA pipeline boards", () => {
    expect(isInScope({ name: "WHA - WORKING DRAWINGS", closed: false }).include).toBe(true);
  });
  it("excludes closed boards", () => {
    const r = isInScope({ name: "DARMO HILL", closed: true });
    expect(r.include).toBe(false);
    expect(r.reason).toBe("closed");
  });
  it("excludes templates and junk regardless of case/whitespace", () => {
    expect(isInScope({ name: "ARCH - TEMPLATE", closed: false }).include).toBe(false);
    expect(isInScope({ name: "INTR - TEMPLATE", closed: false }).include).toBe(false);
    expect(isInScope({ name: "  untitled  ", closed: false }).include).toBe(false);
    expect(isInScope({ name: "To Do List - Timbul", closed: false }).include).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @datum/db test`
Expected: FAIL — `isInScope` not exported.

- [ ] **Step 3: Implement `isInScope`**

```ts
// packages/db/scripts/lib/select-boards.ts

const EXCLUDE_NAMES = new Set(
  ["ARCH - TEMPLATE", "INTR - TEMPLATE", "Untitled", "To Do List - Timbul"].map((s) =>
    s.trim().toUpperCase(),
  ),
);

export interface BoardRef {
  name: string;
  closed: boolean;
}

export function isInScope(board: BoardRef): { include: boolean; reason: string } {
  if (board.closed) return { include: false, reason: "closed" };
  if (EXCLUDE_NAMES.has(board.name.trim().toUpperCase())) {
    return { include: false, reason: "excluded-template-or-junk" };
  }
  return { include: true, reason: "in-scope" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @datum/db test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/lib/select-boards.ts packages/db/scripts/lib/__tests__/select-boards.test.ts
git commit -m "feat(db): board selection filter for Trello import scope"
```

---

## Task 6: `normalize-raw.ts` — raw dumps → importer JSON files

**Files:**
- Create: `packages/db/scripts/normalize-raw.ts`
- Modify: `packages/db/package.json`

- [ ] **Step 1: Implement the normalize script**

```ts
// packages/db/scripts/normalize-raw.ts
// Reads every assets/Trello/.raw/<shortLink>.json (a raw Trello board API response)
// and writes a normalized importer-shaped file to assets/Trello/<sanitized-name>/<shortLink>.json.

import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeBoard } from "./lib/trello-normalize";

const REPO_ROOT = resolve(__dirname, "../../..");
const RAW_DIR = resolve(REPO_ROOT, "assets/Trello/.raw");
const OUT_ROOT = resolve(REPO_ROOT, "assets/Trello");

function sanitizeFolder(name: string): string {
  return name.replace(/[\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
}

function main() {
  if (!existsSync(RAW_DIR)) {
    console.error(`No raw dir at ${RAW_DIR}. Run the fetch step first.`);
    process.exit(1);
  }
  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Normalizing ${files.length} raw boards...`);

  let written = 0;
  for (const f of files) {
    const raw = JSON.parse(readFileSync(resolve(RAW_DIR, f), "utf8"));
    if (!raw?.id || !raw?.name) {
      console.warn(`  ⚠ skip ${f}: missing id/name`);
      continue;
    }
    const board = normalizeBoard(raw);
    const dir = resolve(OUT_ROOT, sanitizeFolder(board._meta.board_name));
    mkdirSync(dir, { recursive: true });
    const outPath = resolve(dir, `${board._meta.short_link}.json`);
    writeFileSync(outPath, JSON.stringify(board, null, 2));
    written++;
    console.log(`  ✓ ${board._meta.project_code}  (${(board.cards as unknown[]).length} cards)`);
  }
  console.log(`Done. ${written} normalized board files written.`);
}

main();
```

- [ ] **Step 2: Add the npm script**

In `packages/db/package.json` `"scripts"`, add:
```json
    "import:trello-normalize": "tsx scripts/normalize-raw.ts",
```

- [ ] **Step 3: Smoke-test against a fixture raw file**

Run:
```bash
cd "packages/db" && mkdir -p ../../assets/Trello/.raw && npx tsx -e "
import { writeFileSync } from 'node:fs';
writeFileSync('../../assets/Trello/.raw/QQQcBn6d.json', JSON.stringify({ id:'665e984287e87d6665545a17', shortLink:'QQQcBn6d', name:'AR.IN - BDG H-1', lists:[], cards:[], actions:[] }));
" && pnpm --filter @datum/db import:trello-normalize
```
Expected: prints `✓ ARIN-BDG-H-1 (0 cards)` and writes `assets/Trello/AR.IN - BDG H-1/QQQcBn6d.json`.

- [ ] **Step 4: Clean up the smoke-test artifacts**

Run: `rm -rf "assets/Trello/.raw" "assets/Trello/AR.IN - BDG H-1"`
Expected: temp files removed (real fetch in Task 9 repopulates `.raw`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/normalize-raw.ts packages/db/package.json
git commit -m "feat(db): normalize-raw script for fetched Trello boards"
```

---

## Task 7: Extend `import-trello.ts` — discovery + auto-create project

**Files:**
- Modify: `packages/db/scripts/import-trello.ts`

This task replaces the hardcoded `IMPORTS` array and project lookup with directory discovery and `ensureProject`. The existing per-list/per-card/per-event/per-comment logic is preserved — it is moved verbatim into `importBoardContents(board, projectId, wilsonId, summary)`, with `projectId` provided by `ensureProject` instead of looked up from `project_code`.

- [ ] **Step 1: Add discovery + `ensureProject` + new `main`/`importBoardContents`**

Replace the `IMPORTS` constant (lines ~95-104) and the `importProject` function signature + its project-lookup head (lines ~170-204), and the `main` entrypoint (lines ~559-596) as follows. Keep every line of the existing topic-mapping/card/event/comment body — only its enclosing function header and the `project_id`/`board` bindings change.

```ts
// ── Discovery ────────────────────────────────────────────────────────────────
import { readdirSync, statSync } from "node:fs";
import type { ProjectMeta } from "./lib/trello-normalize";

const REPO_ROOT = resolve(__dirname, "../../..");
const TRELLO_DIR = resolve(REPO_ROOT, "assets/Trello");

function discoverBoardFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue; // skip .raw, .DS_Store
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...discoverBoardFiles(full));
    else if (entry.endsWith(".json")) out.push(full);
  }
  return out;
}

type BoardMeta = { trello_board_id: string; short_link: string; board_name: string } & ProjectMeta;

// ── Project auto-create ──────────────────────────────────────────────────────

async function uniqueProjectCode(base: string): Promise<string> {
  let code = base;
  let n = 1;
  while (true) {
    const { data } = await admin.from("projects").select("id").eq("project_code", code).maybeSingle();
    if (!data) return code;
    n++;
    code = `${base}-${n}`;
  }
}

async function ensureProject(
  meta: BoardMeta,
  wilsonId: string,
  summary: { projectsCreated: number },
): Promise<string | null> {
  // 1. Idempotency: find by trello_board_id
  const { data: existing } = await admin
    .from("projects")
    .select("id")
    .eq("trello_board_id", meta.trello_board_id)
    .maybeSingle();
  if (existing) return existing.id;

  // 2. Create
  const code = await uniqueProjectCode(meta.project_code);
  const { data: created, error } = await admin
    .from("projects")
    .insert({
      project_code: code,
      project_name: meta.project_name,
      client_name: meta.client_name,
      site_address: meta.site_address,
      status: "construction",
      principal_id: wilsonId,
      search_aliases: meta.search_aliases as unknown as Database["public"]["Tables"]["projects"]["Insert"]["search_aliases"],
      trello_board_id: meta.trello_board_id,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error(`  ✗ Failed to create project "${meta.project_name}" (${code}): ${error?.message}`);
    return null;
  }
  const projectId = created.id;
  summary.projectsCreated++;
  console.log(`  + Project ${code} — ${meta.project_name}${meta.client_name ? " / " + meta.client_name : ""}`);

  // Principal assignment (RLS visibility) — topics are auto-seeded by trigger.
  await admin
    .from("project_staff")
    .upsert(
      { project_id: projectId, staff_id: wilsonId, role_on_project: "principal", cost_visible: true },
      { onConflict: "project_id,staff_id" },
    );

  // 8 project gates A–H
  const gates = ["A", "B", "C", "D", "E", "F", "G", "H"].map((gate_code) => ({
    project_id: projectId,
    gate_code: gate_code as Database["public"]["Enums"]["gate_code"],
  }));
  await admin.from("project_gates").upsert(gates, { onConflict: "project_id,gate_code" });

  // Duplicate-name flag (cross-workspace duplicates expected; logged, not merged)
  const { data: dupes } = await admin
    .from("projects")
    .select("project_code")
    .eq("project_name", meta.project_name)
    .neq("id", projectId);
  if (dupes && dupes.length > 0) {
    console.warn(`  ⚠ "${meta.project_name}" may duplicate: ${dupes.map((d) => d.project_code).join(", ")}`);
  }

  return projectId;
}
```

- [ ] **Step 2: Change `importProject` into `importBoardContents`**

Rename `importProject(jsonPath, projectCode, wilsonId)` to `importBoardContents(board, projectId, wilsonId, summary)`. Delete its current steps 1-2 (the `readFileSync` and the `projects` lookup, lines ~185-204) — `board` and `projectId` are now passed in. Everything from "3. Load existing topics for this project" onward stays exactly as written, with these mechanical substitutions throughout the body:
- every `projectId` reference now comes from the parameter (no change to usage),
- the `summary` object is passed in (drop the local `const summary` initializer at the top of the old function; keep the field increments).

The new header:
```ts
async function importBoardContents(
  board: TrelloBoard,
  projectId: string,
  wilsonId: string,
  summary: Summary,
): Promise<void> {
  // 3. Load existing topics for this project …  (existing body unchanged from here)
```

- [ ] **Step 3: Extend the `Summary` type**

In the `Summary` interface, add `projectsCreated`:
```ts
interface Summary {
  projectsCreated: number;
  topicsCreated: number;
  cardsCreated: number;
  cardsSkipped: number;
  eventsInserted: number;
  commentsInserted: number;
}
```

- [ ] **Step 4: Replace `main`**

```ts
async function main() {
  console.log("Trello bulk import");
  console.log("==================");

  const { data: staffRows, error: staffErr } = await admin
    .from("staff")
    .select("id, full_name")
    .eq("full_name", "Wilson Harkhono");
  if (staffErr) throw staffErr;
  const wilsonId = staffRows?.[0]?.id;
  if (!wilsonId) throw new Error("Wilson Harkhono staff row not found — run seed-pilot.ts first");

  const summary: Summary = {
    projectsCreated: 0,
    topicsCreated: 0,
    cardsCreated: 0,
    cardsSkipped: 0,
    eventsInserted: 0,
    commentsInserted: 0,
  };

  const files = discoverBoardFiles(TRELLO_DIR);
  console.log(`Discovered ${files.length} board files.\n`);

  for (const file of files) {
    let board: TrelloBoard & { _meta?: BoardMeta };
    try {
      board = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`✗ Parse error ${file}: ${(e as Error).message}`);
      continue;
    }
    if (!board._meta?.trello_board_id) {
      console.warn(`skip (no _meta): ${file}`);
      continue;
    }
    console.log(`──── ${board._meta.project_code} ────`);
    try {
      const projectId = await ensureProject(board._meta, wilsonId, summary);
      if (!projectId) continue;
      await importBoardContents(board, projectId, wilsonId, summary);
    } catch (err) {
      console.error(`✗ Error importing ${board._meta.project_code}:`, err);
    }
  }

  console.log("\n══════════ IMPORT SUMMARY ══════════");
  console.log(`  Projects created: ${summary.projectsCreated}`);
  console.log(`  Topics created:   ${summary.topicsCreated}`);
  console.log(`  Cards created:    ${summary.cardsCreated}`);
  console.log(`  Cards skipped:    ${summary.cardsSkipped}`);
  console.log(`  Events inserted:  ${summary.eventsInserted}`);
  console.log(`  Comments inserted: ${summary.commentsInserted}`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
```

Remove the now-unused old `IMPORTS` constant and the old `REPO_ROOT` duplicate (a single `REPO_ROOT` is declared in Step 1).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @datum/db typecheck`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/scripts/import-trello.ts
git commit -m "feat(db): auto-discover boards and auto-create projects on Trello import"
```

---

## Task 8: Project search in the app

**Files:**
- Modify: `apps/web/lib/search/queries.ts`
- Modify: `apps/web/app/(app)/search/page.tsx`
- Test: `apps/web/tests/unit/search-queries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/unit/search-queries.test.ts
import { describe, expect, it } from "vitest";
import { searchAll } from "@/lib/search/queries";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

function clientReturning(projects: unknown[]) {
  const builder: any = {
    select: () => builder,
    or: () => builder,
    ilike: () => builder,
    is: () => builder,
    contains: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    from(table: string) {
      if (table === "projects") {
        const pb: any = {
          select: () => pb,
          or: () => pb,
          limit: () => Promise.resolve({ data: projects, error: null }),
        };
        return pb;
      }
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("searchAll projects group", () => {
  it("returns matching projects as project hits", async () => {
    const supabase = clientReturning([
      { id: "p1", project_code: "ARIN-KARAWANG", project_name: "Karawang", client_name: "Nabil", location: "Karawang" },
    ]);
    const res = await searchAll(supabase, "nabil");
    expect(res.projects).toHaveLength(1);
    expect(res.projects[0].kind).toBe("project");
    expect(res.projects[0].projectCode).toBe("ARIN-KARAWANG");
    expect(res.projects[0].href).toBe("/project/ARIN-KARAWANG");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm test -- search-queries`
Expected: FAIL — `res.projects` undefined / `kind` lacks `"project"`.

- [ ] **Step 3: Extend `searchAll`**

In `apps/web/lib/search/queries.ts`:

Change the `kind` union and add a project query. Update the `SearchHit` type:
```ts
export type SearchHit = {
  id: string;
  kind: "card" | "event" | "comment" | "project";
  projectCode: string;
  cardSlug: string;
  cardTitle: string;
  snippet: string;
  href: string;
  occurredAt: string;
};
```

Change the `searchAll` return type and early-return:
```ts
): Promise<{ projects: SearchHit[]; cards: SearchHit[]; events: SearchHit[]; comments: SearchHit[] }> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return { projects: [], cards: [], events: [], comments: [] };
  }
```

Immediately after the `pattern` is computed, add the projects query:
```ts
  // Projects: name / client / site / alias
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, project_code, project_name, client_name, location")
    .or(
      `project_name.ilike.${pattern},client_name.ilike.${pattern},site_address.ilike.${pattern},search_aliases.cs.${JSON.stringify([trimmed])}`,
    )
    .limit(PER_GROUP);

  const projects: SearchHit[] = (projectRows ?? []).map((p) => ({
    id: `p_${p.id}`,
    kind: "project" as const,
    projectCode: p.project_code,
    cardSlug: "",
    cardTitle: `${p.project_code} · ${p.project_name}`,
    snippet: [p.client_name ? `Client: ${p.client_name}` : null, p.location].filter(Boolean).join(" · "),
    href: `/project/${p.project_code}`,
    occurredAt: "",
  }));
```

Add `projects` to the final return:
```ts
  return { projects, cards, events: eventHits, comments };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm test -- search-queries`
Expected: PASS.

- [ ] **Step 5: Render the projects group in the search page**

In `apps/web/app/(app)/search/page.tsx`:

Add to `KIND_LABEL` and `KIND_COLOR`:
```ts
const KIND_LABEL: Record<SearchHit["kind"], string> = {
  project: "Proyek",
  card: "Kartu",
  event: "Aktivitas",
  comment: "Komentar",
};

const KIND_COLOR: Record<SearchHit["kind"], string> = {
  project: "bg-[var(--sand)]/20 text-[var(--sand-dark)]",
  card: "bg-[var(--flag-ok-bg)] text-[var(--flag-ok)]",
  event: "bg-[var(--sand-tint)] text-[var(--sand-dark)]",
  comment: "bg-[var(--surface-alt)] text-[var(--text-secondary)]",
};
```

Update the empty default, total, and groups:
```ts
  const results = q.trim().length >= 2 ? await searchAll(supabase, q) : { projects: [], cards: [], events: [], comments: [] };
  const total = results.projects.length + results.cards.length + results.events.length + results.comments.length;
```
```ts
      {[
        { label: "Proyek", items: results.projects },
        { label: "Kartu", items: results.cards },
        { label: "Aktivitas", items: results.events },
        { label: "Komentar", items: results.comments },
      ].map(({ label, items }) =>
```

Update the intro copy on line ~33 to mention projects:
```tsx
        Pencarian teks di seluruh proyek — proyek, kartu, aktivitas, komentar.
```

- [ ] **Step 6: Typecheck + full web test run**

Run: `cd apps/web && pnpm test`
Expected: PASS (new test green, existing tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/search/queries.ts apps/web/app/\(app\)/search/page.tsx apps/web/tests/unit/search-queries.test.ts
git commit -m "feat(web): search projects by name, client, and site address"
```

---

## Task 9: Execute the fetch + import (live)

This is the agent-driven run against the live Composio connection and Supabase. No new code — it runs the pipeline built above.

- [ ] **Step 1: Refresh the in-scope board list**

Call `TRELLO_GET_ORGANIZATIONS_BOARDS_BY_ID_ORG` (via `COMPOSIO_MULTI_EXECUTE_TOOL`) for both orgs with `fields=name,closed,shortLink`:
- `6047c464ad682d7c1686c599` (WHAstudio)
- `646c79a83ebb2f64e7cf66e7` (WHA's workspace)

Apply `isInScope` (Task 5) to each board. Collect `{ id, shortLink, name }` for the in-scope set.
Expected: ~73 boards in scope (see Appendix for the 2026-06-12 snapshot as a sanity check — counts may drift).

- [ ] **Step 2: Fetch raw boards in parallel subagent waves**

Create `assets/Trello/.raw/`. Split the in-scope board IDs into chunks of ~10. For each chunk, dispatch a subagent (Task tool) instructed to:
1. Call `COMPOSIO_MULTI_EXECUTE_TOOL` with one `TRELLO_GET_BOARDS_BY_ID_BOARD` entry per board, arguments:
   ```
   idBoard=<id>
   lists=open
   cards=open
   card_fields=name,desc,idList,due,dueComplete,dateLastActivity,shortUrl,shortLink,closed,idChecklists,idMembers
   card_attachments=true
   card_attachment_fields=name,url,mimeType,date
   card_checklists=all
   actions=commentCard
   actions_limit=1000
   fields=name,shortLink,shortUrl,idOrganization,closed
   ```
2. For each result, write `data.results[i].response.data` (the board object) verbatim to `assets/Trello/.raw/<shortLink>.json` using the Write tool.
3. Return only a one-line manifest per board: `shortLink, name, #lists, #cards, #actions`.

Run waves until all chunks complete. Keeps large payloads in subagent contexts, not the orchestrator's.

- [ ] **Step 3: Verify raw count**

Run: `ls assets/Trello/.raw/*.json | wc -l`
Expected: equals the in-scope count from Step 1.

- [ ] **Step 4: Normalize**

Run: `pnpm --filter @datum/db import:trello-normalize`
Expected: one `✓ <CODE> (N cards)` line per raw board; normalized files under `assets/Trello/<name>/<shortLink>.json`.

- [ ] **Step 5: Import into Supabase**

Run: `pnpm --filter @datum/db import:trello`
Expected: summary prints ~71 projects created (73 in scope − 2 pilots reused), plus topic/card/event/comment counts. No fatal errors.

- [ ] **Step 6: Spot-check one imported project**

Run:
```bash
cd "packages/db" && npx tsx -e "
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env') });
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { count: projects } = await a.from('projects').select('id', { count: 'exact', head: true });
const { data: sample } = await a.from('projects').select('project_code, project_name, client_name, trello_board_id').not('trello_board_id','is',null).limit(5);
console.log('total projects:', projects);
console.log(sample);
"
```
Expected: project count jumped by ~71; sample rows show derived codes, names, clients, and non-null `trello_board_id`.

- [ ] **Step 7: Verify idempotency**

Run: `pnpm --filter @datum/db import:trello`
Expected: `Projects created: 0`, `Cards created: 0` — a second run is a no-op.

- [ ] **Step 8: Verify search end-to-end**

Start the app (`cd apps/web && pnpm dev`), open `/search?q=<a known client name>` and `/search?q=<a known site name>`. Confirm a **Proyek** result links to `/project/<code>`.

- [ ] **Step 9: Remove the legacy pilot files**

The two original pilot exports lack `_meta` (the importer logs `skip (no _meta)` for them) and are superseded by the freshly fetched `AR.IN - BDG H-1/` and `AR.IN - PAKUWON PC10-12 - SETIONO/` folders.

Run: `rm -rf "assets/Trello/Bukit Darmo Golf H:1" "assets/Trello/Pakuwon PC 10:12"`
Expected: only normalized, `_meta`-bearing board folders remain under `assets/Trello/`.

- [ ] **Step 10: Commit the fetched/normalized board assets**

```bash
git add assets/Trello
git commit -m "chore(assets): fetched + normalized WHA Studio Trello boards"
```

> NOTE: `assets/Trello/.raw/` is an intermediate dump. Decide whether to keep it (audit trail) or add it to `.gitignore`. Default: keep normalized files, gitignore `.raw/`.

---

## Appendix: in-scope board snapshot (2026-06-12)

For sanity-checking Step 1's count. Membership may drift; trust `isInScope` over this list.

**WHAstudio (`6047c464ad682d7c1686c599`)** — open, minus 2 templates + "Untitled":
all `AR.IN -` boards (~30, incl. pilots BDG H-1 / Pakuwon PC10-12), all open `ARCH -` boards (~24), all open `INTR -` boards (~6), the 3 `WHA -` pipeline boards, plus `PAKUWON AB1/28` and `TERAS AYUNG BALI - HERMINTO`.

**WHA's workspace (`646c79a83ebb2f64e7cf66e7`)** — 8 open boards (1 closed `ARCH - Pakuwon PD 8 19-21` excluded): `Citraland GA7/45 - Wan Sing`, `GRAHA FAMILY S-27`, `PAKUWON INDAH - ABL 67`, `PAKUWON INDAH - PD6/22`, `PAKUWON INDAH - PD8/19-21`, `PANTAI INDAH KAPUK - JL. BAHTERA`, `VILLA TRETES`, `WHA Studio`. These likely duplicate main-workspace jobs (flagged by the importer).

Excluded everywhere: `ARCH - TEMPLATE`, `INTR - TEMPLATE`, `Untitled`, `To Do List - Timbul`, and all `closed === true` boards.
```
