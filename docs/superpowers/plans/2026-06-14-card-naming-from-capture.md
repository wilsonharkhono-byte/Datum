# Card Naming From Captured Requests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the CATAT assistant matches a captured note to a Trello-import template placeholder card, create a new card titled `YYYY-MM-DD - <AI label>` (editable) and attach the event there, instead of burying it in the placeholder.

**Architecture:** A pure `isTemplateCardTitle` predicate + `deriveCardLabel` helper drive a server-side decision in the capture route. The route emits `createNew`/`newCardTitle`/`topicId` on the proposal. `createCard` now returns the new card id so `ProposalCard` can orchestrate create→event→upload→area-link client-side (same sequential style it already uses), with the new title editable before save.

**Tech Stack:** Next.js 16 (App Router, server actions), TypeScript, Supabase, Zod, Vitest, Anthropic SDK.

---

## File Structure

- `apps/web/lib/cards/template-card.ts` — **new**. Pure helpers: `isTemplateCardTitle`, `deriveCardLabel`. No deps, unit-tested.
- `apps/web/tests/unit/template-card.test.ts` — **new**. Unit tests for both helpers.
- `apps/web/lib/advisor/queries.ts` — **modify**. Use shared `isTemplateCardTitle` instead of inline regex.
- `apps/web/lib/cards/mutations.ts` — **modify**. `createCard` returns `id` alongside `slug`.
- `apps/web/app/api/assistant/capture/route.ts` — **modify**. Prompt gains `suggested_title`; route detects placeholder, builds `newCardTitle`, emits new proposal fields.
- `apps/web/components/chat/ProposalCard.tsx` — **modify**. `Proposal` type + editable new-card title + create-then-attach commit flow.

---

## Task 1: Pure helpers `isTemplateCardTitle` + `deriveCardLabel` (TDD)

**Files:**
- Test: `apps/web/tests/unit/template-card.test.ts`
- Create: `apps/web/lib/cards/template-card.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/template-card.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isTemplateCardTitle, deriveCardLabel } from "@/lib/cards/template-card";

describe("isTemplateCardTitle", () => {
  it("matches Trello-import placeholders (case-insensitive, trimmed)", () => {
    expect(isTemplateCardTitle("YYYY-MM-DD - Nama Gambar")).toBe(true);
    expect(isTemplateCardTitle("yyyy-mm-dd")).toBe(true);
    expect(isTemplateCardTitle("GUIDE")).toBe(true);
    expect(isTemplateCardTitle("Guide upload gambar kerja")).toBe(true);
    expect(isTemplateCardTitle("   GUIDE")).toBe(true);
  });

  it("does NOT match real cards", () => {
    expect(isTemplateCardTitle("2025 01 20 - master bedroom tambah bathtub")).toBe(false);
    expect(isTemplateCardTitle("Posisi sink di pantry")).toBe(false);
    expect(isTemplateCardTitle("guidelines kitchen")).toBe(false); // no word boundary
    expect(isTemplateCardTitle("")).toBe(false);
    expect(isTemplateCardTitle(null)).toBe(false);
    expect(isTemplateCardTitle(undefined)).toBe(false);
  });
});

describe("deriveCardLabel", () => {
  it("prefers the AI suggested_title when present", () => {
    expect(deriveCardLabel("Detail desain gazebo", { request_text: "x" }, "raw")).toBe(
      "Detail desain gazebo",
    );
  });

  it("falls through payload text fields when suggested is empty/non-string", () => {
    expect(deriveCardLabel(null, { request_text: "Detail design gazebo" }, "raw")).toBe(
      "Detail design gazebo",
    );
    expect(deriveCardLabel("", { description: "Pasang kusen lt 2" }, "raw")).toBe(
      "Pasang kusen lt 2",
    );
    expect(deriveCardLabel(42, { topic: "Granit dapur" }, "raw")).toBe("Granit dapur");
  });

  it("falls back to raw text when nothing else is usable", () => {
    expect(deriveCardLabel(null, {}, "catatan lapangan bebas")).toBe("catatan lapangan bebas");
  });

  it("collapses whitespace and truncates long labels with an ellipsis", () => {
    expect(deriveCardLabel("  a   b\n c ", {}, "raw")).toBe("a b c");
    const long = "x".repeat(120);
    const out = deriveCardLabel(long, {}, "raw");
    expect(out.length).toBe(81); // 80 chars + "…"
    expect(out.endsWith("…")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run tests/unit/template-card.test.ts`
