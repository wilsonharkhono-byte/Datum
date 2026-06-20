# Global Search — Mobile Design Spec

Slice: `search` · Date: 2026-06-20 · Status: design (no code)

Native mobile parity for DATUM's tiered global search (developments / projects /
cards / events / comments / attachments). Grounded in the real web search route
(`apps/web/app/(app)/search/page.tsx`), the search query layer
(`apps/web/lib/search/queries.ts`), its unit tests
(`apps/web/tests/unit/search-queries.test.ts`), the foundation spec
(`docs/superpowers/specs/2026-06-20-mobile-foundation-design.md`), and the search-tier
design (`docs/superpowers/specs/2026-06-15-landing-redesign-and-search-tiers-design.md`).
This slice **inherits all shared plumbing from `foundation`** (the `@datum/core`
package, query keys/persister, NativeWind tokens, Expo Router skeleton,
`useSession`/role helpers) and only designs the search experience plus the one
core extraction it needs.

---

## 1. Goal & scope

Deliver a native Search screen that reaches **full parity** with web `/search`:

1. A debounced query input that runs a **single multi-group search** across six
   kinds: **Pengembangan** (developments / tier), **Proyek** (projects),
   **Kartu** (cards), **Aktivitas** (events), **Komentar** (comments),
   **Lampiran** (attachments) — exactly the groups web returns from `searchAll`.
2. **Grouped, ordered results** matching web's render order and per-group caps,
   with a kind badge, project code, title, and a snippet window.
3. **Tap-through navigation** that lands on the native analogue of each web `href`
   (board, card detail, or the development-filtered landing).
4. Indonesian-first copy, mirroring web's exact Bahasa strings.
5. RLS-scoped results identical to web (same anon client + JWT), including the
   cost-sensitive **attachment caption** tier that RLS hides from non-cost roles.

**In scope:** the Search screen, its debounced input, grouping/rendering, the
`@datum/core` extraction of `searchAll` + `SearchHit`, react-query wiring, and
navigation mapping.

**Out of scope:** any change to search *ranking* or new full-text indexes;
per-group "show more" pagination beyond web's fixed `PER_GROUP` caps (web does not
paginate — neither does mobile in v1); the assistant/RAG retrieval path
(separate `assistant` slice); the `?dev=` landing filter UI itself (owned by the
`landing` slice — search only links into it); any DB migration.

---

## 2. Web behavior mirrored — exact files & functions

Everything below is read from the real tree; nothing invented.

### 2.1 `apps/web/lib/search/queries.ts`
- `searchAll(supabase: SupabaseClient<Database>, q: string)` →
  `{ developments, projects, cards, events, comments, attachments }`, each a
  `SearchHit[]`.
- `SearchHit` =
  `{ id; kind: "card"|"event"|"comment"|"project"|"development"|"attachment"; projectCode; cardSlug; cardTitle; snippet; href; occurredAt }`.
- **Min query length:** `trimmed.length < 2` → returns all-empty groups (the
  `< 2` short-circuit is the contract the mobile debounce must respect).
- **Per-group cap:** `const PER_GROUP = 25`. Events query fetches `PER_GROUP * 2`
  then dedups by id and caps at `PER_GROUP`.
- **Like-escaping:** `pattern = `%${trimmed.replace(/[%_]/g, m => `\\${m}`)}%`` —
  escapes `%`/`_`. For the events `.or()` it additionally strips `,()` and uses a
  `*term*` PostgREST pattern.
