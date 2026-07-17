# Mobile Share-to-Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DATUM's Expo Android app registers as a share target so site photos shared from WhatsApp/Gallery land on an existing or new project card, plus EAS build config so Wilson can install a test APK.

**Architecture:** `expo-share-intent@7` (Expo SDK 56 match) registers Android `ACTION_SEND`/`ACTION_SEND_MULTIPLE` intent filters and exposes shared files via a provider + hook. A new `/share` screen (outside the tab navigator) mirrors Trello's "Add to card": project picker → topic picker → tap an existing card or create a new one, optional note. Submission reuses the proven pipeline: `createCardEvent` (kind `photo`, note as `caption`) → `uploadCardAttachment()` per image → AI-caption cron picks uploads up automatically. Last-used project/topic persist in AsyncStorage.

**Tech Stack:** Expo SDK 56 / RN 0.85 / expo-router 56, expo-share-intent 7.0.0, TanStack Query, jest-expo + @testing-library/react-native, Supabase (anon client, RLS), pnpm workspace.

## Global Constraints

- Expo SDK 56 — `expo-share-intent` MUST be pinned `7.0.0` (v8 requires Expo 57).
- All user-facing copy in Bahasa Indonesia (match existing screens: "Proyek", "Topik", "Kartu baru", "Catatan", "Simpan", "Batal").
- Workdir: repo worktree `.claude/worktrees/mobile-share-to-card`; all app code under `apps/mobile`.
- Path alias `@/` = `apps/mobile/`. Run tests from `apps/mobile` with `pnpm test -- <pattern>`.
- TDD: every task writes the failing test first. Never mark done with failing tests.
- Reuse `@datum/core` for all data access — no raw Supabase queries in components.
- Do not modify `apps/web` or `packages/*` in this plan.
- `apps/mobile/AGENTS.md` rule: consult https://docs.expo.dev/versions/v56.0.0/ (and the expo-share-intent v7 README) before writing native-adjacent config.
- Touch targets ≥ 44px (`min-h-[44px]`), NativeWind classes, warm sand palette tokens already in `tailwind.config.js`.

---

### Task 1: Last-used share target prefs (AsyncStorage)

**Files:**
- Create: `apps/mobile/lib/share/prefs.ts`
- Test: `apps/mobile/lib/share/prefs.test.ts`

**Interfaces:**
- Consumes: `@react-native-async-storage/async-storage` (already a dependency; jest-expo auto-mocks via `@react-native-async-storage/async-storage/jest/async-storage-mock` — add to test with `jest.mock`).
- Produces:
  - `type LastShareTarget = { projectId: string; projectCode: string; topicId: string }`
  - `getLastShareTarget(): Promise<LastShareTarget | null>`
  - `setLastShareTarget(t: LastShareTarget): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/lib/share/prefs.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLastShareTarget, setLastShareTarget } from "./prefs";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

describe("share prefs", () => {
  beforeEach(() => AsyncStorage.clear());

  it("returns null when nothing stored", async () => {
    expect(await getLastShareTarget()).toBeNull();
  });

  it("round-trips a target", async () => {
    const t = { projectId: "p1", projectCode: "PAKUWON", topicId: "t1" };
    await setLastShareTarget(t);
    expect(await getLastShareTarget()).toEqual(t);
  });

  it("returns null on corrupt JSON", async () => {
    await AsyncStorage.setItem("share.lastTarget", "{not json");
    expect(await getLastShareTarget()).toBeNull();
  });

  it("returns null on wrong shape", async () => {
    await AsyncStorage.setItem("share.lastTarget", JSON.stringify({ projectId: 1 }));
    expect(await getLastShareTarget()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/mobile`): `pnpm test -- lib/share/prefs`