Expected: FAIL — cannot resolve `@/lib/cards/template-card`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/lib/cards/template-card.ts`:

```ts
// Pure helpers for the CATAT capture flow. No server/runtime deps so they are
// unit-testable in the node vitest environment.

/**
 * Trello-import template/guide placeholder cards. Their titles start with
 * "GUIDE …" (the upload-instructions card) or the literal "YYYY-MM-DD …"
 * naming-convention stub. These are inactive-by-design slots, never real work.
 * A real card whose title starts with an actual date ("2025 01 20 - …") does
 * NOT match. Single source of truth — also used by the advisor stale-card feed.
 */
const TEMPLATE_TITLE = /^(guide\b|yyyy-mm-dd)/i;

export function isTemplateCardTitle(title: string | null | undefined): boolean {
  return TEMPLATE_TITLE.test((title ?? "").trim());
}

const LABEL_FIELDS = [
  "request_text", // client_request
  "description",  // work / drawing
  "topic",        // decision
  "item",         // material
  "body",         // note
  "caption",      // photo
  "title",        // document
  "vendor_name",  // vendor
] as const;

const MAX_LABEL = 80;

/**
 * Best descriptive label for a new card created from a captured note, WITHOUT a
 * date prefix (the caller prepends the date). Order: AI suggestion → primary
 * payload text field → the user's raw note. Whitespace is collapsed and the
 * result is truncated to MAX_LABEL chars (ellipsis appended when cut).
 */
export function deriveCardLabel(
  suggested: unknown,
  payload: Record<string, unknown>,
  rawText: string,
): string {
  const candidates: unknown[] = [
    suggested,
    ...LABEL_FIELDS.map((f) => payload[f]),
    rawText,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const t = c.trim().replace(/\s+/g, " ");
    if (t.length === 0) continue;
    return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL)}…` : t;
  }
  return "Catatan";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run tests/unit/template-card.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/cards/template-card.ts apps/web/tests/unit/template-card.test.ts
git commit -m "feat(web): pure helpers for template-card detection + card label"
```

---

## Task 2: Advisor uses the shared predicate

**Files:**
- Modify: `apps/web/lib/advisor/queries.ts` (inline regex around line 374-377)

- [ ] **Step 1: Add the import**

At the top of `apps/web/lib/advisor/queries.ts`, alongside the other `@/lib/...` imports, add:

```ts
import { isTemplateCardTitle } from "@/lib/cards/template-card";
```

- [ ] **Step 2: Replace the inline regex**

Replace:

```ts
  // Trello-import template cards (GUIDE / "YYYY-MM-DD - …" placeholders) are
  // permanently inactive by design — they'd flood the feed as false positives.
  const TEMPLATE_TITLE = /^(guide\b|yyyy-mm-dd)/i;
  for (const card of (staleCards ?? []).filter((c) => !TEMPLATE_TITLE.test(c.title ?? ""))) {
```

with:

```ts
  // Trello-import template cards (GUIDE / "YYYY-MM-DD - …" placeholders) are
  // permanently inactive by design — they'd flood the feed as false positives.
  for (const card of (staleCards ?? []).filter((c) => !isTemplateCardTitle(c.title))) {
```

- [ ] **Step 3: Verify advisor tests + typecheck still pass**

Run: `pnpm --filter web exec vitest run tests/unit/advisor-rank.test.ts && pnpm --filter web typecheck`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/advisor/queries.ts
git commit -m "refactor(web): advisor uses shared isTemplateCardTitle"
```

---

## Task 3: `createCard` returns the new card id

**Files:**
- Modify: `apps/web/lib/cards/mutations.ts` (`CreateCardResult`, `createCard`)

- [ ] **Step 1: Widen the result type**

Replace:

```ts
export type CreateCardResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };
```

with:

```ts
export type CreateCardResult =
  | { ok: true; slug: string; id: string }
  | { ok: false; error: string };
