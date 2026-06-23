/**
 * review.test.tsx — Review queue screen tests
 *
 * Mocking strategy:
 *   - @datum/core: mock I/O functions (listPendingCardEventDrafts,
 *     approveCardEventDraft, rejectCardEventDraft, notifyDraftApproved,
 *     notifyDraftRejected); keep pure helpers (renderPayload, eventKindLabel)
 *     real via requireActual — they are already unit-tested in core.
 *   - @/lib/supabase/client: stub (not called when core fns are mocked).
 *   - @/lib/session/session: stub useSession to return a fixed staff id.
 *   - @/lib/query/hooks: NOT mocked — let useReviewDrafts call through to the
 *     mocked listPendingCardEventDrafts. Tests the hook wiring.
 *   - @/lib/query/mutations: NOT mocked — let useApproveDraft/useRejectDraft
 *     call through to the mocked core functions. Tests mutation wiring.
 *   - expo-router: stub (no navigation used in this screen).
 *   - react-native-safe-area-context: stub SafeAreaView → View.
 *   - @tanstack/react-query: keep real impl; stub onlineManager.
 *
 * Covers:
 *   1. Renders pending drafts from data
 *   2. Approve calls approveCardEventDraft + invalidates (item removed)
 *   3. Reject calls rejectCardEventDraft + invalidates (item removed)
 *   4. Empty state when no drafts
 *   5. Notify failure does NOT fail the approve (item still shows "approved")
 */

