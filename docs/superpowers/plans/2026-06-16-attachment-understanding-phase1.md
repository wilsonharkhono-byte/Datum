# Attachment Understanding — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate a rich, searchable AI description (`ai_caption`) for every image/PDF card attachment, asynchronously, and surface those captions in global search and the assistant's Tanya context.

**Architecture:** A Vercel Cron route (service-role) claims `pending` attachments via an atomic Postgres RPC, downloads each from Supabase Storage, sends the bytes to Claude (already-wired `@anthropic-ai/sdk`, Haiku) for a description, and writes the caption + processing state back. Search and retrieval read captions through the normal RLS-scoped client, so cost-visibility gating is inherited. Uploads are never blocked.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + Storage), `@anthropic-ai/sdk` 0.30.x, Vitest. Spec: `docs/superpowers/specs/2026-06-16-attachment-understanding-design.md`.

**Phase scope:** Phase 1 only (description + search + Tanya context + UI). Phase 2 (typed `ai_extracted` + proposal chip) and Phase 3 (Tanya live-read of originals) get their own plans.

**Page-cap note:** The spec mentions a 20-page PDF cap. Counting PDF pages needs a parser dependency; Phase 1 relies on the bucket's existing 20 MB size cap instead and defers the page cap to a later refinement. This is the one intentional deviation from the spec.

**SDK-upgrade note (added during execution):** The pinned `@anthropic-ai/sdk@0.30.1` had no PDF/document content-block support, so Phase 1 begins by upgrading to `^0.104.2` and refactoring the three `beta.promptCaching.messages` call sites (`anthropic.ts`, `capture/route.ts`, `areas/extract.ts`) to the stable `messages` API — prompt caching is GA so `cachedSystemBlock`'s shape is unchanged; a shared `textOf()` helper handles the richer `ContentBlock` union. This appears as the first commit ("Task 0"). PDFs (floor plans, quotes) are fully supported as a result. Image media types are limited to jpeg/png/gif/webp (HEIC/HEIF are skipped, not failed).

---

## File Structure

| File | Responsibility | New/Modified |
| --- | --- | --- |
| `packages/db/supabase/migrations/20260616000001_attachment_ai_state.sql` | AI-state enum + columns + index + claim RPC + realtime pub | **New** |
| `packages/db/src/types.generated.ts` | Hand-add the new columns + RPC to generated types (until `supabase gen types` is re-run) | Modified |
| `apps/web/lib/attachments/analyze.ts` | Pure vision helpers + `describeAttachment` (the only file that calls the vision model) | **New** |
| `apps/web/app/api/cron/analyze-attachments/route.ts` | Cron runner: claim → download → describe → write state | **New** |
| `apps/web/lib/search/queries.ts` | Add `attachments` caption search group | Modified |
| `apps/web/app/(app)/search/page.tsx` | Render the new attachments group | Modified |
| `apps/web/lib/assistant/retrieval.ts` | Load attachment captions; render `Lampiran:` lines; caption keyword merge | Modified |
| `apps/web/lib/cards/mutations.ts` | `reanalyzeAttachment` server action | Modified |
| `apps/web/components/board/EventAttachments.tsx` | Analyzing / caption / re-analyze UI states | Modified |
| `apps/web/vercel.json` | Register the cron schedule | Modified |
| `apps/web/tests/unit/analyze.test.ts` | Unit tests for the pure vision helpers | **New** |
| `apps/web/tests/unit/search-queries.test.ts` | Add attachments-group test | Modified |
| `apps/web/tests/unit/assistant-retrieval.test.ts` | Add caption-in-context test | Modified |

**Test command (single file):** `cd apps/web && pnpm exec vitest run <path>`
**Typecheck:** `cd apps/web && pnpm typecheck`

---

## Task 1: Database migration (AI-state columns, claim RPC, realtime)

**Files:**
- Create: `packages/db/supabase/migrations/20260616000001_attachment_ai_state.sql`

> SQL can't be unit-tested here (the project runs against live Supabase; `supabase db push` is a **user action**, see Task 9). Verification is SQL self-review + downstream typecheck.

- [ ] **Step 1: Write the migration**