- **Per-group queries (the exact shapes mobile reuses byte-for-byte via core):**
  - `developments`: `.from("developments").select("id, name, area_label").ilike("name", pattern)`.
    Hit `href = /?dev=${d.id}`, `cardTitle = d.name`, `snippet = area_label`.
  - `projects`: `.from("projects").select("id, project_code, project_name, client_name, location").or("project_name.ilike…,client_name.ilike…,site_address.ilike…")`.
    Hit `cardTitle = `${code} · ${name}``, `href = /project/${project_code}`.
    **BUG to carry/flag (see §9):** the `select` pulls `location` but the `.or()`
    filters on `site_address`, and the `snippet` joins `client_name` + `location`.
  - `cards`: `.from("cards").select("id, slug, title, current_summary, created_at, projects:project_id (project_code)").or("title.ilike…,current_summary.ilike…")`.
    `href = /project/${code}/cards/${slug}`.
  - `events`: `.from("card_events").select("id, event_kind, payload, occurred_at, cards:card_id (slug, title, projects:project_id (project_code))")` with an
    `.or()` over payload text fields
    `["body","description","topic","request_text","what","notes","title","caption"]`
    (`payload->>field.ilike.*term*`). Dedups by id; **drops rows whose
    `cards.projects` is null**; snippet `[${event_kind}] ${highlight(JSON.stringify(payload))}.slice(0,180)`.
  - `comments`: `.from("card_comments").select("…cards:card_id (slug, title, projects:…)").ilike("body", pattern).is("deleted_at", null)` — excludes soft-deleted.
  - `attachments`: `.from("card_attachments").select("id, ai_caption, mime_type, card_events:card_event_id ( cards:card_id ( slug, title, projects:project_id ( project_code ) ) )").ilike("ai_caption", pattern)` — RLS-scoped so captions never reach non-cost roles. Drops rows missing card/code/caption.
- `highlight(text, q)`: returns a substring window (idx − 40 … idx + len + 100)
  with leading/trailing `…`; falls back to `text.slice(0, 180)` when no match.
  Pure, isomorphic.

### 2.2 `apps/web/app/(app)/search/page.tsx` (server component)
- Reads `searchParams.q`; runs `searchAll` only when `q.trim().length >= 2`,
  else returns the all-empty groups object inline.
- `total` = sum of all six group lengths.
- `KIND_LABEL` (Bahasa): `development→"Pengembangan"`, `project→"Proyek"`,
  `card→"Kartu"`, `event→"Aktivitas"`, `comment→"Komentar"`, `attachment→"Lampiran"`.
- `KIND_COLOR`: token-driven backgrounds/text per kind (sand / flag-ok / surface
  tints) — mobile maps these to the shared SANO tokens.
- **Render order** (the section list literal):
  `Pengembangan → Proyek → Kartu → Aktivitas → Komentar → Lampiran`. Empty groups
  render nothing (`items.length === 0 ? null`).
- **States** (verbatim Bahasa copy mobile reuses):
  - q empty: heading "Ketik di kotak di atas untuk mencari kartu, aktivitas, atau
    komentar." + sub "Pencarian berbasis teks di seluruh proyek yang Anda akses."
  - total 0: "Tidak ada hasil untuk “{q}”." + "Coba kata kunci yang
    lebih pendek atau cek ejaan."
  - results: "{total} hasil ditemukan"; per-section header "{label} ({count})".
  - card line fallback title: "(tanpa judul)".
- Page copy: back link "← Beranda", title "Cari", lede "Pencarian teks di
  seluruh proyek — proyek, kartu, aktivitas, komentar."

### 2.3 `apps/web/components/search/SearchBox.tsx` (client)
- Controlled `<input type="search">`, placeholder
  "Cari kartu, aktivitas, komentar…", `minLength={2}`.
- On submit: `if (trimmed.length < 2) return;` then
  `router.push(`/search?q=${encodeURIComponent(trimmed)}`)`. **Web is
  submit-driven (URL-param), not debounced-as-you-type.** Mobile improves this to
  debounced live search (LOCKED requirement of this slice) while preserving the
  `>= 2` gate.

### 2.4 `apps/web/tests/unit/search-queries.test.ts`
- Mocks a chainable Supabase builder; asserts:
  - `projects` group: a project row → one `project` hit with
    `projectCode = "ARIN-KARAWANG"`, `href = "/project/ARIN-KARAWANG"`.
  - `attachments` group: an `ai_caption` row → one `attachment` hit,
    `projectCode = "ARIN"`, `href = "/project/ARIN/cards/master-bath"`,
    `snippet` contains "Statuario".
  - `developments` tier: a development row → one `development` hit,
    `href = "/?dev=d1"`, `cardTitle = "Citraland"`.
- These tests must keep passing after the strangler move (see §3, §10) — the web
  file re-exports from core, so `import { searchAll } from "@/lib/search/queries"`
  resolves to the core implementation unchanged.

---

