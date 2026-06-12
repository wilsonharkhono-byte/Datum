# Bulk-import WHA Studio Trello boards into DATUM

**Date:** 2026-06-12
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

DATUM currently contains only the two pilot project boards (`BDG-H1`,
`PKW-PC1012`), imported by hand-wiring two entries into the `IMPORTS` array of
[`packages/db/scripts/import-trello.ts`](../../../packages/db/scripts/import-trello.ts).
WHA Studio has ~90 more boards across two Trello workspaces. We want to bring all
the *real* project boards into DATUM as projects, pulling them through the
existing Composio Trello connection rather than manual JSON exports.

## Goals

- Pull every in-scope board from Trello via the connected Composio Trello toolkit.
- Auto-create a DATUM project per board (no manual project rows).
- Reuse the existing, idempotent card/event/comment import logic unchanged.
- Make each imported project findable in-app by **project name (site address)**
  *or* **client name**.
- Encode WHA Studio's **scope of work** (architecture / interior / both) in the
  project code prefix.

## Non-goals

- Areas and `area_gate_status` cells — Trello does not model rooms the way DATUM
  does; areas are added per-project in the app afterward.
- Attachment file download — handled separately by the existing
  `import-trello-attachments.ts` if/when desired.
- Merging cross-workspace duplicate jobs — flagged via logging, merged manually.

## Scope of boards

Source: two Trello workspaces on the connected account (Wilson Harkhono).

- **WHAstudio** (`6047c464ad682d7c1686c599`) — ~82 boards.
- **WHA's workspace** (`646c79a83ebb2f64e7cf66e7`) — ~9 boards (older, likely
  duplicates of jobs in the main workspace).

**Selection rule (applied during fetch):** include a board when
`closed === false`, **except** the excluded set below. Applies across *both*
workspaces (~73 boards in scope, minus the 2 already imported).

**Excluded regardless:**
- Templates: `ARCH - TEMPLATE`, `INTR - TEMPLATE`.
- Junk: `Untitled`, `To Do List - Timbul`.
- Any board with `closed === true`.

**Included (per explicit decision):** the 3 `WHA - …` pipeline boards
(`Architecture Schematic Design`, `Interior Schematic Design`,
`WORKING DRAWINGS`). These are cross-project pipeline boards rather than single
jobs; they import mechanically (their lists become custom topics), flagged in the
import log.

**Duplicate risk:** the second workspace's open boards are likely older copies of
main-workspace jobs. Max coverage was chosen deliberately; they become separate
projects. The importer **logs likely duplicates** (projects whose derived
`project_name` closely matches an existing one) for manual merge.

## Architecture — two phases

### Phase A — Fetch (agent-driven, via Composio MCP)

Composio tools are callable only by the agent, not by a standalone `tsx` script,
so fetching happens through the agent.

For each in-scope board, call `TRELLO_GET_BOARDS_BY_ID_BOARD` with nested
resources in a single request:

```
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

One call returns a whole board. Normalize each response into the **exact JSON
shape the existing importer already reads** — `TrelloBoard { lists[], cards[],
actions[], checklists[] }` — by:

1. Hoisting every `cards[].checklists[]` into a top-level `checklists[]` array.
2. Setting each `card.idChecklists = card.checklists.map(c => c.id)`.
3. Keeping `attachments`, `actions` (commentCard), and card fields as-is.

Additionally embed a `_meta` block used by the auto-create step:

```jsonc
"_meta": {
  "trello_board_id": "665e984287e87d6665545a17",
  "short_link": "QQQcBn6d",
  "board_name": "AR.IN - BUKIT DARMO GOLF I-23 - YENI KALIM",
  "scope": "arin",                 // arin | arch | intr | wha
  "project_code": "ARIN-BUKIT-DARMO-GOLF-I23",
  "project_name": "Bukit Darmo Golf I-23",
  "client_name": "Yeni Kalim",     // or null
  "site_address": "Bukit Darmo Golf I-23",
  "search_aliases": ["Bukit Darmo Golf I-23", "Yeni Kalim", "AR.IN - BUKIT DARMO GOLF I-23 - YENI KALIM"]
}
```

Write each normalized board to
`assets/Trello/<sanitized-board-name>/<short_link>.json`.

To keep ~73 large board payloads out of the orchestrator's context, run the fetch
as **parallel subagent waves**: each subagent fetches a chunk of boards, writes
the files locally, and returns only a manifest (board name, code, list/card/comment
counts). This matches the preferred parallel-wave execution style.

### Phase B — Import (script-driven, idempotent)

Extend [`packages/db/scripts/import-trello.ts`](../../../packages/db/scripts/import-trello.ts):

1. **Auto-discovery** — replace the hardcoded `IMPORTS` array with a scan of
   `assets/Trello/**/*.json`. Each file carries its own `_meta`.
2. **Auto-create project** — look up the project by `trello_board_id`
   (new column). If absent, create it:
   - Insert `projects` row: `project_code`, `project_name`, `client_name`,
     `site_address`, `location` (null unless derivable), `status =
     'construction'`, `principal_id = Wilson`, `search_aliases`,
     `trello_board_id`.
   - Insert a `project_staff` principal row for Wilson (required for RLS
     visibility).
   - Init the 8 `project_gates` (`A`–`H`) like `seed-pilot` does.
   - Topics are seeded automatically by the existing
     `seed_topics_after_project_insert` trigger.
3. **Existing logic unchanged** — the proven list→topic mapping, card insert,
   event insert (note / pending / document), and comment import all run as-is.
   Idempotency keys remain: project by `trello_board_id`, card by
   `properties->>trello_card_id`, comment by body equality.

### Schema change

One migration adds the idempotency key:

```sql
alter table public.projects
  add column trello_board_id text unique;