```

- [ ] **Step 2: Return the inserted id**

Replace the insert block in `createCard`:

```ts
  const { error } = await supabase.from("cards").insert({
    project_id:          input.projectId,
    topic_id:            input.topicId,
    title:               input.title,
    slug,
    created_by_staff_id: user.id,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}`);
  return { ok: true, slug };
```

with:

```ts
  const { data: inserted, error } = await supabase.from("cards").insert({
    project_id:          input.projectId,
    topic_id:            input.topicId,
    title:               input.title,
    slug,
    created_by_staff_id: user.id,
  }).select("id").single();
  if (error || !inserted) return { ok: false, error: error?.message ?? "Gagal membuat kartu" };

  revalidatePath(`/project/${input.projectCode}`);
  return { ok: true, slug, id: inserted.id };
```

- [ ] **Step 3: Typecheck (AddCardForm caller ignores the extra field)**

Run: `pnpm --filter web typecheck`
Expected: PASS — `AddCardForm.tsx` only reads `res.ok`/`res.error`, so the additive `id` is safe.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/cards/mutations.ts
git commit -m "feat(web): createCard returns new card id"
```

---

## Task 4: Capture route — suggested_title, placeholder detection, new-card fields

**Files:**
- Modify: `apps/web/app/api/assistant/capture/route.ts`

- [ ] **Step 1: Import the helpers**

After the existing imports (below the `@datum/types` import), add:

```ts
import { isTemplateCardTitle, deriveCardLabel } from "@/lib/cards/template-card";
```

- [ ] **Step 2: Teach the prompt about placeholders + `suggested_title`**

In `CAPTURE_SYSTEM`, add this bullet to the `ATURAN:` list (right after the `area_hint` bullet):

```ts
- suggested_title (judul kartu): Beberapa KARTU TERSEDIA adalah placeholder kosong dari import Trello — judulnya diawali "YYYY-MM-DD" atau "GUIDE". Placeholder BUKAN pekerjaan nyata; jika Anda memilih salah satunya, sistem akan MEMBUAT KARTU BARU. Dalam kasus itu WAJIB isi suggested_title: judul ringkas Bahasa Indonesia (3–8 kata) yang mendeskripsikan item/permintaan/gambar, TANPA tanggal (sistem menambah tanggal otomatis). Jika Anda memilih kartu nyata yang sudah ada, set suggested_title = null.
```

And in the `FORMAT OUTPUT` JSON block, add the field after `"area_hint"`:

```ts
  "area_hint": "<area_code dari AREA TERSEDIA, atau null>",
  "suggested_title": "<judul kartu ringkas tanpa tanggal, atau null>"
```

(Mind the comma: `"area_hint": ...,` must now end with a comma.)

- [ ] **Step 3: Parse `suggested_title`**

In the `parsed` destructure type, add the field:

```ts
  let parsed: {
    card_id?: unknown;
    event_kind?: unknown;
    payload?: unknown;
    rationale?: unknown;
    confidence?: unknown;
    area_hint?: unknown;
    suggested_title?: unknown;
  };
```

- [ ] **Step 4: Build the new-card decision before returning**

Immediately before the final `return NextResponse.json({ ok: true, proposal: { … } })`, insert:

```ts
  // If the AI matched a Trello-import template placeholder, the proposal will
  // CREATE A NEW card (named "<WIB-date> - <label>") rather than bury the event
  // in the stub. The placeholder card is left untouched as a naming guide.
  const createNew = isTemplateCardTitle(target.card.title);
  let newCardTitle: string | null = null;
  if (createNew) {
    const wibToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" })
      .format(new Date());
    const label = deriveCardLabel(
      parsed.suggested_title,
      payloadCheck.data as Record<string, unknown>,
      body.text,
    );
    newCardTitle = `${wibToday} - ${label}`.slice(0, 120);
  }
```

- [ ] **Step 5: Add the fields to the proposal payload**

In the returned `proposal` object, add after `areaHint:`:

```ts
      areaHint:   hintArea ? { areaId: hintArea.id, areaCode: hintArea.area_code, areaName: hintArea.area_name } : null,
      createNew,
      newCardTitle,
      topicId:    target.card.topic_id,
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: PASS. (`target.card.topic_id` exists on the `Card` row type.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/assistant/capture/route.ts
git commit -m "feat(web): capture route proposes a new card for template placeholders"
```

---

## Task 5: ProposalCard — editable new-card title + create-then-attach

**Files:**
- Modify: `apps/web/components/chat/ProposalCard.tsx`

- [ ] **Step 1: Import `createCard` and extend the `Proposal` type**

Change the mutations import line to include `createCard`:

```ts
import { createCard, createCardEvent, attachToEvent } from "@/lib/cards/mutations";
```

Add three fields to the `Proposal` type (after `areaHint?`):

```ts
  // When the AI matched a Trello-import template placeholder card, the save
  // creates a NEW card instead of burying the event in the placeholder.
  createNew?:    boolean;
  newCardTitle?: string | null;  // default title for the new card ("YYYY-MM-DD - …")
  topicId?:      string;         // column the new card is created in
```

- [ ] **Step 2: Add title + savedCard state**

After the `const [areaLinked, setAreaLinked] = useState(false);` line, add:

```ts
  const [title, setTitle] = useState(proposal.newCardTitle ?? "");
  // The card the event ultimately landed on — equals the proposal card unless a
  // new card was created on commit. Drives the saved-state "Buka kartu" link.
  const [savedCard, setSavedCard] = useState<{ slug: string; title: string }>({
    slug: proposal.cardSlug,
    title: proposal.cardTitle,
  });
```

- [ ] **Step 3: Replace `commit()` with the create-then-attach version**

Replace the entire `commit()` function body with:

```ts
  function commit() {
    setError(null);
    setStatus("saving");

    startTransition(async () => {
      // 1. Resolve the target card. When the AI matched a template placeholder,
      //    create a fresh, properly-named card instead of writing into the stub.
      let cardId = proposal.cardId;
      let cardSlug = proposal.cardSlug;
      let cardTitle = proposal.cardTitle;

      if (proposal.createNew) {
        const finalTitle = (title.trim() || (proposal.newCardTitle ?? "").trim());
        if (!finalTitle) {
          setStatus("error");
          setError("Judul kartu tidak boleh kosong");
          return;
        }
        if (!proposal.topicId) {
          setStatus("error");
          setError("Kolom kartu tidak diketahui — tidak bisa membuat kartu baru");
          return;
        }
        const cf = new FormData();
        cf.set("projectId", proposal.projectId);
        cf.set("topicId", proposal.topicId);
        cf.set("projectCode", proposal.projectCode);
        cf.set("title", finalTitle);
        const created = await createCard(cf);
        if (!created.ok) {
          setStatus("error");
          setError(created.error);
          return;
        }
        cardId = created.id;
        cardSlug = created.slug;
        cardTitle = finalTitle;
      }

      // 2. Attach the event to the resolved card.
      const fd = new FormData();
      fd.set("cardId",      cardId);
      fd.set("projectId",   proposal.projectId);
      fd.set("projectCode", proposal.projectCode);
      fd.set("cardSlug",    cardSlug);
      fd.set("eventKind",   proposal.eventKind);
      for (const [k, v] of Object.entries(proposal.payload)) {
        const value = Array.isArray(v)
          ? v.join(",")
          : v == null
          ? ""
          : String(v);
        fd.set(`payload_${k}`, value);
      }
      if (proposal.rationale && proposal.rationale.trim().length > 0) {
        fd.set("payload_ai_rationale", proposal.rationale);
      }
      const res = await createCardEvent(fd);
      if (!res.ok) {
        setStatus("error");
        setError(
          proposal.createNew
            ? `Kartu "${cardTitle}" dibuat, tapi gagal menyimpan catatan: ${res.error}`
            : res.error,
        );
        return;
      }

      // 3. Upload pending file if present.
      if (proposal.pendingFile) {
        const up = await uploadCardAttachment({
          file: proposal.pendingFile,
          projectId: proposal.projectId,
          cardId,
          cardEventId: res.eventId,
        });
        if (!up.ok) {
          setStatus("error");
          setError(`Event tersimpan tapi upload gagal: ${up.error}`);
          return;
        }
        const aFd = new FormData();
        aFd.set("cardEventId", res.eventId);
        aFd.set("projectCode", proposal.projectCode);
        aFd.set("cardSlug", cardSlug);
        aFd.set("storagePath", up.storagePath);
        aFd.set("mimeType", up.mimeType);
        const a = await attachToEvent(aFd);
        if (!a.ok) {
          setStatus("error");
          setError(`Event tersimpan tapi simpan lampiran gagal: ${a.error}`);
          return;
        }
      }

      // 4. Optionally link the card to the hinted area.
      if (areaHint && linkArea) {
        const lf = new FormData();
        lf.set("cardId", cardId);
        lf.set("areaId", areaHint.areaId);
        lf.set("projectCode", proposal.projectCode);
        lf.set("cardSlug", cardSlug);
        const linkRes = await linkCardToArea(lf);
        if (linkRes.ok) {
          setAreaLinked(true);
        } else {
          setError(`Catatan tersimpan, tapi gagal menautkan ke ${areaHint.areaName}: ${linkRes.error}`);
        }
      }

      setSavedCard({ slug: cardSlug, title: cardTitle });
      setStatus("saved");
    });
  }
```

- [ ] **Step 4: Render the editable title in the header**

Replace the header block:

```tsx
      <div className="mb-1 flex items-center justify-between">
        <div className="font-semibold text-foreground">
          → {proposal.cardTitle}
          <span className="ml-1 font-normal text-[var(--text-muted)]">· {proposal.topicName}</span>
        </div>
        <span className={`text-[10px] font-semibold uppercase ${confColor}`}>{conf}% yakin</span>
      </div>
```

with:

```tsx
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 font-semibold text-foreground">
          {proposal.createNew && (status === "pending" || status === "error") ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--sand-dark)]">
                Kartu baru
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                aria-label="Judul kartu baru"
                className="w-full rounded border border-[var(--sand)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold text-foreground focus:border-[var(--sand-dark)] focus:outline-none"
              />
              <span className="text-[10px] font-normal text-[var(--text-muted)]">· {proposal.topicName}</span>
            </div>
          ) : (
            <>
              → {proposal.createNew ? savedCard.title : proposal.cardTitle}
              <span className="ml-1 font-normal text-[var(--text-muted)]">· {proposal.topicName}</span>
            </>
          )}
        </div>
        <span className={`shrink-0 text-[10px] font-semibold uppercase ${confColor}`}>{conf}% yakin</span>
      </div>