## 3. `@datum/core` surface to extract

`searchAll` is **already isomorphic** — its only signature is
`(supabase: SupabaseClient<Database>, q: string)`, it imports nothing from
`next/*`/`server-only`/React, and `highlight` is a pure string helper. This makes
it a clean, low-risk strangler move (the same template foundation used for
`getProjectsList`).

### 3.1 Module to create
```
packages/core/src/search/queries.ts   # searchAll + SearchHit + (internal) highlight
```
Add to the core barrel `packages/core/src/index.ts`:
`export { searchAll } from "./search/queries"; export type { SearchHit } from "./search/queries";`

### 3.2 Signatures (moved verbatim from `apps/web/lib/search/queries.ts`)
```ts
// core/search/queries.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type SearchHit = {
  id: string;
  kind: "card" | "event" | "comment" | "project" | "development" | "attachment";
  projectCode: string;
  cardSlug: string;
  cardTitle: string;
  snippet: string;
  href: string;          // web-shaped path; mobile remaps to Expo routes (§4.4)
  occurredAt: string;
};

export type SearchResults = {
  developments: SearchHit[]; projects: SearchHit[]; cards: SearchHit[];
  events: SearchHit[]; comments: SearchHit[]; attachments: SearchHit[];
};

export async function searchAll(
  supabase: SupabaseClient<Database>,
  q: string,
): Promise<SearchResults>;

// internal, not exported (pure):
// function highlight(text: string, q: string): string;
```
> The function body moves **byte-identical** (queries, `PER_GROUP`, like-escaping,
> event dedup, RLS-scoped attachment join, `highlight` window). The only addition
> is naming the return type `SearchResults` so both apps share it; web's inline
> object type is structurally identical.

### 3.3 Strangler step (repoint web)
`apps/web/lib/search/queries.ts` becomes a thin re-export:
```ts
export { searchAll } from "@datum/core";
export type { SearchHit } from "@datum/core";
// (optionally) export type { SearchResults } from "@datum/core";
```
- `app/(app)/search/page.tsx` keeps `import { searchAll, type SearchHit } from "@/lib/search/queries"` unchanged.
- `apps/web/tests/unit/search-queries.test.ts` keeps `import { searchAll } from "@/lib/search/queries"` unchanged → it now exercises the core impl.
- **Verify:** `pnpm --filter web typecheck && pnpm --filter web test` stay green;
  `/search` behaves identically.

### 3.4 Mobile consumption
Mobile imports `searchAll` directly from `@datum/core` with the anon `supabase`
singleton (`apps/mobile/lib/supabase/client.ts`); RLS enforces auth. No `/api`
hop — web's `/search` is a server component (no API route), so mobile gains the
same single-round-trip path natively.

### 3.5 Query keys (shared)
Add a `search` key to the shared factory in `@datum/core` (foundation owns
`core/query/keys.ts`, moved from `apps/web/lib/query/keys.ts`):
```ts
// core/query/keys.ts (extend existing { board, projects, card })
search: (q: string) => ["search", q] as const,
```
`search` is **not** added to `PERSISTED_KEY_ROOTS` (search results are transient,
RLS- and time-sensitive, and would bloat the offline cache — see §8). Both web and
mobile may adopt this key; web's server-component page does not currently use
react-query for search, so this is mobile-driving and web-compatible.

---

## 4. Mobile screens — Expo Router + NativeWind

### 4.1 Route (from the foundation parity map)
`apps/mobile/app/(tabs)/(matrix)/search.tsx` — web #16 `/search`, pushed within the
**Matrix** stack from the landing header, and also linked from **More** so it is
never buried (per foundation §4). `typedRoutes` is on; the route must compile.

Optional entry param: `search?q=...` (so a deep link or "search this" affordance
can preseed the box). The screen reads `useLocalSearchParams<{ q?: string }>()` to
initialize input state, mirroring web reading `searchParams.q`.

