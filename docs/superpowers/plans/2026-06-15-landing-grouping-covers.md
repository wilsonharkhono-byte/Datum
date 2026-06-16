# Landing grouped cover-cards + grouping-aware search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flat 66-project picker into a Trello-style grid of cover cards grouped by a user-editable "development", and make `/search` surface development → board → card results.

**Architecture:** A new `developments` table (+ `projects.development_id`, `projects.cover_image_path`) is the source of truth for grouping; a one-time seed script makes a best-guess first pass. The landing page (a client component already backed by React Query) groups/filters client-side. Covers live in a public Supabase Storage bucket. Search adds a "tier" group computed from `developments`.

**Tech Stack:** Next.js 16 App Router (React 19), Supabase (Postgres + Storage + RLS), TanStack Query, Zod, Vitest, Tailwind v4. Package manager: pnpm (workspaces). Migrations via Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-06-15-landing-redesign-and-search-tiers-design.md`

**Conventions for this codebase:**
- Run web tests: `pnpm --filter web exec vitest run <path>`. Run db tests: `pnpm --filter @datum/db exec vitest run <path>`.
- Typecheck: `pnpm --filter web typecheck` / `pnpm --filter @datum/db typecheck`.
- All user-facing strings are Bahasa Indonesia.
- Colors come from CSS vars (`--foreground`, `--surface`, `--sand-dark`, `--border`, `--flag-*`) or the warm hex set already used in `ProjectsList.tsx` (`#141210`, `#FDFAF6`, `#B5AFA8`, `#7A6B56`, `#524E49`, `#847E78`). Never pure `#000`/`#FFF`.
- Write gate for project/grouping mutations: `current_can_manage_projects()` (DB) / `canManageAccess` (server actions) — principal/admin only.
- End every commit message with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Task 1: Database migration — developments table, project columns, cover bucket

**Files:**
- Create: `packages/db/supabase/migrations/20260615000004_developments_and_project_covers.sql`
- Modify: `packages/db/src/types.generated.ts` (regenerated, not hand-edited)

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/supabase/migrations/20260615000004_developments_and_project_covers.sql`:

```sql
-- 20260615000004_developments_and_project_covers.sql
-- Landing redesign: user-editable project grouping ("developments") + project
-- cover images.
--   * developments: curated groups (Citraland, Bukit Darmo Golf, ...). Source of
--     truth for landing grouping and the search "tier"; seeded once, edited in-app.
--   * projects.development_id: nullable FK; on delete set null keeps projects.
--   * projects.cover_image_path: path within the public 'project-covers' bucket.

begin;

create table public.developments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  area_label  text,
  sort_order  int  not null default 100,
  created_at  timestamptz not null default now()
);

create unique index developments_name_lower_idx on public.developments (lower(name));

alter table public.developments enable row level security;

create policy developments_select on public.developments
  for select using (true);

create policy developments_insert on public.developments
  for insert with check (public.current_can_manage_projects());

create policy developments_update on public.developments
  for update using (public.current_can_manage_projects())
  with check  (public.current_can_manage_projects());

create policy developments_delete on public.developments
  for delete using (public.current_can_manage_projects());

alter table public.projects
  add column development_id   uuid references public.developments(id) on delete set null,
  add column cover_image_path text;

create index projects_development_id_idx on public.projects (development_id);

-- Public bucket: covers are non-confidential renders; public URLs avoid 66
-- signed-URL round-trips on the landing page. Paths are '<project_id>/<uuid>-<name>'.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-covers',
  'project-covers',
  true,
  10485760,  -- 10 MB per file
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reads are public (served via /object/public/...). Writes are principal/admin only.
create policy project_covers_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-covers' and public.current_can_manage_projects());

create policy project_covers_update on storage.objects
  for update to authenticated
  using (bucket_id = 'project-covers' and public.current_can_manage_projects())
  with check (bucket_id = 'project-covers' and public.current_can_manage_projects());

create policy project_covers_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-covers' and public.current_can_manage_projects());

commit;
```

- [ ] **Step 2: Apply the migration to the linked Supabase project**

Run: `pnpm --filter @datum/db migrate`
Expected: `supabase db push` reports the new migration applied with no errors.
(Note: this targets the live linked database — the project's established workflow.)

- [ ] **Step 3: Regenerate the generated types**

Run: `pnpm --filter @datum/db types`
Expected: `packages/db/src/types.generated.ts` now contains a `developments` table type and `development_id` / `cover_image_path` on `projects`.

- [ ] **Step 4: Verify the schema picked up**

Run: `git diff --stat packages/db/src/types.generated.ts`
Expected: the file shows additions; `grep -c "developments" packages/db/src/types.generated.ts` returns ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/20260615000004_developments_and_project_covers.sql packages/db/src/types.generated.ts
git commit -m "feat(db): developments table + project development_id/cover_image_path + cover bucket

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `deriveDevelopment` helper (seed-only, pure, TDD)

Derives a best-guess development label from a project name. Used **only** by the seed script — never at runtime.

**Files:**
- Create: `packages/db/scripts/lib/derive-development.ts`
- Test: `packages/db/scripts/lib/__tests__/derive-development.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/scripts/lib/__tests__/derive-development.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveDevelopment } from "../derive-development";

