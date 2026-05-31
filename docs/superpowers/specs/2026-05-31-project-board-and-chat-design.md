# DATUM — Project Board + Chat UI Design

**Date:** 2026-05-31
**Status:** Approved, ready for implementation planning
**Supersedes:** the gate-matrix-as-primary-UI direction implicit in Slice 0 scaffolding
**Builds on:** `whastudio-ai-blueprint.md` v1.1, `whastudio-software-architecture-plan.md` v0.2, Slice 0 schema (migrations `20260531*`)
**Source evidence:** `assets/Trello/Bukit Darmo Golf H:1/*.json`, `assets/Trello/Pakuwon PC 10:12/*.json`

---

## 1. Context and motivation

Slice 0 shipped the foundation correctly — auth, projects, staff, 8 gates A–H with overlapping active-week windows, areas, RLS, cost-visibility, drafts, review queue, append-only audit. But the in-progress UI took the gate model literally and started building a per-area × per-gate matrix as the primary interaction surface (`apps/web/components/matrix/*`, `apps/web/lib/matrix/*`).

That direction was wrong for two reasons grounded in how WHAstudio actually works:

1. **A project spans 2+ years.** Gate H is irrelevant during Gate A/B, and vice versa. A matrix that exposes all 8 gates equally is mostly noise on any given day.
2. **The team already has working muscle memory in Trello.** Both pilot project exports (BDG H-1 and Pakuwon PC10-12) share a stable column taxonomy organized by architectural drawing code (`A01-03 DTP`, `A04 TANGGA`, `A05 KUSEN`, `A06 DETAIL ARSITEKTUR`, `A07-08 POLA LANTAI DAN PLAFON`, `A09 DETAIL KAMAR MANDI`, `A10 DETAIL BESI`, `U01–U04`, `LANDSCAPE`) plus operational columns (`DAILY PROGRESS`, `PHOTOS`, `LOGISTIK`). The original blueprint already specified "Trello-style topic cards" — Slice 0 just hadn't built that surface yet.

**The pivot:** keep the gates as backend scheduling/readiness logic, replace the matrix UI with a Trello-style board, and add a prominent chat that can both query and capture into the board's structured records.

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Primary surface | Trello-style board, one board per project | Matches existing team muscle memory and Trello export structure |
| Columns | Seeded drawing-code taxonomy + per-project user-added columns (e.g., interior areas) | Drawing codes are consistent across pilot boards; interior columns vary per project |
| Card unit | **Subject card** — one long-lived card per subject (e.g., "Master bathroom"), with a structured timeline inside | Makes data queryable; gives gates something to measure; AI can answer "latest on X" without scrolling |
| Card structure | Header + Members + Timeline of typed events + Comment thread | Combines structured record-keeping with Trello-style casual discussion |
| Chat placement | **Bottom dock, 25% of screen height**, prominent, with rich inline card snippets and cross-highlight | Keeps board as visual home; chat is always available without dominating |
| Chat capability | Query (renders rich card snippets inline) + Capture (routes uploads/notes to cards as drafts) | The "twofold" interaction the user described |
| Gates A–H | **Backend logic** for scheduling/overlap/reminders, not primary UI | Most gates are irrelevant on any given day; surface them only when actionable |
| Data storage | **Hybrid** — relational core + JSONB at the edges + JSON receipts | Correctness where it matters, flexibility where it matters |
| Bahasa Indonesia | Default UI language | Existing blueprint decision; team operates in Bahasa |
| Slice 0 schema | Kept; cards/events/chat layer added on top | Cheapest pivot; no data loss |

## 3. Information architecture

```
Project (board)
└── Column (project_topic)              ← seeded drawing-code taxonomy + per-project additions
    └── Subject card (card)             ← long-lived subject, e.g., "Master bathroom"
        ├── Header                       ← title, status, current_summary, linked areas, gate hint
        ├── Members (card_members)       ← DATUM staff who own/watch this card
        ├── Timeline (card_events)       ← structured, AI-routable typed events
        │     decision · drawing · survey · vendor_quote · vendor_pick ·
        │     material · worker_assigned · progress · defect · photo ·
        │     document · client_request · note · pending
        └── Comments (card_comments)     ← casual Trello-style discussion with @mentions
```

### 3.1 Three kinds of textual content (kept cleanly separate)