### 4.2 Component tree (NativeWind, token-driven from foundation `ui/`)
- `<Screen>` (safe-area + oat background) wrapping a fixed header + a `SectionList`.
- **`SearchInput`** (this slice; built on foundation primitives): a token-styled
  `TextInput` (`type=search` analogue) with:
  - placeholder "Cari kartu, aktivitas, komentar…" (web-verbatim).
  - `autoFocus`, `returnKeyType="search"`, `clearButtonMode="while-editing"`
    (iOS) / a trailing clear `Pressable` (Android), 44dp min touch target
    (foundation `Button`/touch rule).
  - debounced `onChangeText` (§5).
  - a trailing spinner while `isFetching` (subtle, reduced-motion aware).
- **Results: `SectionList`** with one section per non-empty group, in the
  web order **Pengembangan → Proyek → Kartu → Aktivitas → Komentar → Lampiran**.
  - `renderSectionHeader`: foundation `Text` styled as web's section header —
    uppercase, tracked, muted: "{label} ({count})".
  - `renderItem`: **`SearchResultRow`** (this slice) = foundation `Card` with:
    - top row: a `Badge` whose color maps the web `KIND_COLOR` for that `kind`
      (development/project → sand; card → flag-ok; event/comment → surface tint;
      attachment → sand) showing `KIND_LABEL[kind]`; right-aligned muted
      `projectCode`.
    - title: `cardTitle || "(tanpa judul)"` (web-verbatim fallback).
    - snippet: muted small text = `hit.snippet`.
  - `keyExtractor`: `hit.id` (web's ids are already prefixed `d_/p_/c_/e_/co_/a_`,
    so they are globally unique across groups → safe for one `SectionList`).
  - Tap → navigate per §4.4.
- A `total` summary line above the list: "{total} hasil ditemukan" (web-verbatim),
  where `total` sums all six group lengths (same as web).

### 4.3 Every state (Bahasa, web-verbatim where web has copy)
- **Idle / query length 0:** `EmptyState` — "Ketik di kotak di atas untuk mencari
  kartu, aktivitas, atau komentar." + sub "Pencarian berbasis teks di seluruh
  proyek yang Anda akses." (Reuse web's exact strings.)
- **Query 1 char (below the `>= 2` gate):** same idle treatment, no query fired
  (debounce + gate both suppress it); optional hint "Ketik minimal 2 huruf."
  (mobile-only nicety — add to `messages/{id,en}.json`, see §6).
- **Loading (query `>= 2`, fetching, no prior data):** `Skeleton` rows (3–5
  placeholder `Card`s) mirroring foundation/web `.skeleton` pulse; the input's
  trailing spinner also shows. On a *refetch* with existing results, keep results
  visible and show only the inline spinner (react-query `keepPreviousData`, §5).
- **Empty results (`total === 0`):** `EmptyState` — "Tidak ada hasil untuk
  “{q}”." + "Coba kata kunci yang lebih pendek atau cek ejaan."
  (web-verbatim).
