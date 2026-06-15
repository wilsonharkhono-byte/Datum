# Landing redesign (Trello-style grouped cards) + grouping-aware search

Date: 2026-06-15
Status: Approved design, pending implementation plan

## Problem

The project picker (`apps/web/app/(app)/page.tsx` → `components/projects/ProjectsList.tsx`)
renders all ~66 active projects as one flat, alphabetical list. It is a long scroll,
hard to scan, and gives no way to find a project quickly. Wilson compared it
unfavourably to Trello, where boards are grouped, dense, and visually identifiable by
their cover render.

Separately, `/search` returns project, card, event, and comment hits but does not help
the user land on the right **board** — there is no notion of the development/area group a
project belongs to, and detail hits (cards/events/comments) crowd out board hits.

## Goals

1. Make the landing page scannable: group projects by **development**, with an instant
   filter and status chips, presented as compact **cover cards** in a responsive grid.
2. Let projects carry a **cover image** (Trello-style) for fast recognition, with a
   brand-safe fallback for the projects that have none.
3. Make grouping **stored and user-editable** — Wilson curates which development each
   project belongs to; no code parser is the source of truth.
4. Make search **grouping-aware**: surface a development ("tier") result, then boards,
   then cards, then collapsible activity/comment detail.

## Non-goals (deferred)

- Full group-manager screen (rename / reorder / merge UI) and Trello-style drag-and-drop
  of cards between groups. Merging is achieved by reassigning projects; empty groups
  auto-hide.
- Auto-importing cover images from Trello board backgrounds.
- A layout toggle (Opsi B / card grid is the chosen layout).
- Changing the status taxonomy or any card-level behaviour.

## Key decisions (from brainstorming)

- **"Tier" = development/area group.** Same concept powers landing grouping and the search
  tier. It is **stored data**, not derived at runtime.
- A code parser (`deriveDevelopment`) is used **only once**, by a seed script, to make a
  best-guess first pass so Wilson corrects rather than assigns from scratch. After seeding,
  `projects.development_id` is the only source of truth.
- Grouping is edited via a **combobox in the existing project edit dialog** (pick existing
  or type-to-create). No separate manager.
- Cover bucket is **public** (unguessable UUID paths) to avoid 66 signed-URL round-trips on
  landing load; covers are non-confidential renders. Tradeoff accepted.

## Data model

One migration: `packages/db/supabase/migrations/20260615000004_developments_and_project_covers.sql`
(next number after the current latest `20260615000003`).

### `developments` table
```
id          uuid primary key default gen_random_uuid()
name        text not null
area_label  text                       -- optional, e.g. "Surabaya Barat"
sort_order  int  not null default 100
created_at  timestamptz not null default now()
```
- Case-insensitive uniqueness on name: `create unique index developments_name_lower_idx on developments (lower(name));`
- RLS (mirror `20260605000001_projects_and_areas_write_rls.sql`):
  - SELECT: any authenticated staff.
  - INSERT/UPDATE/DELETE: principal/admin only (the predicate used by
    `current_can_manage_*` / matching `canManageAccess`).

### `projects` new columns
```
development_id   uuid references developments(id) on delete set null
cover_image_path text
```
- `on delete set null` so deleting a development un-groups its projects rather than
  cascading.

### Storage
- New **public** bucket `project-covers` (insert into `storage.buckets`, mirror
  `card-attachments` policies but make objects publicly readable; restrict writes to
  authenticated principal/admin).
- `apps/web/next.config.ts`: add a `remotePatterns` entry for
  `/storage/v1/object/public/project-covers/**` (the existing entry only allows the signed
  `/object/sign/**` path).

## Development derivation + seed

`packages/db/scripts/seed-developments.ts` (idempotent, run once; sibling to existing
import/seed scripts):

1. Load all projects (`id, project_code, project_name`).
2. For each, compute a development label with a pure helper `deriveDevelopment(project)`:
   - Start from `project_name` (the title-cased site, e.g. "Citraland E7-20").
   - Drop trailing unit token(s) — tokens containing a digit or slash
     (reuse the `looksLikeUnit` idea from `trello-normalize.ts`).
   - Apply an **alias map** for known abbreviations/mergers, seeded with:
     `BDG → Bukit Darmo Golf` (and others added as discovered).
3. Upsert `developments` by `lower(name)`; assign `development_id` on each project.
4. Leave `sort_order` default; `area_label` null (Wilson can seed later).

The helper lives where the seed can import it (e.g. `packages/db/scripts/lib/derive-development.ts`)
and is unit-tested alongside the other `scripts/lib/__tests__` tests. It is **not** used at
runtime.

## Server / query layer

- `apps/web/lib/projects/queries.ts`
  - Extend `ProjectListItem` with `development_id`, `development_name`, `development_area_label`,
    `development_sort_order`, `cover_image_path`, `cover_url` (derived public URL).
  - `getProjectsList` selects the new columns and joins `developments:development_id
    (id, name, area_label, sort_order)`. Compute `cover_url` from `cover_image_path` via the
    public bucket URL. Keep ordering deterministic.
  - Add `getDevelopments(supabase)` → `{ id, name, area_label, sort_order }[]` ordered by
    `sort_order, name`, for the combobox.
- `apps/web/app/api/projects/route.ts` — return the same enriched shape (consumed by
  `useProjects`). The React Query shape (`ProjectListItem[]`) and `keys.projects()` stay.
