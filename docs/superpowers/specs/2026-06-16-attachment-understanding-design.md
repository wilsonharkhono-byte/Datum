# Attachment understanding — AI reads images & PDFs (marbles, floor plans, quotes)

**Date:** 2026-06-16
**Status:** Approved — ready for implementation plan
**Area:** Assistant + attachments (upload enrichment, search/retrieval, Tanya live-read)

## Problem

Projects carry visual/document attachments that hold real information the team
needs: photos of marble/material samples, PDF floor plans, PDF sanitary/vendor
quotes. Today the assistant is **blind** to their content:

- In CATAT (capture), only the file's *metadata* (name, MIME, size) reaches the
  model — never the bytes — so it can at best guess `kind: photo|document`.
- `card_attachments.ai_caption` and `card_attachments.ai_extracted` columns exist
  but are **never populated**.
- Global search (`lib/search/queries.ts`) and assistant retrieval
  (`lib/assistant/retrieval.ts`) sweep card/event *text* only; an attachment is
  findable by filename at best, never by what's *in* it.

The model already wired in (`@anthropic-ai/sdk`, default `claude-haiku-4-5`) is
natively multimodal — it can read images (JPEG/PNG/WebP/HEIC) and PDFs (each page
as text + image). The capability gap is purely that we never send the content.

## Goals

- **Understand each attachment once, on upload**, producing:
  - a **rich searchable description** (`ai_caption`) — the safety net, always; and
  - **typed structured data** (`ai_extracted`) for file types where it pays off
    (vendor quotes, material specs, drawings), *when confident*.
- **Make captions findable** in global search and the assistant's Tanya context,
  inheriting existing cost-visibility gating.
- **Let typed extraction pre-fill an event proposal** for human confirmation
  (reusing the CATAT `ProposalCard` review), so the AI never silently writes
  numbers (amounts, dimensions) onto a card.
- **Allow Tanya to re-open originals on demand** for deep visual follow-ups,
  within a hard per-query budget.
- Do all of the above **without slowing or breaking uploads**, with bounded cost,
  and without leaking cost-sensitive data to non-cost roles.

## Non-goals

- OCR/search over arbitrary office formats (docx/xlsx). Scope is **image/\*** and
  **application/pdf** (the only types the `card-attachments` bucket accepts).
- Editing/annotating files, or generating new images.
- Auto-committing any typed value to a card without human confirmation.
- Replacing the existing text search/retrieval; this augments it.
- Full-text re-architecture (the unused `search_text` generated column is left
  as-is; out of scope).

## Phasing

The full design is **Both** (upload enrichment + Tanya live-read), **Tiered**
(description always + typed extraction when confident), **Pipeline B** (async
background). Ship in order — each phase is independently useful and shippable:

1. **Phase 1 — Description + search (the 80%).** Async runner writes `ai_caption`
   for every image/PDF; captions surface in search + Tanya. *Lowest risk; makes
   every attachment findable.* **First implementation target.**
2. **Phase 2 — Typed extraction + review chip.** Runner also writes `ai_extracted`
   for quotes/specs/drawings; a "Suggested from attachment" chip opens a
   pre-filled `ProposalCard`.
3. **Phase 3 — Tanya live-read.** Bounded re-reading of original bytes for deep
   visual questions.

## Design

### Shared module — `lib/attachments/analyze.ts` (all phases)

Pure, Supabase-free, HTTP-free, unit-testable. The only place that talks to the
vision model.

```ts
export type AnalyzeInput = {
  bytes: Uint8Array;           // downloaded file
  mimeType: string;            // image/* or application/pdf
  topicHint?: string;          // card's topic name, to bias extraction
  withExtraction: boolean;     // Phase 1 = false; Phase 2+ = true
};

export type AnalyzeResult = {
  caption: string;                              // rich Indonesian description
  extracted: ExtractedPayload | null;           // typed, only if confident
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};
```

- Builds the Claude request: an **image** content block for `image/*`, a
  **document** content block for `application/pdf`.
- **Description pass** (always): one prompt → 1–3 sentence Indonesian caption.
  Instruction: describe what is visibly/textually present; say *"tidak terbaca"*
  for anything unclear; never invent. For images of materials, name colour /
  finish / pattern. For quotes, summarise vendor + rough total + validity in
  prose. For drawings, name the drawing type + any visible code/revision.
- **Typed-extraction pass** (Phase 2+, `withExtraction`): a **tool-use / strict
  JSON schema** call returning `{ kind, fields, confidence }`, mapped to the
  app's event payloads (`@datum/types`):
  - quote → `vendor` (`interaction: "quote"`, `vendor_name`, `amount`,
    `quote_date`, `expires_at`)
  - material sample → `material` (`item`, `spec`, `status: "specified"`)
  - floor plan / drawing → `drawing` (`drawing_code`, `revision`, `description`)
  - Anything else / low confidence → `extracted: null` (caption still stands).
