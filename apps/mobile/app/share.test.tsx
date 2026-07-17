/**
 * Tests for the /share screen (share.tsx) — Trello-style "Add to card".
 *
 * Covers the 7 behaviors from the Task 4 brief:
 *  1. Thumbnails (expo-image) per shared asset + count label ("2 foto").
 *  2. Project + topic pickers default to last-used (AsyncStorage) else first.
 *  3. Card list for the selected topic; tapping a card submits to it with the
 *     mapped assets.
 *  4. "Kartu baru" input + create → shareToNewCard(topicId, title, assets).
 *  5. "Catatan (opsional)" feeds the event caption (note).
 *  6. On success: setLastShareTarget persisted, resetShareIntent() called,
 *     router.replace to the card route; partial skip/fail shows a summary first.
 *  7. Empty / busy / error states: no projects, submitting spinner, ok:false
 *     keeps state for retry.
 *
 * Hooks + Task 1/2 modules are mocked (matching the codebase idiom in
 * index.test.tsx); the real sharedFilesToAssets maps the mocked share files.
 */

import React from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mobile query hooks (wrap @datum/core) — control data directly.
const mockUseProjects = jest.fn();
const mockUseBoard = jest.fn();
jest.mock("@/lib/query/hooks", () => ({
  useProjects: () => mockUseProjects(),
  useBoard: (code: string) => mockUseBoard(code),
}));

// Session
const mockUseSession = jest.fn();
jest.mock("@/lib/session/session", () => ({
  useSession: () => mockUseSession(),
}));

// supabase + env (module-graph stubs)
jest.mock("@/lib/supabase/client", () => ({ supabase: { __tag: "supabase" } }));
jest.mock("@/lib/env", () => ({ SUPABASE_URL: "https://test.co", SUPABASE_ANON_KEY: "anon" }));

// expo-router
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
}));

// expo-image → plain View so no native image loading is needed
jest.mock("expo-image", () => ({
  Image: (_props: any) => {
    const { View } = require("react-native");
    return <View testID="thumb" />;
  },
}));

