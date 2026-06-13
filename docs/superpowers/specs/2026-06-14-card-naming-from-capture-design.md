# Meaningful card names from captured requests (CATAT)

**Date:** 2026-06-14
**Status:** Approved — ready for implementation plan
**Area:** Assistant CATAT flow (capture → proposal → save)

## Problem

In CATAT mode the assistant never creates a card. It picks the closest *existing*
card (`card_id` chosen from the retrieved set) and attaches a typed event to it.
When nothing real matches — e.g. a new field request like "Detail design gazebo"
in area `A01-03` — the model lands on a leftover **Trello-import template
placeholder** card titled `YYYY-MM-DD - Nama Gambar`. The proposal then just echoes
that placeholder title (`cardTitle: target.card.title`,
`apps/web/app/api/assistant/capture/route.ts:184`), and on save the event is buried
inside a meaninglessly-named card.

The studio's drawing-card convention is `YYYY-MM-DD - <name>` (e.g. the real card
`2025 01 20 - master bedroom tambah bathtub`). The placeholder is literally a
template demonstrating that convention. Captured requests should follow it.

## Goals

- When the assistant would attach an event to a **template placeholder** card,
  create a **new card** instead, titled `<YYYY-MM-DD> - <concise label>`, and attach
  the event to the new card.
- The template placeholder card is left untouched, so each area keeps its naming
  guide and the next request still has a placeholder to match against.
- The date prefix uses `YYYY-MM-DD` in WIB (Asia/Jakarta) calendar semantics.
- The descriptive part is an AI-generated short label, editable before save.
- When the assistant picks a **real** card, behavior is unchanged (attach event).

## Non-goals

- Manual `+ tambah kartu` (`AddCardForm`) — already starts with an empty title,
  not in scope.
- TANYA (read-only Q&A) — not in scope.
- Renaming existing placeholder cards in place (explicitly rejected: the template
  must persist as a guide).
- Making the AI decide attach-vs-create beyond the placeholder heuristic. Picking a
  placeholder *is* the "no real card matches → new card" signal.

## Design

### 1. Shared placeholder detection

The only existing detector is `TEMPLATE_TITLE = /^(guide\b|yyyy-mm-dd)/i` inside
`apps/web/lib/advisor/queries.ts:376`. Extract it into a shared helper so the
advisor and the capture route share one definition:

```ts
// apps/web/lib/cards/template-card.ts
/**
 * Trello-import template/guide placeholder cards. Their titles start with
 * "GUIDE …" or the literal "YYYY-MM-DD …" naming-convention stub. These are
 * inactive-by-design slots, never real work. A real card whose title starts
 * with an actual date ("2025 01 20 - …") does NOT match.
 */
const TEMPLATE_TITLE = /^(guide\b|yyyy-mm-dd)/i;

export function isTemplateCardTitle(title: string | null | undefined): boolean {
  return TEMPLATE_TITLE.test((title ?? "").trim());
}
```

`apps/web/lib/advisor/queries.ts` imports and uses `isTemplateCardTitle` in place of
its inline regex (behavior identical).

### 2. AI returns a title label

Add a `suggested_title` field to the capture model's JSON contract:

- A concise Indonesian label for the item/drawing/request (≈3–8 words), **without**
  a date prefix. Example: `Detail desain gazebo`.
- Instruction: required when the chosen card is a template placeholder; otherwise
  optional / `null`.

The prompt's output schema gains:
```
"suggested_title": "<judul ringkas tanpa tanggal, atau null>"
```
with a rule explaining that placeholder cards (`YYYY-MM-DD …` / `GUIDE …`) are empty
slots and a fresh, descriptive title must be supplied.

### 3. Title assembly + fallback (server)

In the capture route, after validating the chosen card:

```ts
const wibToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" })
  .format(new Date()); // → "2026-06-14"

const createNew = isTemplateCardTitle(target.card.title);
let newCardTitle: string | null = null;
if (createNew) {
  const label = deriveLabel(parsed.suggested_title, payloadCheck.data, body.text);
  newCardTitle = `${wibToday} - ${label}`.slice(0, 120); // cards.title max 120
}
```

`deriveLabel` order, first non-empty wins, trimmed to a sane length (~80 chars):
1. `suggested_title` from the model (if a non-empty string)
2. a primary text field from the validated payload — `request_text`, `description`,
   `topic`, `item`, `body`, `caption`, `title`, `vendor_name`
3. the user's raw `text`

This guarantees we never create a card titled with only a bare date.