- **Model selection:** description uses `getModel()` (Haiku). Extraction reads a
  new `ANTHROPIC_VISION_MODEL` env (defaults to `getModel()`), so quotes can be
  escalated to Sonnet for number accuracy without touching code.
- **Caps:** caller enforces size/page caps before calling (see runner). PDFs over
  the page cap are sent truncated with a note in the caption.

`ExtractedPayload` carries `confidence: number` and the target `kind`; it is *not*
trusted as a validated event payload until it passes `parseEventPayload` at
proposal time.

### Data model — extend `card_attachments`

`ai_caption text` and `ai_extracted jsonb` **already exist**. Add only the
processing-state columns (additive migration; live DB → `supabase db push`):

| Column | Type | Purpose |
| --- | --- | --- |
| `ai_status` | enum `attachment_ai_status` (`pending`/`processing`/`done`/`failed`/`skipped`) default `pending` | Drives the runner + "Analyzing…" UI |
| `ai_error` | `text` | Last failure reason (for retry / "Re-analyze") |
| `ai_model` | `text` | Which model produced the result (cost audit) |
| `ai_processed_at` | `timestamptz` | When it finished |
| `ai_attempts` | `int` not null default 0 | Retry-budget guard (max 3) |

Index for the runner's claim query:
`create index card_attachments_ai_pending_idx on card_attachments (ai_status, created_at) where ai_status in ('pending','failed');`

No RLS change needed: `card_attachments` SELECT already inherits the parent
event's readability (and thus `cost_visible` gating). The runner writes via the
**service role** (server-only), bypassing RLS for writes only.

### Phase 1 — upload-time description (async, Pipeline B)

**Trigger.** The `card_attachments` row already inserts with `ai_status` defaulting
to `pending` (no client change required beyond the migration). A row in
`pending`/`failed` is the work queue.

**Runner — `app/api/cron/analyze-attachments/route.ts`** (Vercel Cron, every
minute; service-role Supabase client):

1. **Claim a batch** atomically (`update … set ai_status='processing',
   ai_attempts = ai_attempts + 1 where id in (select … where ai_status in
   ('pending','failed') and ai_attempts < 3 order by created_at limit N for update
   skip locked) returning *`) — `skip locked` prevents two overlapping runs from
   double-processing.
2. For each claimed row:
   - Resolve the parent event's project/topic (for `topicHint` + cost flag).
   - **Guard:** if `mime_type ∉ {image/*, application/pdf}`, or storage object
     size > 20 MB, or (PDF) page count > 20 → set `ai_status='skipped'`,
     `ai_error='unsupported|oversize|too_many_pages'`. (File stays usable.)
   - Download bytes from Storage (service role).
   - `analyze({ withExtraction: false })` → caption.
   - Write `ai_caption`, `ai_status='done'`, `ai_model`, `ai_processed_at`.
   - On Claude/IO error → `ai_status='failed'`, `ai_error=message`. Re-picked next
     tick until `ai_attempts >= 3`, then parked.
3. Realtime: `card_attachments` is added to the realtime publication so the open
   card view swaps the "Analyzing…" badge for the caption when the row updates.

**Search — `lib/search/queries.ts`.** Add an attachment-caption query:
`card_attachments` where `ai_caption ilike pattern`, joined event→card→project,
emitted as a new `kind: "attachment"` `SearchHit` (its own result group, parallel
to projects/cards/events/comments). RLS on the read path keeps cost-sensitive
captions hidden from non-cost roles.

**Retrieval — `lib/assistant/retrieval.ts`.** When loading a card's events,
include each event's attachment captions in the context block, e.g.:
`  - [event:UUID] … · Lampiran: <ai_caption>`. Also add attachment-caption matches
to the keyword merge so a card surfaces when only its attachment matches the query.

**UI.** `EventAttachments.tsx` shows an "Analyzing…" pill while
`ai_status ∈ {pending,processing}`, the caption when `done`, and a "Re-analyze"
action when `failed` (resets to `pending`).

### Phase 2 — typed extraction + review chip

- Runner calls `analyze({ withExtraction: true })`; writes `ai_extracted` when
  `confidence ≥ threshold` (config, default 0.6).
- A **"Suggested from attachment"** chip appears on the card when a `done`
  attachment has `ai_extracted`. Clicking opens the existing `ProposalCard`
  **pre-filled** from `ai_extracted` (vendor/material/drawing). The human edits +
  confirms → commits through the existing `createCardEvent` mutation. Quote
  amounts therefore always pass `cost_visible` + the HIGH_RISK approval path.
- Numbers render with an **"AI-read · verify"** label until confirmed. Dismiss
  clears `ai_extracted` (caption stays).

### Phase 3 — Tanya live-read of originals

- `lib/assistant/retrieval.ts` returns, alongside cards, a short list of candidate
  visual attachments (image/PDF) on the most relevant cards, ranked by caption
  relevance to the query.