describe("deriveDevelopment", () => {
  it("strips the trailing unit token", () => {
    expect(deriveDevelopment("Citraland E7-20")).toBe("Citraland");
    expect(deriveDevelopment("Citraland Gc5-26")).toBe("Citraland");
  });
  it("keeps multi-word development names", () => {
    expect(deriveDevelopment("Bukit Darmo Golf I-32")).toBe("Bukit Darmo Golf");
  });
  it("applies the alias map (BDG = Bukit Darmo Golf)", () => {
    expect(deriveDevelopment("Bdg H-16")).toBe("Bukit Darmo Golf");
  });
  it("treats slash-bearing tokens as units", () => {
    expect(deriveDevelopment("Citraland Ga7/45")).toBe("Citraland");
  });
  it("falls back to the whole name when nothing is strippable", () => {
    expect(deriveDevelopment("Kobin Showroom")).toBe("Kobin Showroom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @datum/db exec vitest run scripts/lib/__tests__/derive-development.test.ts`
Expected: FAIL — cannot find module `../derive-development`.

- [ ] **Step 3: Write the implementation**

Create `packages/db/scripts/lib/derive-development.ts`:

```ts
// Best-guess development label from a project_name. SEED-ONLY: after the seed
// runs, projects.development_id is the source of truth. Wilson corrects the rest.

// Known abbreviations / forced groupings. Keys are matched case-insensitively
// against the *first* token of the stripped name.
const ALIAS: Record<string, string> = {
  bdg: "Bukit Darmo Golf",
};

function looksLikeUnit(token: string): boolean {
  return /[0-9/]/.test(token);
}

export function deriveDevelopment(projectName: string): string {
  const cleaned = projectName.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";

  const tokens = cleaned.split(" ");
  // Drop trailing unit tokens (those containing a digit or slash).
  while (tokens.length > 1 && looksLikeUnit(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  const label = tokens.join(" ");

  const aliasKey = label.toLowerCase();
  if (ALIAS[aliasKey]) return ALIAS[aliasKey];
  return label;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @datum/db exec vitest run scripts/lib/__tests__/derive-development.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/lib/derive-development.ts packages/db/scripts/lib/__tests__/derive-development.test.ts
git commit -m "feat(db): deriveDevelopment seed helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Seed script — best-guess first pass

Idempotent. Reads all projects, derives a development per project, upserts `developments`, sets `development_id`. Re-runnable without creating duplicates.

**Files:**
- Create: `packages/db/scripts/seed-developments.ts`
- Modify: `packages/db/package.json` (add a `seed:developments` script)

- [ ] **Step 1: Write the seed script**

Create `packages/db/scripts/seed-developments.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import type { Database } from "../src";
import { deriveDevelopment } from "./lib/derive-development";

config({ path: resolve(__dirname, "../../../.env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

const admin = createClient<Database>(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: projects, error } = await admin
    .from("projects")
    .select("id, project_name, development_id");
  if (error) throw error;

  // name(lower) -> development id, cached as we create them.
  const byName = new Map<string, string>();
  const { data: existing } = await admin.from("developments").select("id, name");
  for (const d of existing ?? []) byName.set(d.name.toLowerCase(), d.id);

  let created = 0;
  let assigned = 0;
  for (const p of projects ?? []) {
    if (p.development_id) continue; // never override a human assignment
    const label = deriveDevelopment(p.project_name);
    if (!label) continue;

    let devId = byName.get(label.toLowerCase());
    if (!devId) {
      const { data: dev, error: dErr } = await admin
        .from("developments")
        .insert({ name: label })
        .select("id")
        .single();
      if (dErr) throw dErr;
      devId = dev.id;
      byName.set(label.toLowerCase(), devId);
      created++;
    }

    const { error: uErr } = await admin
      .from("projects")
      .update({ development_id: devId })
      .eq("id", p.id);
    if (uErr) throw uErr;
    assigned++;
  }

  console.log(`Developments created: ${created}; projects assigned: ${assigned}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the package script**

In `packages/db/package.json`, add to `scripts` (after `"seed:cards"`):

```json
    "seed:developments": "tsx scripts/seed-developments.ts",
```

- [ ] **Step 3: Run the seed once**

Run: `pnpm --filter @datum/db seed:developments`
Expected: prints `Developments created: N; projects assigned: M` with no errors. Re-running prints `created: 0; assigned: 0` (idempotent — every project now has a `development_id`).

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/seed-developments.ts packages/db/package.json
git commit -m "feat(db): one-time seed-developments script

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Allow public cover images in Next image config

**Files:**
- Modify: `apps/web/next.config.ts`

- [ ] **Step 1: Read the current remotePatterns**

Run: `sed -n '1,30p' apps/web/next.config.ts`
Expected: shows an `images.remotePatterns` entry with `pathname: "/storage/v1/object/sign/**"`.

- [ ] **Step 2: Add a public-object pattern**

Add a sibling entry to the existing one in `images.remotePatterns` (same `protocol`/`hostname` as the existing Supabase entry):

```ts
      {
        protocol: "https",
        hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co").hostname,
        pathname: "/storage/v1/object/public/project-covers/**",
      },
```

If the existing entry hardcodes the hostname string, match that exact hostname instead of the `new URL(...)` form — keep it consistent with what's already there.

- [ ] **Step 3: Verify the config parses**

Run: `pnpm --filter web typecheck`
Expected: PASS (no type errors introduced).

- [ ] **Step 4: Commit**

```bash
git add apps/web/next.config.ts
git commit -m "feat(web): allow public project-covers images

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Cover URL helper (pure, TDD)

**Files:**
- Create: `apps/web/lib/projects/cover.ts`
- Test: `apps/web/tests/unit/project-cover.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/project-cover.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { coverImageUrl } from "@/lib/projects/cover";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://demo.supabase.co";
});

describe("coverImageUrl", () => {
  it("returns null for null/empty paths", () => {
    expect(coverImageUrl(null)).toBeNull();
    expect(coverImageUrl("")).toBeNull();
  });
  it("builds a public storage URL", () => {
    expect(coverImageUrl("abc/123-render.jpg")).toBe(
      "https://demo.supabase.co/storage/v1/object/public/project-covers/abc/123-render.jpg",
    );
  });
  it("encodes spaces in the path", () => {
    expect(coverImageUrl("abc/my render.png")).toBe(
      "https://demo.supabase.co/storage/v1/object/public/project-covers/abc/my%20render.png",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/project-cover.test.ts`
Expected: FAIL — cannot find module `@/lib/projects/cover`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/projects/cover.ts`:

```ts
export function coverImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/project-covers/${encoded}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/unit/project-cover.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/projects/cover.ts apps/web/tests/unit/project-cover.test.ts
git commit -m "feat(web): coverImageUrl helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Enrich projects queries + add `getDevelopments`

**Files:**
- Modify: `apps/web/lib/projects/queries.ts`

- [ ] **Step 1: Replace the file contents**

Overwrite `apps/web/lib/projects/queries.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
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
  supabase: SupabaseClient<Database>,
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
    cover_url: coverImageUrl(r.cover_image_path),
  }));
}

export async function getDevelopments(
  supabase: SupabaseClient<Database>,
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

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter web typecheck`
Expected: PASS. (The `/api/projects` route delegates to `getProjectsList`, so it needs no change — it now returns the enriched shape automatically.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/projects/queries.ts
git commit -m "feat(web): enrich projects list with development + cover; add getDevelopments

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Cover upload helper

**Files:**
- Create: `apps/web/lib/projects/cover-upload.ts`

- [ ] **Step 1: Write the helper** (mirrors `apps/web/lib/cards/upload.ts`)

Create `apps/web/lib/projects/cover-upload.ts`:

```ts
"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type CoverUploadResult =
  | { ok: true; storagePath: string }
  | { ok: false; error: string };

export async function uploadProjectCover(args: {
  file: File;
  projectId: string;
}): Promise<CoverUploadResult> {
  const supabase = createSupabaseBrowserClient();
  const safeName = args.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${args.projectId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("project-covers")
    .upload(path, args.file, {
      contentType: args.file.type || "image/jpeg",
      upsert: false,
    });
  if (error) return { ok: false, error: error.message };
  return { ok: true, storagePath: path };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/projects/cover-upload.ts
git commit -m "feat(web): uploadProjectCover storage helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Extend `updateProject` mutation (cover + development get-or-create)

**Files:**
- Modify: `apps/web/lib/projects/mutations.ts:95-152` (the `UpdateProjectInput` schema and `updateProject` function)

- [ ] **Step 1: Extend the Zod schema**

In `apps/web/lib/projects/mutations.ts`, add two fields to `UpdateProjectInput` (after `kickoffDate`):

```ts
  coverImagePath: z.string().nullable().optional(),
  developmentName: z.string().max(120).nullable().optional(),
```

- [ ] **Step 2: Parse the two new fields**

In the `UpdateProjectInput.parse({ ... })` call inside `updateProject`, add (after the `kickoffDate` line):

```ts
      coverImagePath:  formData.get("coverImagePath") === null ? undefined : (formData.get("coverImagePath") === "" ? null : formData.get("coverImagePath")),
      developmentName: formData.get("developmentName") === null ? undefined : (formData.get("developmentName") === "" ? null : formData.get("developmentName")),
```

- [ ] **Step 3: Resolve development + apply both to the patch**

In `updateProject`, after the existing `if (input.kickoffDate !== undefined) ...` line and before the `if (Object.keys(patch).length === 0)` guard, insert:

```ts
  if (input.coverImagePath !== undefined) patch.cover_image_path = input.coverImagePath;

  if (input.developmentName !== undefined) {
    if (input.developmentName === null) {
      patch.development_id = null;
    } else {
      const name = input.developmentName.trim();
      const { data: found } = await supabase
        .from("developments")
        .select("id")
        .ilike("name", name)
        .maybeSingle();
      if (found) {
        patch.development_id = found.id;
      } else {
        const { data: created, error: cErr } = await supabase
          .from("developments")
          .insert({ name })
          .select("id")
          .single();
        if (cErr) return { ok: false, error: cErr.message };
        patch.development_id = created.id;
      }
    }
  }
```

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm --filter web typecheck`
Expected: PASS. (`patch` is typed `projects.Update`, which now includes `development_id` and `cover_image_path` from Task 1's regenerated types.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/projects/mutations.ts
git commit -m "feat(web): updateProject sets cover + get-or-create development

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Development tint helper + `ProjectCard` component

**Files:**
- Create: `apps/web/lib/projects/tint.ts`
- Test: `apps/web/tests/unit/project-tint.test.ts`
- Create: `apps/web/components/projects/ProjectCard.tsx`

- [ ] **Step 1: Write the failing tint test**

Create `apps/web/tests/unit/project-tint.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { developmentTint, TINTS } from "@/lib/projects/tint";

describe("developmentTint", () => {
  it("is deterministic for the same name", () => {
    expect(developmentTint("Citraland")).toEqual(developmentTint("Citraland"));
  });
  it("always returns a tint from the palette", () => {
    for (const name of ["Citraland", "Pakuwon", "Bukit Darmo Golf", "", "Kobin"]) {
      expect(TINTS).toContainEqual(developmentTint(name));
    }
  });
  it("uses the neutral tint for empty/ungrouped", () => {
    expect(developmentTint("")).toEqual(TINTS[0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/project-tint.test.ts`
Expected: FAIL — cannot find module `@/lib/projects/tint`.

- [ ] **Step 3: Write the tint helper**

Create `apps/web/lib/projects/tint.ts`:

```ts
export type Tint = { bg: string; fg: string };

// Warm palette pairs (background tint + matched darker text), brand-safe, flat.
// Index 0 is the neutral/ungrouped tint.
export const TINTS: Tint[] = [
  { bg: "#E7E1D6", fg: "#7A6B56" },
  { bg: "#E8DFC9", fg: "#7A6531" },
  { bg: "#E0E2D2", fg: "#566436" },
  { bg: "#E6DCD2", fg: "#7A5B43" },
  { bg: "#DFE0DA", fg: "#55605A" },
  { bg: "#EADfDA", fg: "#8A5A4C" },
];

export function developmentTint(name: string): Tint {
  if (!name) return TINTS[0]!;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  // Skip index 0 (reserved for ungrouped) for real names.
  const idx = 1 + (hash % (TINTS.length - 1));
  return TINTS[idx]!;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/unit/project-tint.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the `ProjectCard` component**

Create `apps/web/components/projects/ProjectCard.tsx`:

```tsx
"use client";
import Link from "next/link";
import Image from "next/image";
import type { ProjectListItem } from "@/lib/projects/queries";
import { developmentTint } from "@/lib/projects/tint";
import { ProjectEditDialog } from "@/components/projects/ProjectEditDialog";
import type { DevelopmentOption } from "@/lib/projects/queries";

const statusLabel: Record<string, string> = {
  design: "Desain", construction: "Konstruksi", finishing: "Finishing",
  handover: "Serah terima", closed: "Selesai",
};

// Trailing unit token (e.g. "E7-20") for the fallback cover.
function unitCode(p: ProjectListItem): string {
  const tokens = p.project_name.trim().split(/\s+/);
  const last = tokens[tokens.length - 1] ?? "";
  return /[0-9/]/.test(last) ? last : p.project_code;
}

export function ProjectCard({
  project, developments,
}: { project: ProjectListItem; developments: DevelopmentOption[] }) {
  const tint = developmentTint(project.development_name ?? "");
  return (
    <div className="overflow-hidden rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6]">
      <Link href={`/project/${project.project_code}`} className="block transition-opacity hover:opacity-90">
        <div className="relative h-24 w-full" style={{ backgroundColor: tint.bg }}>
          {project.cover_url ? (
            <Image src={project.cover_url} alt="" fill sizes="(max-width:640px) 100vw, 33vw" className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center px-2 text-center text-base font-bold uppercase tracking-[0.06em]" style={{ color: tint.fg }}>
              {unitCode(project)}
            </div>
          )}
        </div>
        <div className="p-3">
          <div className="text-[13px] font-bold uppercase leading-tight tracking-[0.04em] text-[#141210]">
            {project.project_code}
          </div>
          <div className="mt-0.5 text-sm text-[#524E49]">{project.project_name}</div>
          <div className="mt-1 text-xs text-[#847E78]">Client: {project.client_name ?? "-"}</div>
          <span className="mt-2 inline-block rounded-[5px] bg-[#B29F86]/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7A6B56]">
            {statusLabel[project.status] ?? project.status}
          </span>
        </div>
      </Link>
      <div className="border-t border-[#EAE4DA] px-3 py-2">
        <ProjectEditDialog project={project} developments={developments} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit** (ProjectCard won't typecheck standalone until Task 11 updates `ProjectEditDialog`'s props — commit the helper now, the component compiles after Task 11.)

```bash
git add apps/web/lib/projects/tint.ts apps/web/tests/unit/project-tint.test.ts apps/web/components/projects/ProjectCard.tsx
git commit -m "feat(web): developmentTint helper + ProjectCard component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Grouping + filter helpers (pure, TDD)

**Files:**
- Create: `apps/web/lib/projects/grouping.ts`
- Test: `apps/web/tests/unit/project-grouping.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/project-grouping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterProjects, groupProjects } from "@/lib/projects/grouping";
import type { ProjectListItem } from "@/lib/projects/queries";

function mk(over: Partial<ProjectListItem>): ProjectListItem {
  return {
    id: "x", project_code: "ARCH-X-1", project_name: "X 1", client_name: null,
    location: null, status: "construction", target_handover: null,
    development_id: null, development_name: null, development_area_label: null,
    development_sort_order: null, cover_image_path: null, cover_url: null, ...over,
  };
}

describe("filterProjects", () => {
  const list = [
    mk({ id: "a", project_code: "ARCH-CITRALAND-E7-20", project_name: "Citraland E7-20", client_name: "Budhi", status: "construction" }),
    mk({ id: "b", project_code: "ARCH-PAKUWON-AB1-38", project_name: "Pakuwon Ab1-38", client_name: "Heru", status: "finishing" }),
  ];
  it("matches code, name, client, location (case-insensitive)", () => {
    expect(filterProjects(list, { query: "budhi", status: "all" }).map((p) => p.id)).toEqual(["a"]);
    expect(filterProjects(list, { query: "pakuwon", status: "all" }).map((p) => p.id)).toEqual(["b"]);
  });
  it("filters by status", () => {
    expect(filterProjects(list, { query: "", status: "finishing" }).map((p) => p.id)).toEqual(["b"]);
  });
  it("returns all when query empty and status all", () => {
    expect(filterProjects(list, { query: "", status: "all" })).toHaveLength(2);
  });
});

describe("groupProjects", () => {
  it("orders groups by sort_order then name, ungrouped last", () => {
    const list = [
      mk({ id: "u", development_id: null, development_name: null }),
      mk({ id: "c", development_id: "d2", development_name: "Citraland", development_sort_order: 100 }),
      mk({ id: "p", development_id: "d1", development_name: "Pakuwon", development_sort_order: 50 }),
    ];
    const groups = groupProjects(list);
    expect(groups.map((g) => g.name)).toEqual(["Pakuwon", "Citraland", "Belum dikelompokkan"]);
    expect(groups[2]!.projects.map((p) => p.id)).toEqual(["u"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/project-grouping.test.ts`
Expected: FAIL — cannot find module `@/lib/projects/grouping`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/projects/grouping.ts`:

```ts
import type { ProjectListItem } from "@/lib/projects/queries";

export const UNGROUPED_LABEL = "Belum dikelompokkan";

export type ProjectGroup = {
  id: string | null;
  name: string;
  area_label: string | null;
  sort_order: number;
  projects: ProjectListItem[];
};

export function filterProjects(
  list: ProjectListItem[],
  opts: { query: string; status: string },
): ProjectListItem[] {
  const q = opts.query.trim().toLowerCase();
  return list.filter((p) => {
    if (opts.status !== "all" && p.status !== opts.status) return false;
    if (!q) return true;
    const hay = [p.project_code, p.project_name, p.client_name ?? "", p.location ?? ""]
      .join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export function groupProjects(list: ProjectListItem[]): ProjectGroup[] {
  const map = new Map<string | null, ProjectGroup>();
  for (const p of list) {
    const key = p.development_id;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        name: key ? (p.development_name ?? UNGROUPED_LABEL) : UNGROUPED_LABEL,
        area_label: p.development_area_label,
        sort_order: p.development_sort_order ?? Number.MAX_SAFE_INTEGER,
        projects: [],
      });
    }
    map.get(key)!.projects.push(p);
  }
  return [...map.values()].sort((a, b) => {
    if (a.id === null) return 1; // ungrouped always last
    if (b.id === null) return -1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/unit/project-grouping.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/projects/grouping.ts apps/web/tests/unit/project-grouping.test.ts
git commit -m "feat(web): pure filterProjects + groupProjects helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Rewrite `ProjectEditDialog` (development combobox + cover field)

**Files:**
- Modify: `apps/web/components/projects/ProjectEditDialog.tsx`

- [ ] **Step 1: Update the props + local types**

Change the component signature and `Project` type. Replace the `Project` type and the function signature line:

```tsx
import type { DevelopmentOption, ProjectListItem } from "@/lib/projects/queries";
import { uploadProjectCover } from "@/lib/projects/cover-upload";
```

Use `ProjectListItem` directly instead of the local `Project` type, and change the signature to:

```tsx
export function ProjectEditDialog({
  project, developments,
}: { project: ProjectListItem; developments: DevelopmentOption[] }) {
```

(Delete the now-unused local `Project` type.)

- [ ] **Step 2: Add state for development + cover**

After the existing `const [target, setTarget] = ...` state line, add:

```tsx
  const [development, setDevelopment] = useState(project.development_name ?? "");
  const [coverPath, setCoverPath] = useState<string | null>(project.cover_image_path);
  const [uploading, setUploading] = useState(false);
```

- [ ] **Step 3: Send the new fields in submit**

In `submit`, after `fd.set("targetHandover", target);` add:

```tsx
    fd.set("developmentName", development.trim());
    fd.set("coverImagePath", coverPath ?? "");
```

- [ ] **Step 4: Add the upload handler**

Add this function inside the component (before `return`):

```tsx
  async function onPickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const res = await uploadProjectCover({ file, projectId: project.id });
    setUploading(false);
    if (res.ok) setCoverPath(res.storagePath);
    else setError(res.error);
  }
```

- [ ] **Step 5: Add the two form fields**

Inside the `<div className="grid gap-2 sm:grid-cols-2">`, after the "Target serah terima" label block, add:

```tsx
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Pengembangan</span>
              <input
                value={development}
                onChange={(e) => setDevelopment(e.target.value)}
                list="datum-developments"
                disabled={pending}
                maxLength={120}
                placeholder="mis. Bukit Darmo Golf"
                className="rounded border border-[var(--border)] px-2 py-1.5 text-sm"
              />
              <datalist id="datum-developments">
                {developments.map((d) => <option key={d.id} value={d.name} />)}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Sampul (cover)</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onPickCover} disabled={pending || uploading} className="text-xs" />
              {uploading ? <span className="text-[10px] text-[var(--text-muted)]">Mengunggah…</span> : null}
              {coverPath ? (
                <button type="button" onClick={() => setCoverPath(null)} className="self-start text-[10px] font-medium text-[var(--flag-critical)] hover:underline">
                  Hapus sampul
                </button>
              ) : null}
            </label>
```

- [ ] **Step 6: Verify it typechecks** (also resolves Task 9's `ProjectCard`)

Run: `pnpm --filter web typecheck`
Expected: PASS — `ProjectCard` and `ProjectEditDialog` now agree on props.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/projects/ProjectEditDialog.tsx
git commit -m "feat(web): edit dialog gains development combobox + cover upload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Rewrite `ProjectsList` (toolbar + grouped grid + collapse + deep-link)

**Files:**
- Modify: `apps/web/components/projects/ProjectsList.tsx`

- [ ] **Step 1: Replace the file contents**

Overwrite `apps/web/components/projects/ProjectsList.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useProjects } from "@/lib/query/hooks";
import type { ProjectListItem, DevelopmentOption } from "@/lib/projects/queries";
import { filterProjects, groupProjects } from "@/lib/projects/grouping";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { SearchIcon } from "@/components/icons/Icon";

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "design", label: "Desain" },
  { value: "construction", label: "Konstruksi" },
  { value: "finishing", label: "Finishing" },
  { value: "handover", label: "Serah terima" },
  { value: "closed", label: "Selesai" },
];

export function ProjectsList({
  initialProjects, developments,
}: { initialProjects: ProjectListItem[]; developments: DevelopmentOption[] }) {
  const { data: projects } = useProjects(initialProjects);
  const list = projects ?? initialProjects;

  const params = useSearchParams();
  const devFilter = params.get("dev");

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    let scoped = list;
    if (devFilter) scoped = scoped.filter((p) => p.development_id === devFilter);
    return groupProjects(filterProjects(scoped, { query, status }));
  }, [list, devFilter, query, status]);

  const total = groups.reduce((n, g) => n + g.projects.length, 0);

  return (
    <section className="grid gap-3">
      <div className="sticky top-0 z-10 -mx-1 grid gap-2 bg-[#DAD6C9]/95 px-1 py-2 backdrop-blur">
        <div className="flex items-center gap-2 rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] px-3 py-2">
          <SearchIcon size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari proyek, klien, atau lokasi…"
            aria-label="Cari proyek"
            className="w-full bg-transparent text-sm text-[#141210] outline-none placeholder:text-[#847E78]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              aria-pressed={status === f.value}
              className={`rounded-[6px] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${
                status === f.value
                  ? "bg-[#141210] text-[#FDFAF6]"
                  : "border border-[#B5AFA8] bg-[#FDFAF6] text-[#524E49] hover:border-[#7A6B56]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-[8px] border border-dashed border-[#B5AFA8] p-6 text-sm text-[#524E49]">
          Tidak ada proyek yang cocok dengan filter.
        </div>
      ) : (
        groups.map((g) => {
          const key = g.id ?? "__ungrouped__";
          const isCollapsed = collapsed[key] ?? false;
          return (
            <div key={key} className="overflow-hidden rounded-[8px] border border-[#B5AFA8] bg-[#EFEADF]">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center justify-between bg-[#141210] px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[#FDFAF6]"
              >
                <span>{isCollapsed ? "▸" : "▾"} {g.name} · {g.projects.length}</span>
                {g.area_label ? <span className="font-medium text-[#B5AFA8]">{g.area_label}</span> : null}
              </button>
              {!isCollapsed ? (
                <div className="grid gap-2.5 p-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
                  {g.projects.map((p) => (
                    <ProjectCard key={p.id} project={p} developments={developments} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 3: Run the full web unit suite**

Run: `pnpm --filter web test`
Expected: PASS (existing tests + the new grouping/tint/cover tests).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/projects/ProjectsList.tsx
git commit -m "feat(web): grouped cover-card grid with filter, status chips, collapse, deep-link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Wire the landing page (`page.tsx`)

**Files:**
- Modify: `apps/web/app/(app)/page.tsx`

- [ ] **Step 1: Import and fetch developments**

In `apps/web/app/(app)/page.tsx`, update the import from queries and fetch developments alongside projects:

```tsx
import { getProjectsList, getDevelopments } from "@/lib/projects/queries";
```

After the `projects` fetch block, add:

```tsx
  const developments = await getDevelopments(supabase);
```

- [ ] **Step 2: Update the count copy**

Change the count paragraph (currently `{projects.length} proyek aktif. …`) to include the development count:

```tsx
          {projects.length} proyek aktif · {developments.length} pengembangan. Klik salah satu untuk melihat semua kartu per topik, timeline keputusan, dan bertanya pada asisten.
```

- [ ] **Step 3: Pass developments to the list**

Change `<ProjectsList initialProjects={projects} />` to:

```tsx
      <ProjectsList initialProjects={projects} developments={developments} />
```

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(app)/page.tsx"
git commit -m "feat(web): landing page passes developments + shows group count

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Search — development tier results + reorder

**Files:**
- Modify: `apps/web/lib/search/queries.ts`
- Test: `apps/web/tests/unit/search-queries.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing describe blocks)

Add to `apps/web/tests/unit/search-queries.test.ts`. First extend the `clientReturning` mock so it can also return developments, then add a test. Replace the existing `clientReturning` with a version that accepts a `developments` array:

```ts
function clientReturning(projects: unknown[], developments: unknown[] = []) {
  const builder: any = {
    select: () => builder, or: () => builder, ilike: () => builder,
    is: () => builder, contains: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    from(table: string) {
      if (table === "projects") {
        const pb: any = { select: () => pb, or: () => pb, limit: () => Promise.resolve({ data: projects, error: null }) };
        return pb;
      }
      if (table === "developments") {
        const db: any = { select: () => db, ilike: () => db, limit: () => Promise.resolve({ data: developments, error: null }) };
        return db;
      }
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
}
```

Then add:

```ts
describe("searchAll developments tier", () => {
  it("returns matching developments as tier hits", async () => {
    const supabase = clientReturning([], [
      { id: "d1", name: "Citraland", area_label: "Surabaya Barat" },
    ]);
    const res = await searchAll(supabase, "citra");
    expect(res.developments).toHaveLength(1);
    const hit = res.developments[0]!;
    expect(hit.kind).toBe("development");
    expect(hit.href).toBe("/?dev=d1");
    expect(hit.cardTitle).toBe("Citraland");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/search-queries.test.ts`
Expected: FAIL — `res.developments` is undefined / `"development"` not assignable to `kind`.

- [ ] **Step 3: Implement the tier query**

In `apps/web/lib/search/queries.ts`:

(a) Add `"development"` to the `SearchHit["kind"]` union:

```ts
  kind: "card" | "event" | "comment" | "project" | "development";
```

(b) Change the return type and the early-return to include `developments`:

```ts
): Promise<{ developments: SearchHit[]; projects: SearchHit[]; cards: SearchHit[]; events: SearchHit[]; comments: SearchHit[] }> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return { developments: [], projects: [], cards: [], events: [], comments: [] };
  }
```

(c) After computing `pattern` and before the projects query, add the developments query:

```ts
  const { data: devRows } = await supabase
    .from("developments")
    .select("id, name, area_label")
    .ilike("name", pattern)
    .limit(PER_GROUP);

  const developments: SearchHit[] = (devRows ?? []).map((d) => ({
    id: `d_${d.id}`,
    kind: "development" as const,
    projectCode: "",
    cardSlug: "",
    cardTitle: d.name,
    snippet: d.area_label ?? "",
    href: `/?dev=${d.id}`,
    occurredAt: "",
  }));
```

(d) Add `developments` to the final `return { ... }`:

```ts
  return { developments, projects, cards, events: eventHits, comments };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/unit/search-queries.test.ts`
Expected: PASS (existing project test + new development tier test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/queries.ts apps/web/tests/unit/search-queries.test.ts
git commit -m "feat(web): search returns development tier hits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Search page — render tier first, reorder groups

**Files:**
- Modify: `apps/web/app/(app)/search/page.tsx`

- [ ] **Step 1: Add the development kind to the label/color maps + total**

In `apps/web/app/(app)/search/page.tsx`:

Add to `KIND_LABEL`:

```ts
  development: "Pengembangan",
```

Add to `KIND_COLOR`:

```ts
  development: "bg-[var(--sand)]/30 text-[var(--sand-dark)]",
```

Update the `total` calculation to include developments:

```ts
  const total = results.developments.length + results.projects.length + results.cards.length + results.events.length + results.comments.length;
```

- [ ] **Step 2: Reorder the rendered groups**

Change the array passed to `.map(...)` so developments and projects lead:

```ts
      {[
        { label: "Pengembangan", items: results.developments },
        { label: "Proyek", items: results.projects },
        { label: "Kartu", items: results.cards },
        { label: "Aktivitas", items: results.events },
        { label: "Komentar", items: results.comments },
      ].map(({ label, items }) =>
```

- [ ] **Step 3: Verify typecheck + full suites**

Run: `pnpm --filter web typecheck && pnpm --filter web test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/search/page.tsx"
git commit -m "feat(web): search page leads with development tier, then boards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Typecheck both packages**

Run: `pnpm --filter web typecheck && pnpm --filter @datum/db typecheck`
Expected: PASS.

- [ ] **Step 2: Run all unit tests**

Run: `pnpm --filter web test && pnpm --filter @datum/db test`
Expected: PASS, including new tests: `project-cover`, `project-tint`, `project-grouping`, `derive-development`, `search-queries`.

- [ ] **Step 3: Lint web**

Run: `pnpm --filter web lint`
Expected: PASS (no new errors).

- [ ] **Step 4: Manual smoke in the dev server** (use the preview tooling)

Start the dev server and verify on the landing page:
- Projects render as cover cards grouped under near-black development headers; counts match.
- Typing in the filter narrows cards live; status chips filter; collapsing a group hides its grid.
- Editing a project: the "Pengembangan" combobox lists existing groups, typing a new one creates it on save, and uploading a cover replaces the fallback tint after save.
- `/search?q=citra` shows a "Pengembangan" group first; clicking it lands on `/?dev=<id>` filtered to that development.
- Reassigning the Bdg-coded projects to "Bukit Darmo Golf" merges them; the now-empty "Bdg" group disappears.

- [ ] **Step 5: Final no-op commit guard**

Run: `git status`
Expected: clean working tree (everything already committed task-by-task).

---

## Notes for the implementer

- **Task ordering matters for typecheck:** `ProjectCard` (Task 9) references the new `ProjectEditDialog` props, which only land in Task 11. The intermediate commit in Task 9 is intentional; the first green typecheck across both is at the end of Task 11. (Task 9's own verification is its vitest test, not a typecheck, so no step fails.) If your workflow requires every commit to compile, do Task 11 before Task 9 — they are otherwise independent.
- **`useSearchParams` + Suspense:** `ProjectsList` (Task 12) calls `useSearchParams()`. The landing route is already dynamic (it reads auth cookies via Supabase in `page.tsx`), so no Suspense boundary is required. If `pnpm --filter web build` ever complains that `useSearchParams()` must be wrapped in a Suspense boundary, wrap `<ProjectsList .../>` in `<Suspense fallback={null}>…</Suspense>` in `page.tsx` (import `Suspense` from `react`).
- **Live DB:** Task 1 pushes to the linked Supabase project and Task 3 seeds it. There is no local DB in this workflow. Run them in order and only once.
- **Bahasa-first:** every new visible string is already in Bahasa Indonesia — keep it that way for any additions.
- **Brand:** covers sit on top, text on the warm-white body below; fallback tints are flat (no gradients). Don't introduce cold grays or pure black/white.
```