The route's `proposal` object gains:
```ts
createNew,                              // boolean
newCardTitle,                           // string | null (only when createNew)
topicId: target.card.topic_id,          // column for the new card
```
(`topic_id` is already present on the retrieved `Card` row — currently only
`topicName` is forwarded.)

### 4. `createCard` returns the new id

`createCard` currently returns `{ ok: true, slug }`. Attaching an event and linking
an area both need the new card's UUID, so add it:

```ts
export type CreateCardResult =
  | { ok: true; slug: string; id: string }
  | { ok: false; error: string };
```
The insert becomes `.insert({...}).select("id").single()` and returns `id`. The one
other caller (`AddCardForm.tsx`) ignores the extra field — additive and safe.

### 5. ProposalCard: editable new-card title + create-then-attach

The `Proposal` type gains `createNew?: boolean`, `newCardTitle?: string | null`,
`topicId?: string`.

When `createNew`:
- The preview header reads **"Kartu baru: …"** instead of `→ <existing title>`.
- The title renders as an **editable text input**, prefilled with `newCardTitle`,
  `maxLength={120}`, so the user can correct an off label before saving. Local
  state `title`, defaulting to `newCardTitle`.
- On commit (client-orchestrated, mirroring the existing sequential style):
  1. `createCard({ projectId, topicId, projectCode, title })` → `{ id, slug }`.
     On failure: surface error, abort.
  2. `createCardEvent` against the new `{ cardId: id, cardSlug: slug }` (rest of the
     existing payload-FormData logic unchanged).
  3. File upload (if any) + `attachToEvent` against the new event/card.
  4. Optional area link against the new card (checkbox stays, default on — a fresh
     card especially benefits from being linked to its area for the gate matrix).
  5. The "saved" footer's "Buka <card>" link uses the new slug/title.

When `!createNew`: the existing path runs verbatim (attach to `proposal.cardId`).

### Date / timezone

Reuse the codebase's canonical WIB idiom
`new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())`
(already used in `Board.tsx:36`, `MiniCard.tsx:68`). Computed server-side in the
route; the `Intl` timezone conversion is correct regardless of the server clock.

## Components & boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `isTemplateCardTitle(title)` | Pure predicate: is this a template/guide placeholder? | none |
| `deriveLabel(suggested, payload, rawText)` | Pure: pick the best descriptive label | none |
| capture route | Detect placeholder, assemble default title, emit new proposal fields | helpers above |
| `createCard` | Insert card, return `{ id, slug }` | supabase |
| `ProposalCard` | Render editable title (new-card mode); orchestrate create→event→attach→link | mutations |

`deriveLabel` and `isTemplateCardTitle` are pure and unit-tested in isolation.

## Error handling

- Client-orchestrated save is non-atomic, same as today's event→area-link sequence.
  Payloads are server-validated at capture, so the create→event step rarely fails.
  If `createCardEvent` fails after `createCard` succeeds, the user gets a clearly-
  named empty card and an error message — harmless and retryable.
- Area-link failure is soft (already the case): the event/card still save; a soft
  notice is shown.
- Title input cannot be empty: if the user clears it, fall back to the
  `newCardTitle` default (or disable save until non-empty).

## Testing

- **Unit** (`tests/unit/template-card.test.ts`): `isTemplateCardTitle` matches
  `GUIDE …`, `YYYY-MM-DD - Nama Gambar`, case-insensitive; does NOT match real dated
  titles (`2025 01 20 - …`), normal titles, empty/null.
- **Unit** (`deriveLabel`): prefers `suggested_title`; falls through payload fields;
  finally raw text; never returns empty.
- **Manual / preview**: CATAT a field request that lands on a placeholder → proposal
  shows "Kartu baru" with an editable `2026-06-14 - …` title → save → a new card with
  that title appears on the board in the right column, event attached, optionally
  area-linked. Verify a request matching a real card still attaches in place.
- **Build/typecheck/lint** kept green throughout.

## Files touched

- `apps/web/lib/cards/template-card.ts` — **new** (`isTemplateCardTitle`)
- `apps/web/lib/advisor/queries.ts` — use shared helper
- `apps/web/app/api/assistant/capture/route.ts` — prompt + `suggested_title` parse +
  placeholder detection + title assembly + `deriveLabel` + new proposal fields
- `apps/web/lib/cards/mutations.ts` — `createCard` returns `id`
- `apps/web/components/chat/ProposalCard.tsx` — `Proposal` type + editable title +
  create-then-attach flow
- `apps/web/tests/unit/template-card.test.ts` — **new**