- `apps/web/lib/projects/mutations.ts`
  - `updateProject`: accept `coverImagePath` (nullable) and a development assignment.
    Development is passed as a **name** (`developmentName`): server does case-insensitive
    get-or-create against `developments`, then sets `development_id`. Empty string clears
    grouping (sets null). Keep the `canManageAccess` gate. Continue `revalidatePath("/")`.
  - Cover upload uses the browser Supabase client (mirror
    `lib/cards/upload.ts`) into `project-covers` at path `${projectId}/${uuid}-${safeName}`;
    the resulting path is submitted as `coverImagePath`.

## Landing page (Opsi B)

`components/projects/ProjectsList.tsx` (client component, already React-Query backed) is
rewritten to:

- **Toolbar** (sticky): a text filter input (`Cari proyek, klien, atau lokasi…`) filtering
  client-side across `project_code`, `project_name`, `client_name`, `location`; and status
  chips (`Semua / Desain / Konstruksi / Finishing / Serah terima / Selesai`). All
  client-side state.
- **Grouping**: bucket the filtered list by `development_id`. Render each group under the
  signature near-black **header bar** (`{name} · {count}`, optional `area_label` on the
  right), collapsible. Ungrouped projects go under a `Belum dikelompokkan` header. Groups
  ordered by `sort_order, name`; ungrouped last. Hide groups with zero (filtered) members.
- **Cover card** (grid `repeat(auto-fit, minmax(~200px, 1fr))`, 3-up desktop / 2 / 1):
  - Top: cover band. If `cover_url`, `<Image>` cover (object-fit: cover). Else a flat tint
    fill keyed deterministically to the development name (hash → warm palette stop), with the
    unit code shown large. No gradients.
  - Body (warm-white): `project_code` (bold uppercase), `project_name`, `Client: …`, status
    chip (tinted background + matched darker text per brand). Text never overlaps the cover.
  - Whole card links to `/project/{project_code}`; the edit affordance stays
    (`ProjectEditDialog`).
- **Deep-link filter**: read a `?dev={id}` (or `?group=`) search param to pre-filter to one
  development (used by the search tier link). Clearing the filter removes the param.
- **States** (Bahasa): no projects, no filter matches, error — reuse existing copy/treatment.

The header section in `page.tsx` (eyebrow, title, count, action chips, draft-review banner)
is preserved; only the count line may gain `· {n} pengembangan`.

## Edit dialog

`components/projects/ProjectEditDialog.tsx` gains two fields:
- **Pengembangan** combobox: an `<input list>` (datalist of existing development names) or a
  lightweight pick/type control. Submits `developmentName`. Type-new creates on save.
- **Cover**: file picker (image/*) → upload to `project-covers` → submit `coverImagePath`;
  show current cover thumbnail + a remove option (submits empty `coverImagePath`).
The dialog's local `Project` type and the submit `FormData` are extended accordingly; it
keeps invalidating `keys.projects()` and `router.refresh()`.

## Search (`/search`)

`apps/web/lib/search/queries.ts` and `app/(app)/search/page.tsx`:
- Add a **development (tier)** result group, computed by matching `developments.name ilike`
  the query (and/or the developments of matched projects). Each tier hit shows
  `{name} · {n} proyek` and links to `/?dev={id}` (the pre-filtered landing page).
- Result order becomes: **Pengembangan → Proyek (papan) → Kartu → Aktivitas → Komentar**.
  Activity and comment groups render below and are collapsible so board/card hits lead.
- `SearchHit` gains a `development` kind (or a parallel tier list); `KIND_LABEL` /
  `KIND_COLOR` updated. Existing project/card/event/comment logic is unchanged otherwise.

## Testing

- Unit: `deriveDevelopment` (incl. `BDG → Bukit Darmo Golf`, trailing-unit stripping,
  multi-word developments) in `packages/db/scripts/lib/__tests__`.
- Unit: extend `apps/web/tests/unit/search-queries.test.ts` for the development/tier hit and
  ordering.
- Component/logic: landing grouping + filter + status-chip filtering (pure grouping/filter
  helpers extracted so they are testable without the DOM).
- E2E (optional, follow existing `tests/e2e` patterns): filter narrows the grid; a tier
  search result deep-links to the filtered landing page.

## File-by-file change list

- `packages/db/supabase/migrations/20260615000004_developments_and_project_covers.sql` — new
- `packages/db/scripts/lib/derive-development.ts` — new (+ test)
- `packages/db/scripts/seed-developments.ts` — new
- `packages/db/src/types.generated.ts` — regenerate after migration
- `apps/web/next.config.ts` — add public cover remotePattern
- `apps/web/lib/projects/queries.ts` — enrich list + `getDevelopments`
- `apps/web/lib/projects/mutations.ts` — cover + development on `updateProject`
- `apps/web/lib/projects/cover-upload.ts` — new (mirror `lib/cards/upload.ts`)
- `apps/web/app/api/projects/route.ts` — enriched shape
- `apps/web/components/projects/ProjectsList.tsx` — grouped cover-card grid + toolbar
- `apps/web/components/projects/ProjectCard.tsx` — new (cover + fallback tint + body)
- `apps/web/components/projects/ProjectEditDialog.tsx` — development combobox + cover field
- `apps/web/app/(app)/page.tsx` — pass developments; minor count copy; read `?dev=`
- `apps/web/lib/search/queries.ts` + `app/(app)/search/page.tsx` — tier results + reorder

## Assumptions / open details

- `canManageAccess` (principal/admin) is the correct write gate for developments and covers
  — consistent with project edits.
- Public cover bucket is acceptable for non-confidential renders; revisit if any project
  cover is sensitive.
- Default development granularity: `Citraland Nusa Golf` seeds as its own group unless the
  alias map merges it; Wilson re-groups freely after seeding.
- Deep-link param name (`?dev=` vs `?group=`) is an implementation detail; pick one and use
  it consistently between search and landing.