```

- [ ] **Step 5: Reflect new-card in the saved footer**

Replace the saved-state label:

```tsx
            {isHighRisk ? "Tersimpan di kartu · principal dinotifikasi" : "Tersimpan di kartu"}
```

with:

```tsx
            {isHighRisk
              ? "Tersimpan di kartu · principal dinotifikasi"
              : proposal.createNew
              ? "Kartu baru dibuat · catatan tersimpan"
              : "Tersimpan di kartu"}
```

Replace the saved-state "Buka" link (uses the resolved slug/title):

```tsx
          <a
            href={`/project/${proposal.projectCode}/cards/${proposal.cardSlug}`}
            className="inline-flex items-center gap-1 rounded border border-[var(--sand)] bg-[var(--surface)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--sand-dark)] hover:border-[var(--sand-dark)] hover:bg-[var(--sand-tint)]"
            aria-label={`Buka kartu ${proposal.cardTitle}`}
          >
            → Buka {proposal.cardTitle}
          </a>
```

with:

```tsx
          <a
            href={`/project/${proposal.projectCode}/cards/${savedCard.slug}`}
            className="inline-flex items-center gap-1 rounded border border-[var(--sand)] bg-[var(--surface)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--sand-dark)] hover:border-[var(--sand-dark)] hover:bg-[var(--sand-tint)]"
            aria-label={`Buka kartu ${savedCard.title}`}
          >
            → Buka {savedCard.title}
          </a>