// safe-area
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// expo-share-intent — override the global (hasShareIntent:false) with two image files
const mockResetShareIntent = jest.fn();
const SHARE_FILES = [
  { path: "file:///a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 111 },
  { path: "file:///b.png", fileName: "b.png", mimeType: "image/png", size: 222 },
];
jest.mock("expo-share-intent", () => ({
  useShareIntentContext: () => ({
    hasShareIntent: true,
    shareIntent: { files: SHARE_FILES },
    resetShareIntent: mockResetShareIntent,
    error: null,
  }),
}));

// Task 1 — prefs
const mockGetLastShareTarget = jest.fn();
const mockSetLastShareTarget = jest.fn();
jest.mock("@/lib/share/prefs", () => ({
  getLastShareTarget: () => mockGetLastShareTarget(),
  setLastShareTarget: (t: unknown) => mockSetLastShareTarget(t),
}));

// Task 2 — add-to-card
const mockShareToExistingCard = jest.fn();
const mockShareToNewCard = jest.fn();
jest.mock("@/lib/share/add-to-card", () => ({
  shareToExistingCard: (...a: unknown[]) => mockShareToExistingCard(...a),
  shareToNewCard: (...a: unknown[]) => mockShareToNewCard(...a),
}));

// Task 3 — intent: keep REAL sharedFilesToAssets (pure mapping).

import ShareScreen from "./share";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const STAFF = { id: "staff-1", full_name: "Wilson", role: "principal" as const, email: "w@datum.id" };

const PROJECTS = [
  { id: "p1", project_code: "ARIN-1", project_name: "Karawang 1", status: "design", target_handover: null, development_id: null },
  { id: "p2", project_code: "BETA-1", project_name: "Bekasi", status: "construction", target_handover: null, development_id: null },
];

function boardFor(code: string) {
  if (code === "ARIN-1") {
    return {
      project: { id: "p1", project_code: "ARIN-1", project_name: "Karawang 1" },
      columns: [
        { topic: { id: "t1", code: "REN", name: "Rencana", sort_order: 1 }, cards: [
          { id: "c1", slug: "kartu-a", title: "Kartu A" },
          { id: "c2", slug: "kartu-b", title: "Kartu B" },
        ] },
        { topic: { id: "t2", code: "KON", name: "Konstruksi", sort_order: 2 }, cards: [
          { id: "c3", slug: "kartu-c", title: "Kartu C" },
          { id: "c4", slug: "kartu-d", title: "Kartu D" },
        ] },
      ],
    };
  }
  if (code === "BETA-1") {
    return {
      project: { id: "p2", project_code: "BETA-1", project_name: "Bekasi" },
      columns: [
        { topic: { id: "tb1", code: "REN", name: "Rencana B", sort_order: 1 }, cards: [
          { id: "cb1", slug: "beta-a", title: "Beta A" },
        ] },
        { topic: { id: "tb2", code: "KON", name: "Konstruksi B", sort_order: 2 }, cards: [
          { id: "cb2", slug: "beta-b", title: "Beta B" },
        ] },
      ],
    };
  }
  return null;
}

function boardResult(code: string) {
  const data = boardFor(code);
  return { isLoading: !data && !!code, isError: false, data, error: null, refetch: jest.fn() };
}

const OK_CLEAN = {
  ok: true, cardId: "c1", cardSlug: "kartu-a",
  outcome: { eventId: "ev1", uploaded: 2, skipped: [], failed: [] },
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function setProjects(data: typeof PROJECTS | [] = PROJECTS) {
  mockUseProjects.mockReturnValue({ isLoading: false, isError: false, data, error: null, refetch: jest.fn() });
}

// ─── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockUseProjects.mockReset();
  mockUseBoard.mockReset();
  mockUseSession.mockReset();
  mockReplace.mockReset();
  mockBack.mockReset();
  mockResetShareIntent.mockReset();
  mockGetLastShareTarget.mockReset();
  mockSetLastShareTarget.mockReset();
  mockShareToExistingCard.mockReset();
  mockShareToNewCard.mockReset();

  mockUseSession.mockReturnValue({ status: "authenticated", staff: STAFF });
  mockUseBoard.mockImplementation((code: string) => boardResult(code));
  mockGetLastShareTarget.mockResolvedValue(null);
  mockSetLastShareTarget.mockResolvedValue(undefined);
  setProjects();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ShareScreen — Add to card", () => {
  // ── 1. thumbnails + count ──
  it("renders a thumbnail per shared asset and a count label", async () => {
    wrap(<ShareScreen />);
    await waitFor(() => expect(screen.getByText("2 foto")).toBeTruthy());
    expect(screen.getAllByTestId("thumb").length).toBe(2);
    // let the async default-selection chain settle inside act
    await waitFor(() => expect(screen.getByTestId("card-row-c1")).toBeTruthy());
  });

  // ── 2. defaults: first project + first topic when no last target ──
  it("defaults to the first project and first topic when no last target", async () => {
    wrap(<ShareScreen />);
    // First topic of ARIN-1 (Rencana) → its cards shown
    await waitFor(() => expect(screen.getByTestId("card-row-c1")).toBeTruthy());
    expect(screen.getByTestId("card-row-c2")).toBeTruthy();
    // Second topic's cards not shown
    expect(screen.queryByTestId("card-row-c3")).toBeNull();
  });

  // ── 2b. defaults: last-used project + topic when present ──
  it("defaults to the last-used project and topic from prefs", async () => {
    mockGetLastShareTarget.mockResolvedValue({ projectId: "p2", projectCode: "BETA-1", topicId: "tb2" });
    wrap(<ShareScreen />);
    // BETA-1 board, topic tb2 (Konstruksi B) → its card shown
    await waitFor(() => expect(screen.getByTestId("card-row-cb2")).toBeTruthy());
    expect(screen.queryByTestId("card-row-cb1")).toBeNull();
  });

  // ── 3. tapping a card submits to it with the mapped assets ──
  it("submits to an existing card with the mapped assets on card press", async () => {
    mockShareToExistingCard.mockResolvedValue(OK_CLEAN);
    wrap(<ShareScreen />);
    await waitFor(() => expect(screen.getByTestId("card-row-c1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("card-row-c1"));

    await waitFor(() => expect(mockShareToExistingCard).toHaveBeenCalledTimes(1));
    const [client, args] = mockShareToExistingCard.mock.calls[0];
    expect(client).toEqual({ __tag: "supabase" });
    expect(args.projectId).toBe("p1");
    expect(args.cardId).toBe("c1");
    expect(args.cardSlug).toBe("kartu-a");
    expect(args.loggedByStaffId).toBe("staff-1");
    expect(args.assets).toEqual([
      { uri: "file:///a.jpg", name: "a.jpg", mimeType: "image/jpeg", size: 111 },
      { uri: "file:///b.png", name: "b.png", mimeType: "image/png", size: 222 },
    ]);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/(tabs)/(matrix)/project/[slug]/card/[cardSlug]",
      params: { slug: "ARIN-1", cardSlug: "kartu-a" },
    });
  });

  // ── 4. Kartu baru path ──
  it("creates a new card and attaches via shareToNewCard", async () => {
    mockShareToNewCard.mockResolvedValue({
      ok: true, cardId: "cNew", cardSlug: "kartu-baru",
      outcome: { eventId: "ev2", uploaded: 2, skipped: [], failed: [] },
    });
    wrap(<ShareScreen />);
    await waitFor(() => expect(screen.getByTestId("input-new-card")).toBeTruthy());

    fireEvent.changeText(screen.getByTestId("input-new-card"), "Foto Progres");
    fireEvent.press(screen.getByTestId("btn-create-card"));

    await waitFor(() => expect(mockShareToNewCard).toHaveBeenCalledTimes(1));
    const [, args] = mockShareToNewCard.mock.calls[0];
    expect(args.projectId).toBe("p1");
    expect(args.topicId).toBe("t1");
    expect(args.title).toBe("Foto Progres");
    expect(args.assets.length).toBe(2);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/(tabs)/(matrix)/project/[slug]/card/[cardSlug]",
      params: { slug: "ARIN-1", cardSlug: "kartu-baru" },
    });
  });

  // ── 5. note feeds the caption ──
  it("passes the Catatan note through to the submission", async () => {
    mockShareToExistingCard.mockResolvedValue(OK_CLEAN);
    wrap(<ShareScreen />);
    await waitFor(() => expect(screen.getByTestId("card-row-c1")).toBeTruthy());

    fireEvent.changeText(screen.getByTestId("input-note"), "Progres cor lantai 2");
    fireEvent.press(screen.getByTestId("card-row-c1"));

    await waitFor(() => expect(mockShareToExistingCard).toHaveBeenCalledTimes(1));
    expect(mockShareToExistingCard.mock.calls[0][1].note).toBe("Progres cor lantai 2");
  });

  // ── 6a. success persists last target + resets intent ──
  it("persists last target and resets the share intent on clean success", async () => {
    mockShareToExistingCard.mockResolvedValue(OK_CLEAN);
    wrap(<ShareScreen />);
    await waitFor(() => expect(screen.getByTestId("card-row-c1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("card-row-c1"));

    await waitFor(() => expect(mockSetLastShareTarget).toHaveBeenCalledTimes(1));
    expect(mockSetLastShareTarget).toHaveBeenCalledWith({
      projectId: "p1", projectCode: "ARIN-1", topicId: "t1",
    });
    expect(mockResetShareIntent).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  // ── 6b. partial outcome shows a summary before navigating ──
  it("shows a skip/fail summary and defers navigation on a partial outcome", async () => {
    mockShareToExistingCard.mockResolvedValue({
      ok: true, cardId: "c1", cardSlug: "kartu-a",
      outcome: {
        eventId: "ev1", uploaded: 1,
        skipped: [{ name: "b.png", reason: "Terlalu besar" }],
        failed: [],
      },
    });
    wrap(<ShareScreen />);
    await waitFor(() => expect(screen.getByTestId("card-row-c1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("card-row-c1"));

    await waitFor(() => expect(screen.getByTestId("outcome-summary")).toBeTruthy());
    // Navigation deferred until the user acknowledges
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("btn-outcome-continue"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockResetShareIntent).toHaveBeenCalledTimes(1);
  });

  // ── 7a. no projects empty state ──
  it("shows an empty state when there are no projects", async () => {
    setProjects([]);
    wrap(<ShareScreen />);
    await waitFor(() => expect(screen.getByText("Tidak ada proyek")).toBeTruthy());
    // flush the async last-target load so its state updates land inside act
    await waitFor(() => expect(mockGetLastShareTarget).toHaveBeenCalled());
  });

  // ── 7b. ok:false keeps state for retry ──
  it("shows an error and keeps state when submission fails", async () => {
    mockShareToExistingCard.mockResolvedValue({ ok: false, error: "Gagal membuat event" });
    wrap(<ShareScreen />);
    await waitFor(() => expect(screen.getByTestId("card-row-c1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("card-row-c1"));

    await waitFor(() => expect(screen.getByTestId("error-banner")).toBeTruthy());
    expect(screen.getByText("Gagal membuat event")).toBeTruthy();
    // No navigation, no reset — state preserved so the user can retry
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockResetShareIntent).not.toHaveBeenCalled();
    expect(screen.getByTestId("card-row-c1")).toBeTruthy();
  });

  // ── close (batal) resets intent + goes back ──
  it("resets the intent and goes back when Batal is pressed", async () => {
    wrap(<ShareScreen />);
    // wait for defaults to settle so the async chain runs inside act
    await waitFor(() => expect(screen.getByTestId("card-row-c1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("share-cancel"));
    expect(mockResetShareIntent).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