Expected: FAIL — cannot find module `./prefs`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/mobile/lib/share/prefs.ts
/**
 * prefs.ts — last-used share target (project + topic), Trello-style default
 * for the share-sheet "Add to card" screen. Best-effort: storage errors and
 * corrupt values degrade to null, never throw.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "share.lastTarget";

export type LastShareTarget = {
  projectId: string;
  projectCode: string;
  topicId: string;
};

export async function getLastShareTarget(): Promise<LastShareTarget | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LastShareTarget> | null;
    if (
      p &&
      typeof p.projectId === "string" &&
      typeof p.projectCode === "string" &&
      typeof p.topicId === "string"
    ) {
      return { projectId: p.projectId, projectCode: p.projectCode, topicId: p.topicId };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setLastShareTarget(t: LastShareTarget): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // best-effort
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- lib/share/prefs` → Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/share/prefs.ts apps/mobile/lib/share/prefs.test.ts
git commit -m "feat(mobile): last-used share target prefs"
```

---

### Task 2: Share orchestration — images → card event → uploads

**Files:**
- Create: `apps/mobile/lib/share/add-to-card.ts`
- Test: `apps/mobile/lib/share/add-to-card.test.ts`

**Interfaces:**
- Consumes: `createCard`, `createCardEvent` from `@datum/core`; `uploadCardAttachment`, `PickedAsset` from `@/lib/attachments/pick-and-upload`.
- Produces (used by Task 4's screen):

```ts
export type ShareUploadOutcome = {
  eventId: string;
  uploaded: number;                              // count of successful uploads
  skipped: { name: string; reason: string }[];   // oversize/unsupported (soft)
  failed: { name: string; error: string }[];     // upload/DB errors
};

export type ShareToCardResult =
  | { ok: true; cardId: string; cardSlug: string; outcome: ShareUploadOutcome }
  | { ok: false; error: string };

shareToExistingCard(supabase, {
  projectId, cardId, cardSlug, note, assets, loggedByStaffId,
}): Promise<ShareToCardResult>

shareToNewCard(supabase, {
  projectId, topicId, title, note, assets, loggedByStaffId,
}): Promise<ShareToCardResult>
```

- [ ] **Step 1: Write the failing test** — mock `@datum/core` and the upload module; mirror the mocking style of `lib/attachments/pick-and-upload.test.ts`:

```ts
// apps/mobile/lib/share/add-to-card.test.ts
import { shareToExistingCard, shareToNewCard } from "./add-to-card";

jest.mock("@datum/core", () => ({
  createCard: jest.fn(),
  createCardEvent: jest.fn(),
}));
jest.mock("@/lib/attachments/pick-and-upload", () => ({
  uploadCardAttachment: jest.fn(),
}));

import { createCard, createCardEvent } from "@datum/core";
import { uploadCardAttachment } from "@/lib/attachments/pick-and-upload";

const supabase = {} as never;
const asset = (name: string) => ({
  uri: `file:///${name}`, name, mimeType: "image/jpeg", size: 1000,
});
const base = {
  projectId: "p1", cardId: "c1", cardSlug: "kartu-1",
  loggedByStaffId: "s1", note: "cek pemasangan",
};

beforeEach(() => {
  jest.resetAllMocks();
  (createCardEvent as jest.Mock).mockResolvedValue({ ok: true, eventId: "e1" });
  (uploadCardAttachment as jest.Mock).mockResolvedValue({ ok: true });
});

describe("shareToExistingCard", () => {
  it("creates one photo event with the note as caption, uploads every asset", async () => {
    const res = await shareToExistingCard(supabase, {
      ...base, assets: [asset("a.jpg"), asset("b.jpg")],
    });
    expect(createCardEvent).toHaveBeenCalledWith(supabase, expect.objectContaining({
      cardId: "c1", projectId: "p1", eventKind: "photo",
      payload: { caption: "cek pemasangan" }, loggedByStaffId: "s1",
    }));
    expect(uploadCardAttachment).toHaveBeenCalledTimes(2);
    expect(res).toEqual({
      ok: true, cardId: "c1", cardSlug: "kartu-1",
      outcome: { eventId: "e1", uploaded: 2, skipped: [], failed: [] },
    });
  });

  it("sends empty payload when note is blank", async () => {
    await shareToExistingCard(supabase, { ...base, note: "  ", assets: [asset("a.jpg")] });
    expect(createCardEvent).toHaveBeenCalledWith(
      supabase, expect.objectContaining({ payload: {} }),
    );
  });

  it("fails fast when the event cannot be created", async () => {
    (createCardEvent as jest.Mock).mockResolvedValue({ ok: false, error: "RLS" });
    const res = await shareToExistingCard(supabase, { ...base, assets: [asset("a.jpg")] });
    expect(res).toEqual({ ok: false, error: "RLS" });
    expect(uploadCardAttachment).not.toHaveBeenCalled();
  });

  it("partitions per-asset skip and failure without aborting the batch", async () => {
    (uploadCardAttachment as jest.Mock)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, skipped: true, reason: "terlalu besar" })
      .mockResolvedValueOnce({ ok: false, error: "network" });
    const res = await shareToExistingCard(supabase, {
      ...base, assets: [asset("a.jpg"), asset("b.jpg"), asset("c.jpg")],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.outcome.uploaded).toBe(1);
      expect(res.outcome.skipped).toEqual([{ name: "b.jpg", reason: "terlalu besar" }]);
      expect(res.outcome.failed).toEqual([{ name: "c.jpg", error: "network" }]);
    }
  });
});

describe("shareToNewCard", () => {
  it("creates the card then delegates to the existing-card path", async () => {
    (createCard as jest.Mock).mockResolvedValue({ ok: true, id: "c9", slug: "kartu-baru" });
    const res = await shareToNewCard(supabase, {
      projectId: "p1", topicId: "t1", title: "Kartu baru",
      note: "", assets: [asset("a.jpg")], loggedByStaffId: "s1",
    });
    expect(createCard).toHaveBeenCalledWith(supabase, {
      projectId: "p1", topicId: "t1", title: "Kartu baru",
    });
    expect(res).toMatchObject({ ok: true, cardId: "c9", cardSlug: "kartu-baru" });
  });

  it("propagates card-creation failure", async () => {
    (createCard as jest.Mock).mockResolvedValue({ ok: false, error: "judul kosong" });
    const res = await shareToNewCard(supabase, {
      projectId: "p1", topicId: "t1", title: "",
      assets: [asset("a.jpg")], loggedByStaffId: "s1",
    });
    expect(res).toEqual({ ok: false, error: "judul kosong" });
    expect(createCardEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- lib/share/add-to-card` → Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/mobile/lib/share/add-to-card.ts
/**
 * add-to-card.ts — share-sheet orchestration.
 *
 * One photo event carries the whole shared batch (note → payload.caption),
 * then each image uploads via the existing uploadCardAttachment pipeline
 * (validation → Storage → card_attachments row → AI-caption cron).
 * Uploads run sequentially: site photos are large and RN blob memory is finite.
 * Best-effort per asset — one bad image never aborts the batch (matches
 * AddEventForm's never-block-the-event design).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { createCard, createCardEvent } from "@datum/core";
import {
  uploadCardAttachment,
  type PickedAsset,
} from "@/lib/attachments/pick-and-upload";

export type ShareUploadOutcome = {
  eventId: string;
  uploaded: number;
  skipped: { name: string; reason: string }[];
  failed: { name: string; error: string }[];
};

export type ShareToCardResult =
  | { ok: true; cardId: string; cardSlug: string; outcome: ShareUploadOutcome }
  | { ok: false; error: string };

type Client = SupabaseClient<Database>;

export async function shareToExistingCard(
  supabase: Client,
  args: {
    projectId: string;
    cardId: string;
    cardSlug: string;
    note?: string;
    assets: PickedAsset[];
    loggedByStaffId: string;
  },
): Promise<ShareToCardResult> {
  const caption = args.note?.trim();
  const ev = await createCardEvent(supabase, {
    cardId: args.cardId,
    projectId: args.projectId,
    eventKind: "photo",
    payload: caption ? { caption } : {},
    loggedByStaffId: args.loggedByStaffId,
  });
  if (!ev.ok) return { ok: false, error: ev.error };

  const outcome: ShareUploadOutcome = {
    eventId: ev.eventId, uploaded: 0, skipped: [], failed: [],
  };
  for (const asset of args.assets) {
    const res = await uploadCardAttachment(supabase, {
      projectId: args.projectId,
      cardId: args.cardId,
      cardEventId: ev.eventId,
      asset,
    });
    if (res.ok) outcome.uploaded += 1;
    else if ("skipped" in res && res.skipped)
      outcome.skipped.push({ name: asset.name, reason: res.reason });
    else outcome.failed.push({ name: asset.name, error: res.error });
  }
  return { ok: true, cardId: args.cardId, cardSlug: args.cardSlug, outcome };
}

export async function shareToNewCard(
  supabase: Client,
  args: {
    projectId: string;
    topicId: string;
    title: string;
    note?: string;
    assets: PickedAsset[];
    loggedByStaffId: string;
  },
): Promise<ShareToCardResult> {
  const card = await createCard(supabase, {
    projectId: args.projectId,
    topicId: args.topicId,
    title: args.title,
  });
  if (!card.ok) return { ok: false, error: card.error };
  return shareToExistingCard(supabase, {
    projectId: args.projectId,
    cardId: card.id,
    cardSlug: card.slug,
    note: args.note,
    assets: args.assets,
    loggedByStaffId: args.loggedByStaffId,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- lib/share/add-to-card` → Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/share/add-to-card.ts apps/mobile/lib/share/add-to-card.test.ts
git commit -m "feat(mobile): share-to-card orchestration (photo event + batch upload)"
```

---

### Task 3: Install expo-share-intent + app config + intent redirect

**Files:**
- Modify: `apps/mobile/package.json` (add `"expo-share-intent": "7.0.0"`; run `pnpm install` from repo root)
- Modify: `apps/mobile/app.json` (plugin config)
- Create: `apps/mobile/lib/share/intent.ts` (pure redirect decision + file mapping — testable without native module)
- Test: `apps/mobile/lib/share/intent.test.ts`
- Modify: `apps/mobile/app/_layout.tsx` (ShareIntentProvider + redirect component + `share` stack screen)

**Interfaces:**
- Consumes: `expo-share-intent` v7 — `ShareIntentProvider`, `useShareIntentContext()` → `{ hasShareIntent, shareIntent, resetShareIntent, error }`; `shareIntent.files: { path, fileName, mimeType, size? , fileSize? }[]` (READ the v7 README to confirm field names before coding — AGENTS.md rule).
- Produces:
  - `shouldRedirectToShare(input: { hasShareIntent: boolean; status: "loading"|"authenticated"|"unauthenticated"; firstSegment: string | undefined }): boolean`
  - `sharedFilesToAssets(files: ShareIntentFile[] | null): PickedAsset[]` (image/* only, name/size fallbacks)
  - Root layout renders `<Stack.Screen name="share" />` and redirects when `shouldRedirectToShare` is true.

- [ ] **Step 1: Install the dependency**

```bash
cd apps/mobile && pnpm add expo-share-intent@7.0.0
cd ../.. && pnpm install
```

- [ ] **Step 2: Configure the plugin in app.json** — read the expo-share-intent v7 README (`node_modules/expo-share-intent/README.md`) first; expected shape:

```json
"plugins": [
  "expo-router",
  "expo-secure-store",
  [
    "expo-share-intent",
    {
      "androidIntentFilters": ["images"],
      "androidMultiIntentFilters": ["images"]
    }
  ]
]
```

Verify config renders: `npx expo config --type prebuild | grep -A6 SEND` → Expected: `android.intentFilters` containing `ACTION_SEND` + `ACTION_SEND_MULTIPLE` for `image/*`.

- [ ] **Step 3: Write the failing test for the pure helpers**

```ts
// apps/mobile/lib/share/intent.test.ts
import { shouldRedirectToShare, sharedFilesToAssets } from "./intent";

describe("shouldRedirectToShare", () => {
  const base = { hasShareIntent: true, status: "authenticated" as const, firstSegment: "(tabs)" as string | undefined };
  it("redirects an authenticated user with a pending intent", () => {
    expect(shouldRedirectToShare(base)).toBe(true);
  });
  it("holds while session is loading (intent survives; resume-after-login)", () => {
    expect(shouldRedirectToShare({ ...base, status: "loading" })).toBe(false);
    expect(shouldRedirectToShare({ ...base, status: "unauthenticated" })).toBe(false);
  });
  it("does not loop when already on /share", () => {
    expect(shouldRedirectToShare({ ...base, firstSegment: "share" })).toBe(false);
  });
  it("does nothing without an intent", () => {
    expect(shouldRedirectToShare({ ...base, hasShareIntent: false })).toBe(false);
  });
});

describe("sharedFilesToAssets", () => {
  it("maps intent files to PickedAsset with fallbacks", () => {
    const out = sharedFilesToAssets([
      { path: "file:///a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 123 },
      { path: "file:///b", fileName: null, mimeType: "image/png", size: null },
    ] as never);
    expect(out).toEqual([
      { uri: "file:///a.jpg", name: "a.jpg", mimeType: "image/jpeg", size: 123 },
      { uri: "file:///b", name: expect.stringMatching(/^foto-/), mimeType: "image/png", size: 0 },
    ]);
  });
  it("filters non-images and handles null", () => {
    expect(sharedFilesToAssets(null)).toEqual([]);
    expect(
      sharedFilesToAssets([{ path: "file:///x.pdf", fileName: "x.pdf", mimeType: "application/pdf", size: 5 }] as never),
    ).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test -- lib/share/intent` → Expected: FAIL — module not found.

- [ ] **Step 5: Implement the helpers**

```ts
// apps/mobile/lib/share/intent.ts
/**
 * intent.ts — pure decision + mapping helpers for the share intent flow.
 * Kept free of the native expo-share-intent module so Jest covers them
 * without native mocks. The provider holds the intent while the user logs
 * in; redirect only fires once authenticated (resume-after-login).
 */