| What | Where | Purpose |
|---|---|---|
| Casual discussion | `card_comments` | Quick chatter, questions, @pings — like Trello comments |
| Logged observation | `card_events` with `event_kind = 'note'` | A note someone decided is part of the official record |
| Verbatim client ask | `card_events` with `event_kind = 'client_request'` | Awaiting response; surfaces in pending lists |

The AI watches the comment thread and can suggest **"promote this comment into a typed event"** when a comment carries structured info (e.g., a comment mentioning a vendor visit becomes a draft `survey` event). The comment stays in place; the structured event gets added. No info loss.

### 3.2 Members

`card_members.role ∈ {owner, watcher, assignee}`. Notification rules:
- New `@mention` in a comment → ping the mentioned staff
- New `decision` / `defect` / `pending` / `client_request` event → ping all watchers
- Card `status` change → ping all watchers

Distinct from:
- `worker_assigned` event (for site workers/mandor doing the actual work)
- `project_staff` (project-level role assignment, not card-level subscription)

### 3.3 Areas

The Slice 0 `areas` table (15 areas seeded across the two pilot projects) stays in the data model but is **not a primary navigation surface**. The user navigates by column → card. A card optionally references one or more areas via `card_areas` (many-to-many). Gate readiness is computed per (area, gate) from the card_events of cards that reference that area.

## 4. Data model — additions on top of Slice 0

All new tables follow Slice 0 conventions: `uuid` primary keys, `created_at` / `updated_at` timestamps, append-only via `record_revisions` for corrections, RLS policies referencing the existing `current_cost_visible_for()` function.

```sql
-- Subject cards (one per long-lived subject, lives in a project_topic column)
create table public.cards (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id),
  topic_id          uuid not null references public.topics(id),
  title             text not null,
  slug              text not null,                     -- url-friendly, unique within project
  status            text not null default 'active'
                    check (status in ('active','dormant','closed')),
  current_summary   text,                              -- AI-maintained one-line "where this card is"
  properties        jsonb not null default '{}'::jsonb, -- flexible per-card metadata
  created_by_staff_id uuid not null references public.staff(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_event_at     timestamptz,
  unique (project_id, slug)
);

-- Card ↔ area many-to-many (drives gate readiness computation)
create table public.card_areas (
  card_id   uuid not null references public.cards(id) on delete cascade,
  area_id   uuid not null references public.areas(id),
  primary key (card_id, area_id)
);

-- The timeline. THIS is the central event log of every card.
create table public.card_events (
  id                 uuid primary key default gen_random_uuid(),
  card_id            uuid not null references public.cards(id) on delete cascade,
  project_id         uuid not null references public.projects(id),
  event_kind         text not null check (event_kind in (
                       'decision','drawing','survey','vendor_quote','vendor_pick',
                       'material','worker_assigned','progress','defect','photo',
                       'document','client_request','note','pending'
                     )),
  payload            jsonb not null,                   -- kind-specific shape, validated in code (Zod)
  occurred_at        timestamptz not null,             -- when it actually happened, not insert time
  logged_by_staff_id uuid not null references public.staff(id),
  source_kind        text not null check (source_kind in (
                       'chat','manual','import','ai_extraction','external_pdf'
                     )),
  source_id          uuid,                             -- references ai_extraction_runs or data_drafts
  cost_visible       boolean not null default false,   -- gates RLS for vendor_quote/invoice events
  draft_id           uuid references public.data_drafts(id),
  created_at         timestamptz not null default now()
);

-- Attachments live separately from the event payload for fast media queries
create table public.card_attachments (
  id              uuid primary key default gen_random_uuid(),
  card_event_id   uuid not null references public.card_events(id) on delete cascade,
  storage_path    text not null,                      -- supabase storage key
  mime_type       text not null,
  ai_caption      text,                                -- short AI description if image
  ai_extracted    jsonb,                               -- structured AI parse (for PDFs etc.)
  created_at      timestamptz not null default now()
);

-- Card relations
create table public.card_links (
  from_card_id    uuid not null references public.cards(id) on delete cascade,
  to_card_id      uuid not null references public.cards(id) on delete cascade,
  relation        text not null check (relation in (
                    'depends_on','blocks','related_to','supersedes'
                  )),
  created_by_staff_id uuid not null references public.staff(id),
  created_at      timestamptz not null default now(),
  primary key (from_card_id, to_card_id, relation)
);

-- Members (subscribe DATUM staff to a card for notifications)
create table public.card_members (
  card_id            uuid not null references public.cards(id) on delete cascade,
  staff_id           uuid not null references public.staff(id),
  role               text not null check (role in ('owner','watcher','assignee')),
  added_by_staff_id  uuid not null references public.staff(id),
  added_at           timestamptz not null default now(),
  removed_at         timestamptz,
  primary key (card_id, staff_id, role)
);

-- Casual Trello-style discussion
create table public.card_comments (
  id                  uuid primary key default gen_random_uuid(),
  card_id             uuid not null references public.cards(id) on delete cascade,
  project_id          uuid not null references public.projects(id),
  body                text not null,
  mentions            uuid[] not null default '{}',    -- staff_id[] mentioned via @
  edited_at           timestamptz,
  deleted_at          timestamptz,
  created_by_staff_id uuid not null references public.staff(id),
  created_at          timestamptz not null default now()
);

create index on public.card_events (card_id, occurred_at desc);
create index on public.card_events (project_id, event_kind, occurred_at desc);
create index on public.card_comments (card_id, created_at desc) where deleted_at is null;
create index on public.cards (project_id, topic_id, status);
```