- The message route attaches the **top K (≤3) originals, ≤20 pages total** as
  image/document content blocks in the user turn; `streamAssistant` is extended to
  accept content blocks beside the text. Cheap caption filtering decides *whether*
  to spend vision tokens at all, so everyday questions stay text-priced.
- Answers may cite `[attachment:UUID]`; `extractCitations` learns that token.
- Audit (`assistant_audit_exchanges`) already records usage; vision tokens flow
  through unchanged.

## Components & boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `lib/attachments/analyze.ts` | Pure: bytes+mime → `{ caption, extracted, usage }` | `@anthropic-ai/sdk`, `@datum/types` |
| `app/api/cron/analyze-attachments` | Claim → download → analyze → write state | analyze, service-role supabase, storage |
| `card_attachments` state columns | Queue + audit of AI processing | migration |
| `lib/search/queries.ts` (+attachment group) | Surface captions in search (RLS-scoped) | supabase |
| `lib/assistant/retrieval.ts` (+captions) | Put captions in Tanya context; caption keyword merge | supabase |
| `EventAttachments.tsx` | Analyzing / caption / re-analyze states | realtime |
| `ProposalCard.tsx` (Phase 2) | Pre-filled review from `ai_extracted` | mutations |
| `streamAssistant` (Phase 3) | Accept image/document blocks within budget | anthropic |

`analyze.ts` is unit-tested with fixture files in isolation (no network/DB).

## Error handling

- **Unsupported / oversize / too many pages** → `skipped` with reason; file still
  attaches and is usable. Never blocks upload (fully async).
- **Claude or IO error** → `failed` + `ai_error`; auto-retried up to 3 attempts,
  then parked with a manual "Re-analyze".
- **Partial** (description ok, extraction fails) → save caption, `ai_extracted`
  null, `ai_status='done'`. Description is the safety net.
- **Idempotency** — `for update skip locked` claim + `ai_attempts` guard prevent
  double-processing and runaway retries.
- **Cost guards** — one-time per file; PDF page cap (20); Phase-3 per-query budget
  (≤3 files / ≤20 pages); monthly token-spend logged via existing audit.
- **Cost-data leak** — all caption/extracted *reads* go through RLS; the
  `cost_visible` quote caption is invisible to non-cost roles. Explicit test.
- **Hallucination** — extraction uses a strict schema; low confidence →
  `ai_extracted` null; description prompt told to say "tidak terbaca", not guess.

## Testing

- **Unit** (`tests/unit/analyze.test.ts`): image vs PDF request shape; caption
  present; extraction schema validated; low-confidence → null; "tidak terbaca"
  path. Fixtures: synthetic marble JPG, floor-plan PDF, sanitary-quote PDF (no
  real client data).
- **Unit**: search includes `ai_caption`; retrieval context includes captions;
  caption keyword merge surfaces the card.
- **Integration**: runner state machine `pending→processing→done/failed/skipped`;
  retry to 3 then park; `skip locked` idempotency (no double-process).
- **Security** (non-negotiable gate): a non-cost role never sees an amount-bearing
  caption/extracted in search or Tanya.
- **E2E** (Phase 2/3): upload sample quote PDF → caption + "Suggested vendor
  event" chip → confirm creates the event; ask a question needing the picture →
  answered with `[attachment:…]`; live-read budget enforced.
- **Build / typecheck / lint** kept green throughout.

## Operational notes (require user action — not auto-run)

- **DB push**: the additive migration must be applied to live Supabase
  (`supabase db push`). Flagged for the user; not run automatically.
- **Cron**: register `/api/cron/analyze-attachments` in Vercel project config
  (`vercel.json` crons or dashboard) — a deploy-time change.
- **Env**: `ANTHROPIC_API_KEY` already set; optional `ANTHROPIC_VISION_MODEL`
  (e.g. a Sonnet id) for higher extraction accuracy on quotes.
- **Realtime**: add `card_attachments` to the realtime publication (small
  migration) so captions appear live.

## Files touched

- `packages/db/supabase/migrations/<ts>_attachment_ai_state.sql` — **new**
  (status columns + index + realtime publication)
- `apps/web/lib/attachments/analyze.ts` — **new** (vision module)
- `apps/web/app/api/cron/analyze-attachments/route.ts` — **new** (runner)
- `apps/web/lib/search/queries.ts` — attachment caption search group
- `apps/web/lib/assistant/retrieval.ts` — captions in context + keyword merge
- `apps/web/components/board/EventAttachments.tsx` — analyzing/caption/re-analyze
- `apps/web/components/chat/ProposalCard.tsx` — Phase 2 pre-filled proposal
- `apps/web/lib/assistant/anthropic.ts` — Phase 3 content-block support
- `vercel.json` (or project config) — cron registration
- `apps/web/tests/unit/analyze.test.ts` + integration/security tests — **new**