import type { PickedAsset } from "@/lib/attachments/pick-and-upload";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export function shouldRedirectToShare(input: {
  hasShareIntent: boolean;
  status: SessionStatus;
  firstSegment: string | undefined;
}): boolean {
  return (
    input.hasShareIntent &&
    input.status === "authenticated" &&
    input.firstSegment !== "share"
  );
}

/** Minimal structural type for expo-share-intent files (v7). */
export type ShareIntentFileLike = {
  path: string;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
};

export function sharedFilesToAssets(
  files: ShareIntentFileLike[] | null | undefined,
): PickedAsset[] {
  if (!files) return [];
  return files
    .filter((f) => (f.mimeType ?? "").startsWith("image/"))
    .map((f) => ({
      uri: f.path,
      name: f.fileName ?? `foto-${Date.now()}.jpg`,
      mimeType: f.mimeType ?? "image/jpeg",
      size: f.size ?? 0,
    }));
}
```

NOTE for implementer: if the v7 README shows a different file field name (`fileSize` vs `size`), extend `ShareIntentFileLike` to read both: `size: f.size ?? f.fileSize ?? 0`. Confirm against `node_modules/expo-share-intent/build/ExpoShareIntentModule.types.d.ts`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test -- lib/share/intent` → Expected: PASS.