```

Nullable so existing/hand-created projects are unaffected. This is the stable key
that prevents duplicate projects across re-runs and survives board renames.

## Derivation rules (per board)

Parse the board name as `<PREFIX> <sep> <remainder>` where `PREFIX ∈ {AR.IN,
ARCH, INTR, WHA}` and `sep` is ` - ` or `_`.

- **scope / code prefix:**
  - `AR.IN` → scope `arin` (architecture + interior) → code prefix `ARIN-`
  - `ARCH` → scope `arch` (architecture) → code prefix `ARCH-`
  - `INTR` → scope `intr` (interior) → code prefix `INTR-`
  - `WHA` → scope `wha` (pipeline) → code prefix `WHA-`
  - No recognized prefix → scope `arin` default; flagged in log.
- **client_name:** split the remainder on the **last** ` - ` or `_`. The trailing
  token is the client *iff* it has no unit/number pattern (heuristic). Otherwise
  `null`. Title-cased.
- **project_name / site_address:** the remainder with the client token removed,
  title-cased (e.g. `Bukit Darmo Golf I-23`).
- **project_code:** `<CODE-PREFIX><SLUG>` where `SLUG` = uppercased, hyphenated
  site portion, truncated to keep the code reasonable (≤ ~40 chars). Resolve
  collisions with a numeric suffix (`-2`, `-3`, …).
- **search_aliases:** `[project_name, client_name?, raw_board_name]` plus any
  obvious site tokens — so partial queries on either name hit.

## In-app searchability (new work)

The `/search` page currently searches only cards, events, and comments
([`apps/web/lib/search/queries.ts`](../../../apps/web/lib/search/queries.ts)); it
does **not** search projects, and the home page has no project text filter. To
satisfy "project name or client name queryable," add a **Projects** result group
to the search query:

- Query `projects` with `ilike` (case-insensitive `%pattern%`) across
  `project_name`, `client_name`, and `site_address`, plus a `search_aliases`
  containment match.
- Return results in the existing `SearchResult` shape, linking to
  `/project/<project_code>`.
- Render a "Proyek" section in the search results UI (Bahasa Indonesia labels,
  consistent with the rest of the page).

## Error handling

- A board whose fetch fails is logged and skipped; the run continues (per-board
  isolation, like the current per-project try/catch).
- A board that yields zero importable lists/cards still creates its project (so
  it is visible) and logs the empty result.
- Project insert failure (e.g. code collision that slips dedup) is caught,
  logged, and that board is skipped — never aborts the whole run.
- Re-running fetch + import is safe end to end (idempotent on `trello_board_id`,
  `trello_card_id`, comment body).

## Testing / verification

- Dry-run count: number of normalized JSON files written == number of in-scope
  boards from the filter.
- After import, spot-check: project count increased by ~71; a sampled project has
  topics (15 default + list-derived), cards under correct topics, comments, and a
  Wilson principal `project_staff` row.
- Search: querying a known site name and a known client name each returns the
  expected project in `/search`.
- Idempotency: a second import run reports 0 projects created, 0 cards created.

## Out-of-scope follow-ups

- Backfilling realistic `status`, `kickoff_date`, `target_handover` per project.
- Areas + `area_gate_status` per project.
- Attachment binary download via `import-trello-attachments.ts`.
- Manual merge of cross-workspace duplicate projects flagged by the importer.