```sql
-- 20260616000001_attachment_ai_state.sql
-- AI attachment understanding, Phase 1: processing-state for card_attachments
-- so a background runner can describe images/PDFs into ai_caption.
-- ai_caption / ai_extracted already exist (20260601000001_cards_layer.sql).
-- Additive only (live DB → supabase db push).

begin;

-- 1. Processing lifecycle for a single attachment.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attachment_ai_status') then
    create type public.attachment_ai_status as enum
      ('pending','processing','done','failed','skipped');
  end if;
end $$;

alter table public.card_attachments
  add column if not exists ai_status       public.attachment_ai_status not null default 'pending',
  add column if not exists ai_error        text,
  add column if not exists ai_model        text,
  add column if not exists ai_processed_at timestamptz,
  add column if not exists ai_attempts     int not null default 0;

-- 2. Work-queue index: rows the runner should pick up.
create index if not exists card_attachments_ai_pending_idx
  on public.card_attachments (ai_status, created_at)
  where ai_status in ('pending','failed');

-- 3. Atomic claim: flip up to p_limit eligible rows to 'processing' and return
--    them. `for update skip locked` lets overlapping cron ticks not collide.
--    Service-role only (revoked from anon/authenticated).
create or replace function public.claim_attachments_for_analysis(p_limit int default 5)
returns setof public.card_attachments
language sql
security definer
set search_path = public
as $$
  update public.card_attachments
     set ai_status = 'processing',
         ai_attempts = ai_attempts + 1
   where id in (
     select id
       from public.card_attachments
      where ai_status in ('pending','failed')
        and ai_attempts < 3
      order by created_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning *;
$$;

revoke all on function public.claim_attachments_for_analysis(int) from public;
revoke all on function public.claim_attachments_for_analysis(int) from anon;
revoke all on function public.claim_attachments_for_analysis(int) from authenticated;

-- 4. Realtime so the open card view swaps "Menganalisis…" for the caption live.
do $$
begin
  begin
    alter publication supabase_realtime add table public.card_attachments;
  exception when duplicate_object then null;
  end;
end $$;

commit;
```

- [ ] **Step 2: Self-review the SQL**

Confirm: enum guarded by `if not exists`; all `add column` use `if not exists` (idempotent re-run safe); RPC is `security definer` + `set search_path = public` + execute revoked from `anon`/`authenticated`; realtime add is duplicate-safe. Expected: all true.

- [ ] **Step 3: Commit**

```bash
git add packages/db/supabase/migrations/20260616000001_attachment_ai_state.sql
git commit -m "feat(db): attachment AI processing state + claim RPC (phase 1)"
```

---

## Task 2: Update generated DB types

**Files:**
- Modify: `packages/db/src/types.generated.ts` (card_attachments Row/Insert/Update ~628-653; Functions section)

> Hand-edit keeps `pnpm typecheck` green before the live `supabase gen types` re-run. Re-generating after push will reproduce the same shape.

- [ ] **Step 1: Add the columns to Row/Insert/Update**

In the `card_attachments` block, add to **Row**:
```ts
          ai_status: Database["public"]["Enums"]["attachment_ai_status"]
          ai_error: string | null
          ai_model: string | null
          ai_processed_at: string | null
          ai_attempts: number
```
add to **Insert** and **Update** (all optional):
```ts
          ai_status?: Database["public"]["Enums"]["attachment_ai_status"]
          ai_error?: string | null
          ai_model?: string | null
          ai_processed_at?: string | null
          ai_attempts?: number
```

- [ ] **Step 2: Add the enum**

In `public.Enums`, add:
```ts
      attachment_ai_status: "pending" | "processing" | "done" | "failed" | "skipped"
```

- [ ] **Step 3: Add the RPC to Functions**

In `public.Functions`, add:
```ts
      claim_attachments_for_analysis: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["card_attachments"]["Row"][]
      }
```

- [ ] **Step 4: Verify typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/types.generated.ts
git commit -m "chore(db): regen types for attachment AI state"
```

---

## Task 3: Vision module `lib/attachments/analyze.ts` (TDD)

**Files:**
- Create: `apps/web/lib/attachments/analyze.ts`
- Test: `apps/web/tests/unit/analyze.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/unit/analyze.test.ts
import { describe, expect, it } from "vitest";
import {
  attachmentKind,
  attachmentSkipReason,
  buildDescribeMessages,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/attachments/analyze";

describe("attachmentKind", () => {
  it("maps image/* to image and pdf to pdf", () => {
    expect(attachmentKind("image/jpeg")).toBe("image");
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("application/pdf")).toBe("pdf");
  });
  it("returns null for unsupported types", () => {
    expect(attachmentKind("text/plain")).toBeNull();
    expect(attachmentKind("application/zip")).toBeNull();
  });
});