- [ ] **Step 7: Wire the provider + redirect into the root layout**

```tsx
// apps/mobile/app/_layout.tsx  (additions — keep existing Gate logic intact)
import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { SessionProvider, useSession } from "@/lib/session/session";
import { QueryProvider } from "@/lib/query/provider";
import { shouldRedirectToShare } from "@/lib/share/intent";

function ShareIntentRedirect() {
  const { hasShareIntent } = useShareIntentContext();
  const { status } = useSession();
  const router = useRouter();
  const segments = useSegments();
  useEffect(() => {
    if (shouldRedirectToShare({ hasShareIntent, status, firstSegment: segments[0] })) {
      router.replace("/share");
    }
  }, [hasShareIntent, status, segments, router]);
  return null;
}

// In RootLayout: wrap everything in <ShareIntentProvider>, render
// <ShareIntentRedirect /> next to <Gate>, and add the share screen. The Gate's
// "authenticated && inAuth → tabs" replace still runs first; ShareIntentRedirect
// then replaces to /share because the provider keeps hasShareIntent true.
export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <SessionProvider>
        <ShareIntentRedirect />
        <Gate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="share" options={{ presentation: "modal" }} />
          </Stack>
        </Gate>
      </SessionProvider>
    </ShareIntentProvider>
  );
}
```

