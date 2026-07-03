/**
 * brief.test.tsx — Morning Brief screen tests
 *
 * Mocking strategy:
 *   - @datum/core: mock getBriefData + getAdvisorData (async I/O).
 *     Pure helpers (rankAdvisorItems, dueLabelFor, ageLabelFor) are re-used
 *     via requireActual — they're tested by their own core unit tests, but we
 *     keep them real so AdvisorItem shapes flow through correctly.
 *   - @/lib/query/hooks: NOT mocked — we let useBrief/useAdvisor call through
 *     to the mocked core functions. This tests the hook wiring too.
 *   - @/lib/supabase/client: stub (not called when core fns are mocked).
 *   - expo-router: stub useRouter + push.
 *   - react-native-safe-area-context: stub SafeAreaView → View.
 *   - @tanstack/react-query: keep real impl; stub onlineManager for OfflineBanner.
 */

import React from "react";
import { render, waitFor, fireEvent, screen, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BriefScreen from "./brief";

// ---------------------------------------------------------------------------
// Mocks — @datum/core
// ---------------------------------------------------------------------------

const mockGetBriefData = jest.fn();
const mockGetAdvisorData = jest.fn();

jest.mock("@datum/core", () => {
  // Keep pure functions real so AdvisorItem scores/labels are correct.
  const actual = jest.requireActual<typeof import("@datum/core")>("@datum/core");
  return {
    ...actual,
    getBriefData: (...args: unknown[]) => mockGetBriefData(...args),
    getAdvisorData: (...args: unknown[]) => mockGetAdvisorData(...args),
  };
});

// ---------------------------------------------------------------------------
// Mocks — infrastructure
// ---------------------------------------------------------------------------

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("@/lib/env", () => ({ SUPABASE_URL: "https://test.co", SUPABASE_ANON_KEY: "anon" }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
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

import type { AdvisorItem, BriefData, AdvisorData } from "@datum/core";

function makeAdvisorItem(overrides: Partial<AdvisorItem> = {}): AdvisorItem {
  return {
    type: "blocker",
    score: 82,
    title: "Terblokir: Pekerjaan Lantai",
    detail: "Menunggu material dari vendor",
    href: "/project/ARIN-1/cards/arin-1-flooring",
    projectCode: "ARIN-1",
    dueLabel: "3 hari",
    ...overrides,
  };
}

function makeAdvisorData(items: AdvisorItem[] = []): AdvisorData {
  return { items, upcomingGateCells: [] };
}

const EMPTY_BRIEF: BriefData = {
  pendingDrafts:   { count: 0, items: [] },
  blockers:        { count: 0, items: [] },
  defects:         { count: 0, items: [] },
  decisionsNeeded: { count: 0, items: [] },
  awaitingClient:  { count: 0, items: [] },
  expiringQuotes:  { count: 0, items: [] },
  gateRisks:       [],
  staleByProject:  [],
};

function makeBriefData(overrides: Partial<BriefData> = {}): BriefData {
  return { ...EMPTY_BRIEF, ...overrides };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BriefScreen", () => {
  beforeEach(() => {
    mockGetBriefData.mockReset();
    mockGetAdvisorData.mockReset();
    mockPush.mockReset();
  });

  // ── Advisor feed: renders items ──────────────────────────────────────────

  it("renders advisor items from seeded data", async () => {
    const items = [
      makeAdvisorItem({
        type: "blocker",
        title: "Terblokir: Pekerjaan Lantai",
        projectCode: "ARIN-1",
        dueLabel: "3 hari",
      }),
      makeAdvisorItem({
        type: "gate_overdue",
        score: 110,
        title: "Gate D R. Tamu lewat 5 hari",
        projectCode: "BETA-2",
        dueLabel: "lewat 5 hari",
        href: "/project/BETA-2/schedule",
      }),
    ];
    mockGetAdvisorData.mockResolvedValue(makeAdvisorData(items));
    mockGetBriefData.mockResolvedValue(makeBriefData());

    wrap(<BriefScreen />);

    await waitFor(() => {
      expect(screen.getByText("Terblokir: Pekerjaan Lantai")).toBeTruthy();
      expect(screen.getByText("Gate D R. Tamu lewat 5 hari")).toBeTruthy();
      // Rank numbers
      expect(screen.getByText("1")).toBeTruthy();
      expect(screen.getByText("2")).toBeTruthy();
    });
  });

  // ── BriefSection: renders a section with items ───────────────────────────

  it("renders a brief section with items from seeded data", async () => {
    mockGetAdvisorData.mockResolvedValue(makeAdvisorData());
    mockGetBriefData.mockResolvedValue(
      makeBriefData({
        blockers: {
          count: 1,
          items: [
            {
              id: "blk_ev1",
              projectCode: "ARIN-1",
              cardTitle: "Pekerjaan Lantai",
              cardHref: "/project/ARIN-1/cards/arin-1-flooring",
              detail: "Material belum tiba",
              meta: "2 hari",
            },
          ],
        },
      }),
    );

    wrap(<BriefScreen />);

    await waitFor(() => {
      // Section heading
      expect(screen.getByText(/Pekerjaan terblokir/)).toBeTruthy();
      // Item content
      expect(screen.getByText("Pekerjaan Lantai")).toBeTruthy();
      expect(screen.getByText("Material belum tiba")).toBeTruthy();
      // Project code chip
      expect(screen.getByText("ARIN-1")).toBeTruthy();
    });
  });

  // ── Empty advisor state ──────────────────────────────────────────────────

  it("shows empty advisor message when no items returned", async () => {
    mockGetAdvisorData.mockResolvedValue(makeAdvisorData([]));
    mockGetBriefData.mockResolvedValue(makeBriefData());

    wrap(<BriefScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("advisor-empty")).toBeTruthy();
      expect(screen.getByText(/Tidak ada prioritas mendesak hari ini/)).toBeTruthy();
    });
  });

  // ── Tap advisor item → card route ────────────────────────────────────────

  it("navigates to card route when an advisor card item is tapped", async () => {
    mockGetAdvisorData.mockResolvedValue(
      makeAdvisorData([
        makeAdvisorItem({
          type: "decision_needed",
          score: 70,
          title: "Butuh keputusan: Tipe Lantai",
          href: "/project/ARIN-1/cards/arin-1-floor-type",
          projectCode: "ARIN-1",
        }),
      ]),
    );
    mockGetBriefData.mockResolvedValue(makeBriefData());

    wrap(<BriefScreen />);

    await waitFor(() => expect(screen.getByText("Butuh keputusan: Tipe Lantai")).toBeTruthy());

    fireEvent.press(screen.getByTestId("advisor-row-decision_needed-1"));

    expect(mockPush).toHaveBeenCalledWith(
      "/(tabs)/(matrix)/project/ARIN-1/card/arin-1-floor-type",
    );
  });

  // ── Tap advisor item → schedule route ────────────────────────────────────

  it("navigates to schedule route when a gate item is tapped", async () => {
    mockGetAdvisorData.mockResolvedValue(
      makeAdvisorData([
        makeAdvisorItem({
          type: "gate_overdue",
          score: 110,
          title: "Gate D lewat 5 hari",
          href: "/project/BETA-2/schedule",
          projectCode: "BETA-2",
        }),
      ]),
    );
    mockGetBriefData.mockResolvedValue(makeBriefData());

    wrap(<BriefScreen />);

    await waitFor(() => expect(screen.getByText("Gate D lewat 5 hari")).toBeTruthy());

    fireEvent.press(screen.getByTestId("advisor-row-gate_overdue-1"));

    expect(mockPush).toHaveBeenCalledWith(
      "/(tabs)/(matrix)/project/BETA-2/schedule",
    );
  });

  // ── Tap brief item → card route ──────────────────────────────────────────

  it("navigates to card route when a brief section item is tapped", async () => {
    mockGetAdvisorData.mockResolvedValue(makeAdvisorData());
    mockGetBriefData.mockResolvedValue(
      makeBriefData({
        decisionsNeeded: {
          count: 1,
          items: [
            {
              id: "dec_ev1",
              projectCode: "GAMMA-3",
              cardTitle: "Pilih Supplier Genteng",
              cardHref: "/project/GAMMA-3/cards/gamma-3-roofing",
              detail: "vendor: menunggu PM",
              meta: "5 hari",
            },
          ],
        },
      }),
    );

    wrap(<BriefScreen />);

    await waitFor(() => expect(screen.getByText("Pilih Supplier Genteng")).toBeTruthy());

    fireEvent.press(screen.getByTestId("brief-item-dec_ev1"));

    expect(mockPush).toHaveBeenCalledWith(
      "/(tabs)/(matrix)/project/GAMMA-3/card/gamma-3-roofing",
    );
  });

  // ── Gate cascade risks ───────────────────────────────────────────────────

  it("renders gate cascade risk rows", async () => {
    mockGetAdvisorData.mockResolvedValue(makeAdvisorData());
    mockGetBriefData.mockResolvedValue(
      makeBriefData({
        gateRisks: [
          {
            projectCode: "ARIN-1",
            areaId: "area-kitchen",
            areaName: "Dapur",
            gateCode: "C",
            reason: "Gate B belum selesai",
          },
        ],
      }),
    );

    wrap(<BriefScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("gate-risks")).toBeTruthy();
      expect(screen.getByText(/Dapur/)).toBeTruthy();
      expect(screen.getByText(/Gate B belum selesai/)).toBeTruthy();
    });
  });

  // ── Stale by project ─────────────────────────────────────────────────────

  it("renders stale-by-project rows", async () => {
    mockGetAdvisorData.mockResolvedValue(makeAdvisorData());
    mockGetBriefData.mockResolvedValue(
      makeBriefData({
        staleByProject: [
          { projectCode: "ARIN-1", projectName: "Karawang Unit 1", staleCount: 4 },
        ],
      }),
    );

    wrap(<BriefScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("stale-projects")).toBeTruthy();
      expect(screen.getByText("Karawang Unit 1")).toBeTruthy();
      expect(screen.getByText("4 stale")).toBeTruthy();
    });
  });

  // ── Stale-card demotion (capStaleCards) ──────────────────────────────────
  // Same render-level cap as web's /brief (see packages/core/src/advisor/stale-cap.ts):
  // only the first 3 stale_card rows show in the advisor feed, the rest collapse
  // into a "+N lainnya tanpa aktivitas" hint instead of drowning the feed.

  it("caps stale_card rows at 3 and shows the hiddenStaleCount hint for the rest", async () => {
    const staleItems = Array.from({ length: 5 }, (_, i) =>
      makeAdvisorItem({
        type: "stale_card",
        score: 30,
        title: `Tanpa aktivitas: Kartu ${i + 1}`,
        href: `/project/ARIN-1/cards/arin-1-card-${i + 1}`,
        projectCode: "ARIN-1",
        dueLabel: undefined,
      }),
    );
    mockGetAdvisorData.mockResolvedValue(makeAdvisorData(staleItems));
    mockGetBriefData.mockResolvedValue(makeBriefData());

    wrap(<BriefScreen />);

    await waitFor(() => {
      expect(screen.getByText("Tanpa aktivitas: Kartu 1")).toBeTruthy();
      expect(screen.getByText("Tanpa aktivitas: Kartu 3")).toBeTruthy();
      expect(screen.queryByText("Tanpa aktivitas: Kartu 4")).toBeNull();
      expect(screen.queryByText("Tanpa aktivitas: Kartu 5")).toBeNull();
      expect(screen.getByTestId("advisor-hidden-stale")).toBeTruthy();
      expect(screen.getByText("+2 lainnya tanpa aktivitas")).toBeTruthy();
    });
  });

  it("does not show the hiddenStaleCount hint when stale_card items are at or under the cap", async () => {
    const staleItems = Array.from({ length: 2 }, (_, i) =>
      makeAdvisorItem({
        type: "stale_card",
        score: 30,
        title: `Tanpa aktivitas: Kartu ${i + 1}`,
        href: `/project/ARIN-1/cards/arin-1-card-${i + 1}`,
        projectCode: "ARIN-1",
        dueLabel: undefined,
      }),
    );
    mockGetAdvisorData.mockResolvedValue(makeAdvisorData(staleItems));
    mockGetBriefData.mockResolvedValue(makeBriefData());

    wrap(<BriefScreen />);

    await waitFor(() => {
      expect(screen.getByText("Tanpa aktivitas: Kartu 1")).toBeTruthy();
      expect(screen.getByText("Tanpa aktivitas: Kartu 2")).toBeTruthy();
    });
    expect(screen.queryByTestId("advisor-hidden-stale")).toBeNull();
  });

  // ── Error state ──────────────────────────────────────────────────────────

  it("shows error state when advisor query rejects", async () => {
    mockGetAdvisorData.mockRejectedValue(new Error("Koneksi gagal"));
    mockGetBriefData.mockResolvedValue(makeBriefData());

    wrap(<BriefScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Gagal memuat advisor: Koneksi gagal/)).toBeTruthy();
    });
    expect(screen.getByText("Coba lagi")).toBeTruthy();
  });

  it("shows error state when brief query rejects", async () => {
    mockGetAdvisorData.mockResolvedValue(makeAdvisorData());
    mockGetBriefData.mockRejectedValue(new Error("Server error"));

    wrap(<BriefScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Gagal memuat ringkasan: Server error/)).toBeTruthy();
    });
  });

  // ── Empty brief sections ─────────────────────────────────────────────────

  it("shows empty message for each section when brief has no items", async () => {
    mockGetAdvisorData.mockResolvedValue(makeAdvisorData());
    mockGetBriefData.mockResolvedValue(makeBriefData());

    wrap(<BriefScreen />);

    await waitFor(() => {
      expect(screen.getByText("Tidak ada draft yang menunggu.")).toBeTruthy();
      expect(screen.getByText("Tidak ada keputusan yang menunggu.")).toBeTruthy();
      expect(screen.getByText("Tidak ada pekerjaan terblokir.")).toBeTruthy();
      expect(screen.getByText("Tidak ada defect terbaru.")).toBeTruthy();
      expect(screen.getByText("Tidak ada permintaan klien aktif.")).toBeTruthy();
      expect(screen.getByText("Tidak ada quote yang akan kedaluwarsa.")).toBeTruthy();
      expect(screen.getByText("Tidak ada gate yang berisiko terlambat berantai.")).toBeTruthy();
      expect(screen.getByText("Semua readiness up-to-date.")).toBeTruthy();
    });
  });
});