### 4.1 Validation layer (Zod schemas per event kind)

Each `event_kind` has a corresponding Zod schema in `apps/web/lib/cards/event-schemas.ts`. The API layer validates `payload` against the matching schema before insert. Example shape:

```ts
const DecisionPayload = z.object({
  topic: z.string(),                        // e.g., "marmer lantai master bath"
  current_spec: z.string().optional(),
  proposed_spec: z.string().optional(),
  approved_by: z.enum(['client','principal','pic']).optional(),
  approval_evidence: z.string().optional(), // e.g., "WA screenshot 2026-05-20"
});

const VendorQuotePayload = z.object({
  vendor_id: z.string().uuid().optional(),  // links to vendors table if known
  vendor_name: z.string(),
  amount: z.number(),
  currency: z.literal('IDR'),
  quote_date: z.string(),                   // ISO date
  expires_at: z.string().optional(),
  notes: z.string().optional(),
}); // events with this kind always set cost_visible = true
```

### 4.2 RLS

- `cards`, `card_events` (where `cost_visible = false`), `card_attachments`, `card_comments`, `card_members`, `card_links` — readable by any active staff on the project (existing `project_staff` join)
- `card_events` where `cost_visible = true` — readable only by staff where `current_cost_visible_for(project_id, staff_id) = true`
- Write policies match the blueprint: any active staff may write, high-risk records go through `data_drafts` first

### 4.3 Topic (column) seed

On project creation, seed `topics` with the standard taxonomy derived from the CAD checklist and the Trello exports:

```
A01-03 — DTP (Denah, Tampak, Potongan)
A04 — Tangga
A05 — Kusen
A06 — Detail Arsitektur
A07-08 — Pola Lantai dan Plafon
A09 — Detail Kamar Mandi
A10 — Detail Besi
U01 — Pipa Air Kotor dan Bersih
U02 — Listrik Dinding dan Lantai
U03 — AC
U04 — CCTV, Data, Telpon, Wifi
LANDSCAPE
DAILY PROGRESS
PHOTOS
LOGISTIK
```

Per-project additions (e.g., `LANTAI 1 KITCHEN`, `LANTAI 1 PANTRY`, `FORUM DISKUSI INTERIOR`) are user-created from the board's column-add affordance.

## 5. UI surfaces