Also add a Jest module mock so existing suites that render the root layout don't hit the native module. Check `jest.config.js` `moduleNameMapper`/`setupFiles`; add to the shared setup file:

```ts
jest.mock("expo-share-intent", () => ({
  ShareIntentProvider: ({ children }: { children: React.ReactNode }) => children,
  useShareIntentContext: () => ({
    hasShareIntent: false, shareIntent: null, resetShareIntent: jest.fn(), error: null,
  }),
}));
```

- [ ] **Step 8: Full suite green + typecheck**

Run: `pnpm test` → Expected: all suites pass. Run: `npx tsc --noEmit` → Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.json apps/mobile/app/_layout.tsx \
        apps/mobile/lib/share/intent.ts apps/mobile/lib/share/intent.test.ts \
        pnpm-lock.yaml apps/mobile/jest.config.js apps/mobile/tests
git commit -m "feat(mobile): register Android share target + intent redirect"
```

---

### Task 4: /share screen — Trello-style "Add to card"

**Files:**
- Create: `apps/mobile/app/share.tsx`
- Test: `apps/mobile/app/share.test.tsx`

**Interfaces:**
- Consumes:
  - `useShareIntentContext()` (mocked in tests) — `shareIntent.files`, `resetShareIntent`.
  - `sharedFilesToAssets`, from Task 3; `shareToExistingCard`, `shareToNewCard` from Task 2; `getLastShareTarget`, `setLastShareTarget` from Task 1.
  - `useProjects()` (list: `{ id, project_code, project_name, status }[]`), `useBoard(code)` (→ `Board = { project, columns: { topic: { id, code, name }, cards: { id, slug, title }[] }[] }`) from `@/lib/query/hooks`.
  - `useSession()` → `{ staff }` (staff.id = loggedByStaffId); `supabase` from `@/lib/supabase/client`.
- Produces: screen at route `/share`. Behavior contract (what the tests pin):
  1. Renders thumbnails (expo-image) for each shared asset + count label ("2 foto").
  2. Project picker defaults to last-used (AsyncStorage) else first project; topic picker defaults to last-used topic when it exists in the selected project, else first topic.
  3. Card list for the selected topic; tapping a card submits to it.
  4. "Kartu baru" text input + submit creates the card then attaches.
  5. Optional "Catatan (opsional)" input feeds the event caption.
  6. On success: `setLastShareTarget` persisted, `resetShareIntent()` called, router replaces to `/(tabs)/(matrix)/project/[code]/card/[slug]`, partial skip/fail outcomes shown first as a summary line.
  7. Empty states: no projects → "Tidak ada proyek"; upload in progress disables inputs and shows spinner; `ok:false` shows the error and keeps state for retry.
- Follow the structure/test style of `app/(tabs)/(matrix)/new.tsx` + `new.test.tsx` (query-client wrapper + seeded cache). Keep the whole screen in one file unless it exceeds ~300 lines; if splitting, put pieces in `apps/mobile/components/share/`.

- [ ] **Step 1: Write the failing screen test** — seed the query cache with two projects and a board (two topics, two cards each), mock `expo-share-intent` context to return two image files, mock Tasks 1–2 modules, assert the seven behaviors above. Use `fireEvent.press` on a card row → expect `shareToExistingCard` called with that card id and the mapped assets; use the "Kartu baru" path → expect `shareToNewCard`. Assert `router.replace` via `jest.mock("expo-router")` in the style of the existing screen tests.
- [ ] **Step 2: Run test to verify it fails** — `pnpm test -- app/share` → FAIL (no route module).
- [ ] **Step 3: Implement the screen.** Layout skeleton (NativeWind, BI copy, 44px targets):

```tsx
// apps/mobile/app/share.tsx — structure
<SafeAreaView className="flex-1 bg-surface">
  {/* Header: × batal (left, resetShareIntent + router.back) · "Tambah ke kartu" · ✓ disabled unless target chosen */}
  {/* Thumbnails row: horizontal ScrollView of <Image> 72x72 rounded + "N foto" */}
  {/* Proyek picker: Pressable rows in a collapsible section (same pattern as new.tsx pickers) */}
  {/* Topik picker: from useBoard(selectedCode).columns[].topic */}
  {/* Catatan (opsional): TextInput multiline */}
  {/* Kartu baru: TextInput + "Buat & lampirkan" button */}
  {/* Existing cards: FlatList of column.cards rows (title), tap = attach */}
  {/* Busy overlay: ActivityIndicator + "Mengunggah…" ; outcome summary + error banner */}