```

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS. (`createCard` is now imported; `savedCard`/`title` state used.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/chat/ProposalCard.tsx
git commit -m "feat(web): ProposalCard creates a named new card for placeholder matches"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm --filter web test`
Expected: PASS, including the new `template-card.test.ts`.

- [ ] **Step 2: Production build**

Run: `pnpm --filter web build`
Expected: build succeeds, no type errors.

- [ ] **Step 3: Manual preview check**

Start the dev server, open a project board, switch the assistant to **Catat**, and type a field request that won't match a real card (e.g. `Detail design gazebo belakang`). Expected:
- Proposal renders **"Kartu baru"** with an editable title prefilled `2026-06-14 - <label>`.
- The area-link checkbox is present and on (if the note names a room).
- Saving creates a new card with that title in the matched column; the event is attached; "Kartu baru dibuat · catatan tersimpan" appears; "Buka <new title>" opens the new card.
- A note that clearly matches an existing real card still attaches in place (no new card).

---

## Self-Review

- **Spec coverage:** placeholder detection (Task 1/2), AI `suggested_title` (Task 4), title assembly + WIB date + fallback (Task 1 `deriveCardLabel` + Task 4), `createCard` id (Task 3), editable title + create-then-attach + area link (Task 5), tests (Task 1), build/typecheck/lint (Tasks 2–6). All covered.
- **Placeholder scan:** no TBD/TODO; every code step shows full code.
- **Type consistency:** `CreateCardResult` gains `id` (Task 3) and is consumed as `created.id` (Task 5). `Proposal.createNew/newCardTitle/topicId` defined (Task 5 Step 1) and emitted by the route (Task 4 Step 5). `deriveCardLabel(suggested, payload, rawText)` / `isTemplateCardTitle(title)` signatures match across Tasks 1, 2, 4.