describe("attachmentSkipReason", () => {
  it("skips unsupported mime", () => {
    expect(attachmentSkipReason("text/plain", 10)).toBe("unsupported");
  });
  it("skips oversize files", () => {
    expect(attachmentSkipReason("image/png", MAX_ATTACHMENT_BYTES + 1)).toBe("oversize");
  });
  it("allows supported, in-size files", () => {
    expect(attachmentSkipReason("application/pdf", 1000)).toBeNull();
  });
});

describe("buildDescribeMessages", () => {
  it("uses an image block for images", () => {
    const msgs = buildDescribeMessages({ kind: "image", base64: "AAA", mimeType: "image/jpeg" });
    const block = (msgs[0]!.content as any[])[0];
    expect(block.type).toBe("image");
    expect(block.source.media_type).toBe("image/jpeg");
    expect(block.source.data).toBe("AAA");
    // instruction text present
    expect((msgs[0]!.content as any[])[1].type).toBe("text");
  });
  it("uses a document block for pdfs", () => {
    const msgs = buildDescribeMessages({ kind: "pdf", base64: "BBB", mimeType: "application/pdf" });
    const block = (msgs[0]!.content as any[])[0];
    expect(block.type).toBe("document");
    expect(block.source.media_type).toBe("application/pdf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run tests/unit/analyze.test.ts`
Expected: FAIL — cannot resolve `@/lib/attachments/analyze`.

- [ ] **Step 3: Write the module**

```ts
// apps/web/lib/attachments/analyze.ts
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, getModel } from "@/lib/assistant/anthropic";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // matches the bucket cap

export type AttachmentKind = "image" | "pdf";

export function attachmentKind(mimeType: string): AttachmentKind | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return null;
}

/** Returns a skip reason string, or null if the file is processable. */
export function attachmentSkipReason(mimeType: string, sizeBytes: number): string | null {
  if (!attachmentKind(mimeType)) return "unsupported";
  if (sizeBytes > MAX_ATTACHMENT_BYTES) return "oversize";
  return null;
}

const DESCRIBE_INSTRUCTION = `Anda asisten internal DATUM (studio interior/konstruksi).
Deskripsikan lampiran ini dalam Bahasa Indonesia, 1–3 kalimat ringkas, untuk dicari kembali nanti.
- Foto material/marmer: sebutkan warna, motif/urat, dan finish (matte/polish) bila terlihat.
- Gambar kerja/denah (PDF): sebutkan jenis gambar dan kode/revisi bila terbaca.
- Penawaran/quote (PDF): sebutkan nama vendor, perkiraan total, dan masa berlaku bila terbaca.
Hanya sebut yang benar-benar terlihat/terbaca. Untuk hal yang tidak jelas tulis "tidak terbaca". Jangan menebak.`;

export function buildDescribeMessages(args: {
  kind: AttachmentKind;
  base64: string;
  mimeType: string;
}): Anthropic.MessageParam[] {
  const media =
    args.kind === "image"
      ? {
          type: "image" as const,
          source: { type: "base64" as const, media_type: args.mimeType as "image/jpeg", data: args.base64 },
        }
      : {
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: args.base64 },
        };
  return [{ role: "user", content: [media, { type: "text", text: DESCRIBE_INSTRUCTION }] }];
}

export type DescribeResult = {
  caption: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

/** Calls the vision model for a description. Throws on unsupported mime or API error. */
export async function describeAttachment(args: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<DescribeResult> {
  const kind = attachmentKind(args.mimeType);
  if (!kind) throw new Error("unsupported_mime");
  const base64 = Buffer.from(args.bytes).toString("base64");
  const model = getModel();
  const res = await getAnthropicClient().messages.create({
    model,
    max_tokens: 512,
    messages: buildDescribeMessages({ kind, base64, mimeType: args.mimeType }),
  });
  const caption = res.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();
  return {
    caption,
    model,
    usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run tests/unit/analyze.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/attachments/analyze.ts apps/web/tests/unit/analyze.test.ts
git commit -m "feat(web): vision module to describe image/PDF attachments"
```

---

## Task 4: Cron runner route (TDD on the auth guard)

**Files:**
- Create: `apps/web/app/api/cron/analyze-attachments/route.ts`
- Test: `apps/web/tests/unit/analyze.test.ts` (append auth-guard tests)

- [ ] **Step 1: Append the failing test**

Append to `apps/web/tests/unit/analyze.test.ts`:
```ts
import { isCronAuthorized } from "@/app/api/cron/analyze-attachments/route";

describe("isCronAuthorized", () => {
  it("rejects when no secret configured", () => {
    expect(isCronAuthorized(new Request("http://x", { headers: { authorization: "Bearer s" } }), undefined)).toBe(false);
  });
  it("rejects a wrong bearer", () => {
    expect(isCronAuthorized(new Request("http://x", { headers: { authorization: "Bearer nope" } }), "s")).toBe(false);
  });
  it("accepts the matching bearer", () => {
    expect(isCronAuthorized(new Request("http://x", { headers: { authorization: "Bearer s" } }), "s")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run tests/unit/analyze.test.ts`
Expected: FAIL — cannot resolve the route module / `isCronAuthorized`.

- [ ] **Step 3: Write the route**

```ts
// apps/web/app/api/cron/analyze-attachments/route.ts
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { describeAttachment, attachmentSkipReason } from "@/lib/attachments/analyze";

export const maxDuration = 300; // Fluid Compute default ceiling
const BATCH = 5;

/** Pure: validate Vercel Cron's bearer. Exported for unit testing. */
export function isCronAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: claimed, error } = await supabase.rpc("claim_attachments_for_analysis", { p_limit: BATCH });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = () => new Date().toISOString();
  let done = 0, skipped = 0, failed = 0;

  for (const att of claimed ?? []) {
    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from("card-attachments")
        .download(att.storage_path);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? "download_failed");

      const skip = attachmentSkipReason(att.mime_type, blob.size);
      if (skip) {
        await supabase.from("card_attachments")
          .update({ ai_status: "skipped", ai_error: skip, ai_processed_at: now() })
          .eq("id", att.id);
        skipped++;
        continue;
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { caption, model } = await describeAttachment({ bytes, mimeType: att.mime_type });
      await supabase.from("card_attachments")
        .update({ ai_caption: caption, ai_status: "done", ai_model: model, ai_error: null, ai_processed_at: now() })
        .eq("id", att.id);
      done++;
    } catch (e) {
      await supabase.from("card_attachments")
        .update({ ai_status: "failed", ai_error: errMsg(e), ai_processed_at: now() })
        .eq("id", att.id);
      failed++;
    }
  }

  return NextResponse.json({ claimed: claimed?.length ?? 0, done, skipped, failed });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run tests/unit/analyze.test.ts`
Expected: PASS (now 11 assertions incl. auth guard).

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/cron/analyze-attachments/route.ts apps/web/tests/unit/analyze.test.ts
git commit -m "feat(web): cron runner to analyze pending attachments"
```

---

## Task 5: Search — attachments caption group (TDD)

**Files:**
- Modify: `apps/web/lib/search/queries.ts`
- Modify: `apps/web/app/(app)/search/page.tsx`
- Test: `apps/web/tests/unit/search-queries.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/tests/unit/search-queries.test.ts`:
```ts
function clientReturningAttachments(rows: unknown[]) {
  const passthru: any = {
    select: () => passthru, or: () => passthru, ilike: () => passthru,
    is: () => passthru, limit: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    from(table: string) {
      if (table === "card_attachments") {
        const ab: any = {
          select: () => ab, ilike: () => ab,
          limit: () => Promise.resolve({ data: rows, error: null }),
        };
        return ab;
      }
      return passthru;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("searchAll attachments group", () => {
  it("returns attachment caption hits", async () => {
    const supabase = clientReturningAttachments([
      {
        id: "a1",
        ai_caption: "Marmer Statuario, urat abu-abu, finish polish",
        mime_type: "image/jpeg",
        card_events: { cards: { slug: "master-bath", title: "Master bath", projects: { project_code: "ARIN" } } },
      },
    ]);
    const res = await searchAll(supabase, "statuario");
    expect(res.attachments).toHaveLength(1);
    const hit = res.attachments[0]!;
    expect(hit.kind).toBe("attachment");
    expect(hit.projectCode).toBe("ARIN");
    expect(hit.href).toBe("/project/ARIN/cards/master-bath");
    expect(hit.snippet).toContain("Statuario");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run tests/unit/search-queries.test.ts`
Expected: FAIL — `res.attachments` is undefined.

- [ ] **Step 3: Extend `SearchHit["kind"]` and the return type**

In `apps/web/lib/search/queries.ts`, change the kind union (line ~6):
```ts
  kind: "card" | "event" | "comment" | "project" | "attachment";
```
Change the `searchAll` return type (line ~26) to include attachments:
```ts
): Promise<{ projects: SearchHit[]; cards: SearchHit[]; events: SearchHit[]; comments: SearchHit[]; attachments: SearchHit[] }> {
```
And the early-return for short queries (line ~28):
```ts
  if (trimmed.length < 2) {
    return { projects: [], cards: [], events: [], comments: [], attachments: [] };
  }
```

- [ ] **Step 4: Add the attachments query before `return`**

Insert just before the final `return { projects, cards, events: eventHits, comments };`:
```ts
  // Attachments: AI caption ilike. Joined event→card→project; RLS-scoped so
  // cost-sensitive captions never reach non-cost roles.
  const { data: attachmentRows } = await supabase
    .from("card_attachments")
    .select(
      `id, ai_caption, mime_type, card_events:card_event_id ( cards:card_id ( slug, title, projects:project_id ( project_code ) ) )`,
    )
    .ilike("ai_caption", pattern)
    .limit(PER_GROUP);

  const attachments: SearchHit[] = [];
  for (const a of attachmentRows ?? []) {
    const row = a as {
      id: string; ai_caption: string | null;
      card_events: { cards: CardJoin | null } | null;
    };
    const c = row.card_events?.cards;
    const code = c?.projects?.project_code;
    if (!c || !code || !row.ai_caption) continue;
    attachments.push({
      id: `a_${row.id}`,
      kind: "attachment",
      projectCode: code,
      cardSlug: c.slug,
      cardTitle: c.title,
      snippet: highlight(row.ai_caption, trimmed),
      href: `/project/${code}/cards/${c.slug}`,
      occurredAt: "",
    });
  }
```
Then update the final return:
```ts
  return { projects, cards, events: eventHits, comments, attachments };
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run tests/unit/search-queries.test.ts`
Expected: PASS.

- [ ] **Step 6: Update the search page UI**

In `apps/web/app/(app)/search/page.tsx`:
- Add to `KIND_LABEL`: `attachment: "Lampiran",`
- Add to `KIND_COLOR`: `attachment: "var(--sand-dark)",` (reuse an existing token; match the object's value style)
- Update the short-query default (line ~27):
  `{ projects: [], cards: [], events: [], comments: [], attachments: [] }`
- Wherever the page renders the result groups, add `results.attachments` to the rendered set (follow the existing pattern that maps over `results.cards` / `results.events`).

- [ ] **Step 7: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/search/queries.ts "apps/web/app/(app)/search/page.tsx" apps/web/tests/unit/search-queries.test.ts
git commit -m "feat(web): search attachments by AI caption"
```

---

## Task 6: Tanya retrieval — captions in context (TDD)

**Files:**
- Modify: `apps/web/lib/assistant/retrieval.ts`
- Test: `apps/web/tests/unit/assistant-retrieval.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/tests/unit/assistant-retrieval.test.ts`:
```ts
describe("buildContextBlock with attachment captions", () => {
  it("renders Lampiran lines for an event's captions", () => {
    const withCaptions: CardWithEvents[] = [
      {
        card: {
          id: "c1", project_id: "p1", topic_id: "t1", title: "Master bath",
          slug: "master-bath", status: "active", current_summary: null,
          properties: {}, created_by_staff_id: "s1",
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
          last_event_at: "2026-01-01T00:00:00Z",
        },
        topicName: "A09",
        events: [
          { id: "e1", card_id: "c1", project_id: "p1", event_kind: "photo",
            payload: { caption: "sample" }, occurred_at: "2026-01-01T00:00:00Z",
            logged_by_staff_id: "s1", source_kind: "manual", source_id: null,
            cost_visible: false, draft_id: null, created_at: "2026-01-01T00:00:00Z",
            search_text: null },
        ],
        captionsByEventId: { e1: ["Marmer Statuario finish polish"] },
      },
    ];
    const ctx = buildContextBlock(withCaptions);
    expect(ctx).toContain("Lampiran:");
    expect(ctx).toContain("Marmer Statuario");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run tests/unit/assistant-retrieval.test.ts`
Expected: FAIL — `captionsByEventId` not on `CardWithEvents`, and no `Lampiran:` output.

- [ ] **Step 3: Extend the type + buildContextBlock**

In `apps/web/lib/assistant/retrieval.ts`, extend the type (line ~5):
```ts
export type CardWithEvents = {
  card: Card;
  topicName: string;
  events: CardEvent[];
  /** AI captions for an event's attachments, keyed by event id. */
  captionsByEventId?: Record<string, string[]>;
};
```
In `buildContextBlock`, inside the events loop, after the event line is pushed (line ~147), add:
```ts
        const caps = captionsByEventId?.[e.id];
        if (caps && caps.length > 0) {
          for (const cap of caps) lines.push(`    Lampiran: ${cap}`);
        }
```
and destructure `captionsByEventId` from the card object at the top of the loop:
```ts
  for (const { card, topicName, events, captionsByEventId } of cards) {
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run tests/unit/assistant-retrieval.test.ts`
Expected: PASS.

- [ ] **Step 5: Load captions in `retrieveProjectContext`**

After the events are loaded and grouped (after the `evByCard` block, ~line 117), add a fetch that fills `captionsByEventId` per card:
```ts
  // Attachment captions for the loaded events (RLS-scoped; cost gating inherited).
  const eventIds = (events ?? []).map((e) => e.id);
  const capByEvent = new Map<string, string[]>();
  if (eventIds.length > 0) {
    const { data: caps } = await supabase
      .from("card_attachments")
      .select("card_event_id, ai_caption")
      .in("card_event_id", eventIds)
      .not("ai_caption", "is", null);
    for (const row of caps ?? []) {
      const r = row as { card_event_id: string; ai_caption: string | null };
      if (!r.ai_caption) continue;
      const arr = capByEvent.get(r.card_event_id) ?? [];
      arr.push(r.ai_caption);
      capByEvent.set(r.card_event_id, arr);
    }
  }
```
Then in the `result` map (~line 119), attach the captions:
```ts
  const result = cards.map((c) => {
    const { topics, ...cardRow } = c;
    const evs = evByCard.get(c.id) ?? [];
    const captionsByEventId: Record<string, string[]> = {};
    for (const e of evs) {
      const caps = capByEvent.get(e.id);
      if (caps && caps.length > 0) captionsByEventId[e.id] = caps;
    }
    return {
      card: cardRow as Card,
      topicName: topics?.name ?? "",
      events: evs,
      captionsByEventId,
    };
  });
```

- [ ] **Step 6: Typecheck + full unit suite**

Run: `cd apps/web && pnpm typecheck && pnpm exec vitest run`
Expected: PASS (whole suite green).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/assistant/retrieval.ts apps/web/tests/unit/assistant-retrieval.test.ts
git commit -m "feat(web): include attachment captions in Tanya context"
```

---

## Task 7: `reanalyzeAttachment` server action

**Files:**
- Modify: `apps/web/lib/cards/mutations.ts` (after `signAttachment`, ~line 582)

- [ ] **Step 1: Add the action**

```ts
// ─── reanalyzeAttachment ──────────────────────────────────────────────────────
// Reset a failed/skipped attachment back to the work queue. The cron runner
// picks it up on the next tick. ai_attempts resets so the 3-try guard restarts.

const ReanalyzeInput = z.object({
  attachmentId: z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug: z.string().min(1),
});

export type ReanalyzeResult = { ok: true } | { ok: false; error: string };

export async function reanalyzeAttachment(formData: FormData): Promise<ReanalyzeResult> {
  let input;
  try {
    input = ReanalyzeInput.parse({
      attachmentId: formData.get("attachmentId"),
      projectCode: formData.get("projectCode"),
      cardSlug: formData.get("cardSlug"),
    });
  } catch {
    return { ok: false, error: "Permintaan tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  const { error } = await supabase
    .from("card_attachments")
    .update({ ai_status: "pending", ai_attempts: 0, ai_error: null })
    .eq("id", input.attachmentId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}
```

> RLS: the `update` is gated by the existing `card_attachments` write policy (parent event in an accessible project), so a user can only re-queue attachments they may write.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/cards/mutations.ts
git commit -m "feat(web): reanalyzeAttachment action to re-queue an attachment"
```

---

## Task 8: EventAttachments UI states

**Files:**
- Modify: `apps/web/components/board/EventAttachments.tsx`

> No render-test harness exists in this repo (tests are pure-logic). Verify via the dev server / preview after the migration is applied.

- [ ] **Step 1: Add status badge + re-analyze**

`CardAttachment` now carries `ai_status`, `ai_caption`, `ai_error`. Below each resolved attachment tile, render its AI state:
- `ai_status` is `pending` or `processing` → a muted pill `Menganalisis…`.
- `ai_status` is `done` and `ai_caption` set → show the caption as small muted text under the tile (e.g. `<p className="mt-0.5 max-w-[12rem] text-[10px] text-[var(--text-muted)]">{a.ai_caption}</p>`).
- `ai_status` is `failed` or `skipped` → a small button `Analisis ulang` that builds a `FormData` (`attachmentId`, `projectCode`, `cardSlug`) and calls `reanalyzeAttachment` (import from `@/lib/cards/mutations`). The component needs `projectCode` and `cardSlug` props — thread them from the caller (the event timeline already knows them; add the two props and pass them down).

Keep the existing image/document rendering unchanged; the status UI is additive markup in each tile's wrapper.

- [ ] **Step 2: Typecheck + lint**

Run: `cd apps/web && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/board/EventAttachments.tsx <caller files threading the new props>
git commit -m "feat(web): show analyzing/caption/re-analyze on attachments"
```

---

## Task 9: Cron registration + operational handoff

**Files:**
- Modify: `apps/web/vercel.json`

- [ ] **Step 1: Register the cron**

```json
{
  "regions": ["sin1"],
  "crons": [
    { "path": "/api/cron/analyze-attachments", "schedule": "* * * * *" }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/vercel.json
git commit -m "chore(web): schedule attachment-analysis cron"
```

- [ ] **Step 3: User-action checklist (NOT auto-run — these touch production)**

1. **Apply the migration to live Supabase:** `supabase db push` (review diff first).
2. **Re-generate types properly** (optional, supersedes the hand-edit): `supabase gen types typescript ...` → `packages/db/src/types.generated.ts`, confirm no diff vs Task 2.
3. **Set `CRON_SECRET`** in Vercel project env (Production + Preview). Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>` automatically.
4. **Confirm `ANTHROPIC_API_KEY`** is set (already in use). Optional `ANTHROPIC_VISION_MODEL` for Phase 2.
5. **Deploy.** Then attach a test image to a card and confirm within ~1 min the caption appears and the row goes `pending → done`.

---

## Self-Review

**Spec coverage (Phase 1 rows):**
- Description on upload (async, Pipeline B) → Tasks 1,3,4 ✓
- `ai_caption` populated → Task 4 ✓
- Searchable captions → Task 5 ✓
- Captions in Tanya context + (note) keyword merge → Task 6 ✓ *(keyword-merge surfacing of caption-only matches is deferred to Phase 2 — Task 6 puts captions into context for already-retrieved cards; flagged here as a known Phase-1 limitation, not silently dropped.)*
- Status columns / state machine → Tasks 1,2,4 ✓
- Realtime live update → Task 1 (publication) + Task 8 (UI) ✓
- Re-analyze on failure → Tasks 7,8 ✓
- Cost-visibility via RLS → Tasks 5,6 read through the RLS client ✓
- Skip/oversize/failed/retry handling → Tasks 1,3,4 ✓
- Cron + env handoff → Task 9 ✓

**Deviations (intentional, flagged):** PDF page-cap deferred (size-cap only); caption-only keyword merge in retrieval deferred to Phase 2. Both noted inline above.

**Placeholder scan:** none — every code step shows real code; the one `<caller files …>` in Task 8 Step 3 is a git-add path the engineer fills from Step 1's prop threading, not a code placeholder.

**Type consistency:** `attachmentKind`, `attachmentSkipReason`, `buildDescribeMessages`, `describeAttachment`, `isCronAuthorized`, `reanalyzeAttachment`, `captionsByEventId`, `SearchHit["kind"]` incl. `"attachment"`, and the `claim_attachments_for_analysis` RPC signature are used consistently across tasks and match the generated-types edits in Task 2.