import React from "react";
import { render, waitFor, fireEvent, screen, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReviewScreen from "./review";

// ---------------------------------------------------------------------------
// Mocks — @datum/core
// ---------------------------------------------------------------------------

const mockListPending     = jest.fn();
const mockApprove         = jest.fn();
const mockReject          = jest.fn();
const mockNotifyApproved  = jest.fn();
const mockNotifyRejected  = jest.fn();

jest.mock("@datum/core", () => {
  // Keep pure helpers real — they're tested in core and we want real labels/fields.
  const actual = jest.requireActual<typeof import("@datum/core")>("@datum/core");
  return {
    ...actual,
    listPendingCardEventDrafts: (...args: unknown[]) => mockListPending(...args),
    approveCardEventDraft:      (...args: unknown[]) => mockApprove(...args),
    rejectCardEventDraft:       (...args: unknown[]) => mockReject(...args),
    notifyDraftApproved:        (...args: unknown[]) => mockNotifyApproved(...args),
    notifyDraftRejected:        (...args: unknown[]) => mockNotifyRejected(...args),
  };
});

// ---------------------------------------------------------------------------
// Mocks — infrastructure
// ---------------------------------------------------------------------------

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("@/lib/env", () => ({ SUPABASE_URL: "https://test.co", SUPABASE_ANON_KEY: "anon" }));

const APPROVER_ID = "staff-approver-001";

jest.mock("@/lib/session/session", () => ({
  useSession: () => ({
    status: "authenticated",
    staff: { id: APPROVER_ID, full_name: "Approver Tes", role: "principal", email: null },
    signOut: jest.fn(),
  }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  onlineManager: { isOnline: () => true, subscribe: () => () => {} },
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

import type { PendingDraft } from "@datum/core";

function makeDraft(overrides: Partial<PendingDraft> = {}): PendingDraft {
  return {
    id:                   "draft-001",
    project_id:           "proj-001",
    draft_type:           "card_event",
    proposed_payload: {
      kind:        "work",
      payload:     { description: "Pasang keramik lantai utama", unit: "m2", quantity: 40 },
      card_id:     "card-001",
      occurred_at: "2026-06-20T10:00:00Z",
      rationale:   "Pekerjaan fisik di lapangan dicatat oleh tim",
    },
    risk_level:           "high",
    source_type:          "chat",
    original_input_text:  "pasang 40m2 keramik lantai utama",
    created_at:           "2026-06-20T10:05:00Z",
    created_by_staff_id:  "staff-author-001",
    projects:             { project_code: "ARIN-1", project_name: "Karawang Unit 1" },
    created_by:           { full_name: "Budi Santoso" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReviewScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: notify resolves happily
    mockNotifyApproved.mockResolvedValue(undefined);
    mockNotifyRejected.mockResolvedValue(undefined);
  });

  // ── 1. Renders pending drafts ─────────────────────────────────────────────

  it("renders pending drafts returned by listPendingCardEventDrafts", async () => {
    const draft = makeDraft();
    mockListPending.mockResolvedValue([draft]);

    wrap(<ReviewScreen />);

    await waitFor(() => {
      // Project code
      expect(screen.getByText("ARIN-1")).toBeTruthy();
      // Event kind label — at least one element containing "Pekerjaan" exists
      expect(screen.getAllByText(/Pekerjaan/i).length).toBeGreaterThanOrEqual(1);
      // Berisiko tinggi badge — may appear in multiple text nodes
      expect(screen.getAllByText(/Berisiko tinggi/i).length).toBeGreaterThanOrEqual(1);
      // Author
      expect(screen.getByText(/Budi Santoso/)).toBeTruthy();
      // Rationale
      expect(screen.getByText(/Pekerjaan fisik di lapangan/)).toBeTruthy();
      // Original input
      expect(screen.getByText(/pasang 40m2 keramik lantai utama/i)).toBeTruthy();
    });

    expect(mockListPending).toHaveBeenCalledTimes(1);
  });

  // ── 2. Approve calls core + item shows approved state ────────────────────

  it("approve calls approveCardEventDraft with correct args and shows approved state", async () => {
    const draft = makeDraft();
    mockListPending.mockResolvedValue([draft]);
    mockApprove.mockResolvedValue({
      ok:           true,
      eventId:      "ev-001",
      projectId:    draft.project_id,
      projectCode:  "ARIN-1",
      cardSlug:     "arin-1-keramik",
      eventKind:    "work",
      draftAuthorId: "staff-author-001",
      gateRelevant: true,
    });

    wrap(<ReviewScreen />);

    await waitFor(() => expect(screen.getByTestId("approve-button")).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId("approve-button"));
    });

    await waitFor(() => {
      expect(mockApprove).toHaveBeenCalledWith(
        expect.anything(), // supabase
        expect.objectContaining({ draftId: draft.id, approverId: APPROVER_ID }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("approved-badge")).toBeTruthy();
    });
  });

  // ── 3. Reject calls core + item shows rejected state ─────────────────────

  it("reject calls rejectCardEventDraft with correct args and shows rejected state", async () => {
    const draft = makeDraft({ id: "draft-002" });
    mockListPending.mockResolvedValue([draft]);
    mockReject.mockResolvedValue({
      ok:           true,
      projectId:    draft.project_id,
      draftAuthorId: "staff-author-001",
      eventKind:    "work",
    });

    wrap(<ReviewScreen />);

    // Expand reject form
    await waitFor(() => expect(screen.getByTestId("reject-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("reject-button"));

    // Type a reason
    await waitFor(() => expect(screen.getByTestId("reject-reason-input")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("reject-reason-input"), "AI salah tangkap");

    await act(async () => {
      fireEvent.press(screen.getByTestId("reject-confirm-button"));
    });

    await waitFor(() => {
      expect(mockReject).toHaveBeenCalledWith(
        expect.anything(), // supabase
        expect.objectContaining({ draftId: draft.id, rejectorId: APPROVER_ID, reason: "AI salah tangkap" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("rejected-badge")).toBeTruthy();
    });
  });

  // ── 4. Empty state ────────────────────────────────────────────────────────

  it("shows empty state when no drafts are returned", async () => {
    mockListPending.mockResolvedValue([]);

    wrap(<ReviewScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("review-empty")).toBeTruthy();
      expect(screen.getByText(/Tidak ada draf untuk ditinjau/)).toBeTruthy();
    });
  });

  // ── 5. Notify failure does NOT fail the approve ───────────────────────────

  it("approve succeeds even when notifyDraftApproved rejects (RLS deny)", async () => {
    const draft = makeDraft({ id: "draft-notify-fail" });
    mockListPending.mockResolvedValue([draft]);
    mockApprove.mockResolvedValue({
      ok:           true,
      eventId:      "ev-002",
      projectId:    draft.project_id,
      projectCode:  "ARIN-1",
      cardSlug:     "arin-1-keramik",
      eventKind:    "work",
      draftAuthorId: "staff-author-001",
      gateRelevant: false,
    });

    // Simulate RLS denial on notify
    mockNotifyApproved.mockRejectedValue(new Error("RLS: insufficient privilege"));

    wrap(<ReviewScreen />);

    await waitFor(() => expect(screen.getByTestId("approve-button")).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId("approve-button"));
    });

    // The approve result must still be shown (not error state)
    await waitFor(() => {
      expect(screen.getByTestId("approved-badge")).toBeTruthy();
    });

    // Notify was attempted
    expect(mockNotifyApproved).toHaveBeenCalled();
    // But error-badge must NOT appear
    expect(screen.queryByText(/Gagal menyetujui/)).toBeNull();
  });
});