- **Error:** `ErrorState` with retry — "Gagal mencari: {message}" (new key,
  consistent with foundation's "Gagal memuat…" pattern) + a "Coba lagi" button
  invoking `refetch()`.
- **Offline:** `OfflineBanner` at top (foundation). Because search is **not
  persisted** (§8), an offline cold query shows the offline `EmptyState`
  ("Pencarian butuh koneksi." — new key) rather than stale results; a query
  already in memory from this session still renders. Reconnect refetches.

### 4.4 Navigation mapping (web `href` → Expo route)
`searchAll` returns web-shaped `href` strings. Mobile maps by `kind` to the
foundation route tree (do **not** parse the raw `href`; switch on `kind` +
`projectCode`/`cardSlug`):

| kind | web href | mobile route |
|---|---|---|
| development | `/?dev=${id}` | `/(tabs)/(matrix)/` (landing) with `?dev=${id}` param → handled by `landing` slice |
| project | `/project/${code}` | `/(tabs)/(matrix)/project/${code}` (board) |
| card | `/project/${code}/cards/${slug}` | `/(tabs)/(matrix)/project/${code}/card/${slug}` |
| event | `/project/${code}/cards/${slug}` | same as card (event lives on a card) |
| comment | `/project/${code}/cards/${slug}` (or `#` if no slug) | card route; if no `cardSlug`, row is non-tappable |
| attachment | `/project/${code}/cards/${slug}` | card route |

The development tier id is recoverable from `hit.id` (`d_${id}`) or by stripping
the `?dev=` query of `href`; prefer `hit.id.slice(2)`. The card-detail route is
`card/[cardSlug]` per foundation §4 (web uses `cards/[cardSlug]`); search maps the
slug into the native path shape. Navigation uses `router.push` within the Matrix
stack so the search screen stays on the back stack.

---

## 5. Data fetching

- **Hook:** `useSearch(q: string)` (mobile, `apps/mobile/lib/search/use-search.ts`):
  ```ts
  useQuery({
    queryKey: keys.search(debouncedQ),          // from @datum/core
    queryFn: () => searchAll(supabase, debouncedQ),
    enabled: debouncedQ.trim().length >= 2,      // mirror web's >= 2 gate
    placeholderData: keepPreviousData,           // keep last results during refetch
    staleTime: 30_000,                           // inherit makeQueryClient default
    gcTime: CACHE_MAX_AGE,                        // default; not persisted (§8)
  });
  ```
- **Debounce:** input state `q` (immediate, controls the `TextInput`) → a
  `debouncedQ` (e.g. 300ms) that drives the query key. This is the mobile
  improvement over web's submit-driven box; the `>= 2` gate is enforced by both
  the debounce target and `enabled`. Choose 250–350ms to feel live without
  hammering Supabase (six queries per keystroke-batch). Trim before comparing.
- **Per-keystroke cost note:** `searchAll` issues **six** sequential Supabase
  selects per call. The debounce is therefore load-bearing for cost/latency, not
  just UX. (A future optimization — a single Postgres RPC — is out of scope; web
  has the same 6-query shape and we keep parity.)
- **No realtime channel.** Search is a point-in-time query; results are not
  subscribed. (Web's `/search` is a one-shot server render with no realtime.) If a
  card changes while results are shown, the user re-runs/re-focuses; foundation's
  `focusManager` refetch-on-focus will re-issue the active query when the screen
  regains focus, which is sufficient parity.
- **No optimistic updates** — search is read-only.
- **`onlineManager`/`focusManager`** (wired in foundation) give
  refetch-on-reconnect / refetch-on-focus for the active (`enabled`) search query
  for free.

---

## 6. Mutations & validation

- **No mutations.** Search is strictly read-only; this slice introduces none.
- **Validation:** the only "input" is the query string. The `>= 2` length gate is
  the contract enforced in three aligned places: the debounce gate, react-query
  `enabled`, and `searchAll`'s own internal `trimmed.length < 2` short-circuit
  (which returns all-empty groups even if called directly — defense in depth, and
  already covered by the core impl). No Zod schema is warranted for a single
  trimmed string; if a shared guard is ever wanted, add
  `searchQuerySchema = z.string().trim().min(2)` to `packages/core/src/validation/`
  and reuse on both apps — flagged but not required for v1.
- **i18n keys to add** (`apps/mobile/messages/{id,en}.json`, new `search` namespace
  — the files currently hold only `login`):
  - `search.title` → "Cari" / "Search"
  - `search.placeholder` → "Cari kartu, aktivitas, komentar…" / "Search cards,
    activity, comments…"
  - `search.lede` → web lede string
  - `search.idle` / `search.idleSub` → web idle strings
  - `search.minChars` → "Ketik minimal 2 huruf." / "Type at least 2 characters."
  - `search.empty` (with `{q}`) / `search.emptySub` → web empty strings
  - `search.total` (with `{n}`) → "{n} hasil ditemukan"
  - `search.error` (with `{message}`) → "Gagal mencari: {message}"
  - `search.offline` → "Pencarian butuh koneksi."
  - `search.untitled` → "(tanpa judul)"
  - `search.kind.{development,project,card,event,comment,attachment}` → the
    `KIND_LABEL` values.
  - `search.retry` → "Coba lagi" / "Retry".

---

## 7. RLS & permissions notes (per role)

- **Identical to web** — mobile uses the anon key + the user's JWT, so every one of
  the six `searchAll` selects is filtered by the same RLS policies
  (`20260531000002_rls_policies.sql`, `…_cards_rls*.sql`, etc.) governing
  developments/projects/cards/card_events/card_comments/card_attachments. No new
  policy work.
- **Cost-sensitive attachment captions:** the `attachments` tier reads
  `card_attachments.ai_caption`, which is **RLS-scoped so captions never reach
  non-cost roles** (per the comment in `queries.ts` and the attachment slice). On
  mobile a non-cost role (`designer`/`pic`/`site_supervisor`) simply gets zero
  attachment rows back from Supabase — the group renders empty/absent. No
  client-side role check is needed or trusted; the DB is the gate. (Roles:
  `principal | designer | pic | site_supervisor | admin | estimator`; `cost_visible`
  is the relevant flag — see foundation §7.)
- **No role gating in the search UI itself** — every authenticated staff can
  search; what they *see* is purely RLS-filtered. The screen renders the same for
  all roles; only the result set differs.
- **Soft-deleted comments** are excluded by `searchAll` itself
  (`.is("deleted_at", null)`), independent of RLS.

---

## 8. Offline behavior

- **Search results are NOT persisted.** The `search` query key is deliberately
  excluded from `PERSISTED_KEY_ROOTS` (§3.5) because:
  - results are transient and query-specific (cache would balloon with one entry
    per typed query),
  - they are RLS- and freshness-sensitive (a stale persisted hit could point at a
    deleted/moved card), and
  - web's `/search` has no offline story at all (server-rendered per request).
- **Cold offline:** with no persisted search cache, an offline query (`enabled`
  but no data) surfaces the offline `EmptyState` ("Pencarian butuh koneksi.") under
  the `OfflineBanner`, rather than misleading stale results. `onlineManager`
  (foundation) pauses the query while offline and resumes on reconnect.
- **Warm in-session:** results fetched earlier in the same app session live in the
  in-memory query cache (`gcTime` 24h) and re-render instantly when the user
  retypes the same query; `keepPreviousData` smooths transitions between queries.
- **Tap-through offline:** result rows link to board/card screens whose data **is**
  persisted (`board`/`card` roots) — so tapping a hit while offline can still show
  the cached destination if it was visited before. The destination's own offline
  handling (foundation/board/card slices) applies; search does not special-case it.

---

## 9. Edge cases

- **`location` vs `site_address` discrepancy (carry + flag):** in
  `apps/web/lib/search/queries.ts` the projects query `select`s `location` and the
  `snippet` joins `client_name` + `location`, but the `.or()` filter matches on
  `site_address` (a different column). Both `location` and `site_address` exist on
  `projects` (`packages/db/src/types.generated.ts`). The mobile slice **preserves
  web behavior exactly** (it consumes the same core fn) and does **not** silently
  diverge. This is a real inconsistency in the shared code; flagged for a separate
  fix so web and mobile change together (see the spawned follow-up). Do not "fix"
  it inside the strangler move — that would change web behavior in a slice scoped
  to mobile parity.
- **Events with null project join** are dropped by `searchAll` (`if (!c?.projects)
  continue`) — mobile inherits this; such rows never appear.
- **Comment with no card slug:** web sets `href = "#"`; mobile renders the row but
  makes it **non-tappable** (no valid card route) rather than navigating to a dead
  link.
- **Card with empty title:** `cardTitle || "(tanpa judul)"` (web-verbatim
  fallback) — applies to card/event/comment/attachment rows that join a titleless
  card.
- **Query with `%` / `_` / `,` / `(` / `)`:** handled by `searchAll`'s escaping
  (general `pattern` escapes `%`/`_`; the events `.or()` strips `,()` and escapes
  `%`/`_`). Mobile passes the raw trimmed string; no client-side sanitization
  needed or wanted (would diverge from web).
- **Rapid typing / stale responses:** react-query keys on `debouncedQ`, so an older
  in-flight request for a previous query cannot overwrite the current results
  (react-query discards out-of-key responses); `keepPreviousData` shows the last
  good set meanwhile.
- **Query shrinks below 2 chars** (user deletes): `enabled` flips false; the screen
  returns to the idle `EmptyState`, the last results are dropped from view (the
  disabled query yields no data) — matching web returning all-empty for `< 2`.
- **Very long snippet / RTL-free Bahasa:** snippets are pre-windowed by `highlight`
  (≤ ~180 chars + ellipses); the row uses `numberOfLines` clamping (e.g. 2–3) so a
  long event payload snippet doesn't blow up row height.
- **Duplicate-id safety in `SectionList`:** ids are kind-prefixed and unique across
  groups, so a single flat `keyExtractor` is collision-free.
- **Pull-to-refresh:** optional `RefreshControl` on the `SectionList` calls
  `refetch()` for the active query (no-op when `q < 2`).

---

## 10. Testing

- **Core logic — vitest** (`packages/core/src/search/`): **move** the existing
  `apps/web/tests/unit/search-queries.test.ts` cases (or add a sibling) to exercise
  `searchAll` from `@datum/core`:
  - projects group → one `project` hit, `href "/project/ARIN-KARAWANG"`.
  - attachments group → one `attachment` hit, `href
    "/project/ARIN/cards/master-bath"`, snippet contains "Statuario".
  - developments tier → one `development` hit, `href "/?dev=d1"`, `cardTitle
    "Citraland"`.
  - **Additional** (cheap, high-value): `q.length < 2` returns all-empty groups;
    `highlight` window math (leading/trailing `…`, no-match fallback); event
    dedup-by-id + `PER_GROUP` cap; null-project event dropped.
  The web test file remains and stays green via the re-export (§3.3), so both the
  web import path and the core import path are covered.
- **Mobile screens — @testing-library/react-native** (`jest-expo` preset already
  configured in `apps/mobile/jest.config.js`; pattern from
  `apps/mobile/tests/login.test.tsx`):
  - **Debounce + gate:** typing 1 char fires no query (mock `searchAll` not
    called); typing ≥ 2 chars after the debounce calls `searchAll` once with the
    trimmed query.
  - **Grouped render order:** mock `searchAll` returning hits in several groups →
    assert sections appear in the web order and non-empty-only.
  - **States:** idle copy with empty input; loading skeleton while fetching; empty
    "Tidak ada hasil untuk “…”." for `total 0`; error state + retry calls
    `refetch`; offline banner + offline empty when `onlineManager` reports offline.
  - **Navigation:** tapping a `card` hit calls `router.push` with the mapped
    `/(tabs)/(matrix)/project/{code}/card/{slug}` route; a `comment` hit with no
    `cardSlug` is non-tappable; a `development` hit pushes the landing with `?dev=`.
  - **i18n:** renders Bahasa strings from `messages/id.json` (mirror login test).
- **CI:** runs automatically once `@datum/core` and `apps/mobile` are wired in
  foundation (`turbo` `dependsOn ^build`); no slice-specific CI change beyond the
  new test files.

---

## 11. Dependencies on other slices + Out of scope

**Depends on `foundation` for:** the `@datum/core` package + strangler recipe and
shared `core/query/keys.ts` (this slice extends it with `search`), the
`PersistQueryClientProvider`/persister + `onlineManager`/`focusManager` wiring,
NativeWind tokens and the shared `ui/` primitives (`Screen`, `Card`, `Badge`,
`Text`, `Button`, `EmptyState`, `ErrorState`, `Skeleton`, `OfflineBanner`), the
Expo Router Matrix-stack skeleton (the `search.tsx` route slot already exists in
foundation's tree), `useSession`, and the i18n setup.

**Depends on (for navigation targets, not for shipping):**
- `landing` slice — owns the `?dev=` filtered landing the development tier links to.
- `board` slice — owns `/(tabs)/(matrix)/project/[slug]`.
- `card-detail` slice — owns `/(tabs)/(matrix)/project/[slug]/card/[cardSlug]`.
Search can ship and render results before those screens exist; tapped hits route to
whatever those slices have landed (or a placeholder during the build).

**Out of scope:**
- Changing search ranking, adding full-text/`tsvector` indexes, or a single-RPC
  consolidation of the six queries (web keeps the 6-query shape; parity preserved).
- Per-group "show more"/pagination beyond `PER_GROUP` (web doesn't paginate).
- Persisting search results offline (deliberate, §8).
- Assistant/RAG retrieval (separate `assistant` slice).
- The `?dev=` landing filter UI (owned by `landing`).
- Fixing the `location`/`site_address` projects-filter inconsistency in shared
  code (flagged in §9 as a separate cross-app fix so web and mobile move together).
- Any DB migration.