### 5.1 Project Board (`/project/[slug]`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  BDG H-1                                          🔍 Cari   Wilson  │ ← topbar
├──────────────────────────────────────────────────────────────────────┤
│  [A05 Kusen]  [A06 Detail]  [A09 Kmr Mandi]  [U02]  [LOGISTIK]  →  │ ← columns (horizontal scroll)
│   Pintu utama  Stepping kol.  Master bath*    Saklar  Permintaan    │
│   Kusen lt 2   Pagar depan    Powder room     lt 1    Spec digunakan│ ← cards (mini)
│                                                                       │
│                                                              ~75%    │
├──────────────────────────────────────────────────────────────────────┤
│ ▴ Asisten   tarik file ke sini atau ketik untuk catat / tanya       │ ← chat dock
│ [user]   Apa keputusan terakhir untuk master bath?                  │
│ [ai]     Marmer Statuario disetujui 2026-05-20.                     │ ~25%
│          ┌── Master bath ────────────────────────────────┐          │
│          │ decision  2026-05-20 marmer Statuario · Carissa│         │
│          │ vendor    PT Galleria · Rp 2.4jt/m²             │         │
│          │ drawing   2026-02-11 survei Galleria            │         │
│          │ pending   pelebaran shower lt 2                  │         │
│          └─────────────────────────────────────────────────┘         │
│ [📎] Tanya apa saja, atau lampirkan foto/PDF…           [Kirim]     │
└──────────────────────────────────────────────────────────────────────┘
```

- Board (~75% height): horizontally scrollable columns with mini-cards (title + event count + status chip)
- Click a mini-card → opens card detail in a modal/side-panel (header, members, timeline, comment thread)
- Chat dock (25% height): persistent, file-drop target, renders inline card snippets, cross-highlights the source card in the board above

### 5.2 Card detail (modal)

- Header (title editable, status, current_summary, linked areas chips, gate hint chip)
- Members row (avatars + add)
- Tabs: **Timeline** (default — chronological card_events, filterable by kind) · **Comments** (chronological discussion + @mentions) · **Attachments** (gallery of card_attachments)
- Action bar: add event (typed picker), add comment, add member, link to another card, change status

### 5.3 Schedule view (`/project/[slug]/schedule`) — secondary

Gantt-style view of gate active-week windows per area, with computed readiness status. Linked from Wilson's morning brief. Not in the primary nav.

### 5.4 Morning brief (`/brief`) — Wilson-scoped, Phase 3-style

Top items needing attention across active projects: overdue decisions, draft aging, gate items at risk, blocked cards. Out of scope for this slice — but the data model supports it.

## 6. Chat & AI flows

All flows share `/api/assistant/*` and the existing assistant audit tables.

### 6.1 Query flow

1. User types question in chat dock
2. Server: verify auth → resolve `staff.id` → check `assistant_usage_limits` → resolve cost visibility for current project
3. Retrieval ordered:
   - `cards` + `card_events` for the current project (and others if explicitly asked)
   - Supplementary: `decisions`, `vendor_quotes`, `invoices`, `checklist_items`
   - Evidence-only: raw Trello import history (only when AI explicitly asks for it)
4. AI answer in Bahasa with inline citations to specific `card_events.id`
5. UI renders rich card snippets inline (mockup in §5.1) and adds amber outline to source card(s) in the board
6. Audit: `assistant_messages`, `assistant_tool_calls`, `assistant_query_audit` rows written

### 6.2 Capture flow

1. User types or drops a file (`📎` attach) in chat
2. AI proposal: `{ card_id, event_kind, payload, attachments?, confidence }`
3. UI renders proposal as an inline draft card — user clicks ✓ to commit or edits routing (different card / different kind)
4. Commit:
   - Low-risk + confidence ≥ threshold → directly insert `card_events`
   - High-risk OR cost-sensitive OR confidence below threshold → insert into `data_drafts` first, surface in review queue, become `card_events` only after approval
5. If upload was a PDF/image, `ai_extraction_runs` stores the raw AI parse; the resulting `card_attachments.ai_extracted` references it

### 6.3 Card-not-found fallback

When AI cannot route confidently:
- Use the most likely column's "Loose log" subject card (a normal `cards` row with `title = 'Loose log — perlu triase'`, auto-created on first need, one per column max, marked with `properties.is_loose_log = true` for UI styling)
- Surface the event in the review queue with priority = high so a human disambiguates
- Humans can move events out of the Loose log by editing each event's `card_id` (a `record_revisions` row captures the move)

### 6.4 Comment promotion

A scheduled job (or on-comment trigger) runs AI over new comments. When a comment scores above a structure threshold, AI proposes a typed event draft via the standard `data_drafts` flow. Original comment stays in place. UI shows a small "✨ promoted to event" link on the comment.

## 7. Gates as backend logic

Slice 0's `gates` (A–H, with `active_weeks` ranges) and `area_gate_status` (per area × per gate) tables stay. Add automatic recomputation:

- Trigger or scheduled job watches `card_events` insert/update
- For each affected event, walk to the card → linked areas → for each (area, gate), recompute status using deterministic rule predicates
- Rules live in `apps/web/lib/gates/readiness-rules.ts` as typed per-gate predicates, versioned (each rule has a `version` field on its output so changes are traceable)
- Example: gate B "Pekerjaan Kamar Mandi" advances when card_events for that area include a confirmed `material` (sanitary) AND an approved `decision` (floor finish) AND a `vendor_pick`

Surfaces:
1. **Card header chip** — when a card's column maps to a gate currently active in the project's week-range, show a small "next: Gate B" chip
2. **Schedule view** — gantt-style per-area gate windows + actual status (§5.3)
3. **Morning brief** — overdue/at-risk gate items across projects (§5.4, out of slice scope)

The matrix UI from `apps/web/components/matrix/*` is removed from primary nav. The code stays in the repo, accessible only via the schedule view as an internal debug surface.

## 8. Slice 0 disposition

| Slice 0 artifact | Disposition |
|---|---|
| `apps/web/components/matrix/*`, `apps/web/lib/matrix/*` | Removed from primary nav. Code retained behind `/project/[slug]/schedule` as an internal debug view. |
| `area_gate_status` | Kept, repurposed as backend readiness store, recomputed from `card_events` |
| `decisions`, `vendors`, `vendor_quotes`, `invoices` | Kept. Write paths route through `card_events`; payloads mirror into these typed tables where applicable for cross-card SQL queries. Read paths can still query these directly. |
| `topics` | Kept — becomes the "column" table. Standard taxonomy seeded on project creation (§4.3). |
| `data_drafts`, `review_queue` | Kept and extended — every chat-captured event flows through here for high-risk items |
| `project_events`, `record_revisions` | Kept — append-only audit unchanged |
| RLS policies, `current_cost_visible_for()` | Kept; extended with policies for new `cards`, `card_events`, `card_attachments`, `card_comments`, `card_members`, `card_links` |
| Seeded login (`wilson@datum.local`, `carissa@datum.local`) | Kept for pilot |
| 15 seeded areas across BDG H-1 and PKW PC1012 | Kept |

Nothing is deleted. The matrix is just no longer the front door.

## 9. Out of scope (deferred to later slices)

Explicitly part of the product, just not this slice:

- **MK daily-report PDF ingestion** — parsing external supervisor reports into card_events
- **Expo mobile app** (`apps/mobile`) — paused until web board+chat loop proves out
- **WhatsApp outbound notifications** — schema exists from Slice 0; sending implemented later
- **Drawing-code AI parsing of architectural PDFs into checklists** (blueprint Phase 2)
- **Client-facing read view** — explicit blueprint deferral
- **Trello JSON bulk import** — separate slice; one-time migration tool
- **Offline mobile capture** — blueprint Phase 4

## 10. Testing

| Layer | Tool | Coverage |
|---|---|---|
| Unit | Vitest | Zod schemas per `event_kind`; gate readiness rule predicates; retrieval scoring; mention parser |
| Integration | Vitest + Supabase test instance | `/api/cards/*`, `/api/assistant/message`, RLS verification (cost-visible vs not, project_staff scoping) |
| E2E | Playwright | Board render; column scroll; card open; chat-to-card routing happy path; draft approval; comment thread + mention; status change ping |
| Manual UX gate | Before merge | Walk Wilson + Carissa through capture-via-chat → see-on-card → query-back on staging; gather pilot feedback before sign-off |

## 11. Implementation slicing (handed off to writing-plans)

The implementation plan (next phase) will sequence work as roughly:

1. Schema additions (`cards`, `card_areas`, `card_events`, `card_attachments`, `card_links`, `card_members`, `card_comments`) + RLS + Zod schemas
2. Topic seed on project creation
3. Board UI route `/project/[slug]` with columns + mini-cards (read-only)
4. Card detail modal with timeline (read-only)
5. Chat dock UI + `/api/assistant/message` query path
6. Chat capture path + draft → card_event flow
7. Comments + members + @mention notifications
8. Gate readiness recomputation hook + card header gate chip
9. Schedule view (`/project/[slug]/schedule`) wrapping existing matrix code
10. Manual pilot walk-through

Phase-1 success criterion (from blueprint §7): pilot users can answer "what is the latest decision / status / source?" from the app without asking Wilson or searching WhatsApp.

## 12. Open questions for implementation

These need answering during implementation planning, not now:

- Confidence threshold for direct-commit vs draft routing in chat capture flow (start conservative — propose 0.85, tune from pilot)
- Notification delivery mechanism for @mentions and watcher pings — in-app only first, or WhatsApp outbound from day 1?
- Comment promotion job cadence — on every comment insert (trigger), or batched every N minutes (cron)?
- Whether `card_events` payload validation should be enforced by a database trigger (Postgres-side JSON schema check) in addition to API-side Zod, or trust the API
- Card slug generation policy when titles collide

---

**End of design.**