</SafeAreaView>
```

Submission handler (both paths): guard `staff`, `assets.length > 0`; `setSubmitting(true)`; call Task-2 fn; on `ok`: `await setLastShareTarget(...)`, build summary if `skipped.length || failed.length`, `resetShareIntent()`, `router.replace({ pathname: "/(tabs)/(matrix)/project/[slug]/card/[cardSlug]", params: { slug: code, cardSlug } })`; on `!ok`: show error, keep state.
- [ ] **Step 4: Run test to verify it passes** — `pnpm test -- app/share` → PASS.
- [ ] **Step 5: Full suite + typecheck** — `pnpm test && npx tsc --noEmit` → PASS/clean.
- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/share.tsx apps/mobile/app/share.test.tsx
git commit -m "feat(mobile): Trello-style share-to-card screen"
```

---

### Task 5: EAS build configuration + ops docs

**Files:**
- Create: `apps/mobile/eas.json`
- Modify: `apps/mobile/app.json` (android versionCode, icon check)
- Create: `apps/mobile/BUILD_ANDROID.md` (Wilson's ops runbook)

**Interfaces:**
- Consumes: `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` consumed by `lib/env.ts` at build time.
- Produces: `eas build -p android --profile preview` yields an installable APK.

- [ ] **Step 1: Write eas.json**

```json
{
  "cli": { "version": ">= 13.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": {
        "EXPO_PUBLIC_SUPABASE_URL": "<from apps/web NEXT_PUBLIC_SUPABASE_URL>",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "<from apps/web NEXT_PUBLIC_SUPABASE_ANON_KEY>"
      }
    },
    "production": {
      "autoIncrement": true,
      "env": { "EXPO_PUBLIC_SUPABASE_URL": "…", "EXPO_PUBLIC_SUPABASE_ANON_KEY": "…" }
    }
  }
}
```

Fill the env values from `apps/web/.env.local` (or `.env`) — `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`. These are publishable client values (they ship in the web bundle today), safe to commit. If no local env file exists, leave placeholders and add a bold step to BUILD_ANDROID.md.

- [ ] **Step 2: app.json production details** — add `"android": { "package": "studio.wha.datum", "versionCode": 1 }`; confirm `assets/` has icon + adaptive-icon referenced by app.json (add `"icon"`/`"android.adaptiveIcon"` entries if assets exist; if not, note in BUILD_ANDROID.md that EAS uses a default icon until one is added).
- [ ] **Step 3: Write BUILD_ANDROID.md** — exact one-time ops:

```md
1. npm i -g eas-cli && eas login            # free account at expo.dev
2. cd apps/mobile && eas init               # writes extra.eas.projectId → commit it
3. eas build -p android --profile preview   # ~15 min; install link/QR emailed
Smoke test: install APK → login → share 2 photos from WhatsApp → DATUM →
pick project/topic → existing card → verify photos + caption on card, then
AI caption appears after the cron. Repeat with "Kartu baru".
Push notifications (separate, later): add Firebase project + google-services.json,
then eas credentials.
```

- [ ] **Step 4: Verify config** — `npx expo config --type prebuild` renders without error and shows intent filters; `npx expo-doctor` passes (or only pre-existing warnings).
- [ ] **Step 5: Commit**

```bash
git add apps/mobile/eas.json apps/mobile/app.json apps/mobile/BUILD_ANDROID.md
git commit -m "build(mobile): EAS Android profiles + ops runbook"
```

---

### Task 6: Native app UX audit (orchestrated — not a subagent coding task)

Run by the orchestrator (Fable 5) after Tasks 1–5: parallel Sonnet audit agents over six dimensions (touch/layout on 360–412px, photo journey end-to-end, navigation/deep links, offline/error/loading, keyboard behavior, list performance), each finding adversarially verified by an Opus agent before acceptance. Output `AUDIT_MOBILE_APP.md` (repo root, same format as `datum-brain-mobile-audit.md`: severity table, per-finding file:line + fix). Fix every verified Critical/High on this branch (each fix = test-first commit); Medium/Low logged only.

### Task 7: Final verification + PR

- [ ] Full mobile suite: `pnpm test` (from `apps/mobile`) → all pass.
- [ ] `npx tsc --noEmit` in `apps/mobile` → clean.
- [ ] Repo-wide sanity: `pnpm --filter web build` (lockfile changed at root; prove web untouched) → builds.
- [ ] `npx expo config --type prebuild` still renders share intent filters.
- [ ] Push branch, open PR to `main`: summary, audit results, BUILD_ANDROID.md ops steps for Wilson, on-device smoke script. Include screenshots n/a (no emulator here) — state that explicitly.
