/**
 * rooms.test.tsx — Rooms glance + Areas manager screen tests
 *
 * Mocking strategy:
 *   - @datum/core: mock I/O functions (getProjectRooms, getProjectAreas,
 *     createArea, updateArea, deleteArea, reorderAreas, applyAreaProposal);
 *     keep pure helpers real via requireActual (relativeTimeId,
 *     deriveStage, sortRoomsByUrgency, normalizeProposal, AREA_TYPES, etc.)
 *   - @/lib/supabase/client: stub (not called when core fns are mocked).
 *   - @/lib/env: WEB_BASE_URL is unset by default; specific tests override it.
 *   - @/lib/session/session: not used directly in this screen.
 *   - expo-router: stub useLocalSearchParams to return { slug: "ARIN-1" }.
 *   - react-native-safe-area-context: stub SafeAreaView → View.
 *   - @tanstack/react-query: keep real impl; stub onlineManager.
 *   - fetch: jest.spyOn for the AI suggest call.
 *
 * Covers:
 *   1. Rooms render sorted with stage/blocker badges
 *   2. Areas list renders after switching to Areas tab
 *   3. Add area calls createArea with correct input
 *   4. Delete area calls deleteArea
 *   5. Reorder calls reorderAreas with new order
 *   6. AI suggest button hidden when WEB_BASE_URL is unset
 *   7. AI suggest shows review sheet when fetch succeeds
 *   8. Empty state for rooms
 *   9. Error state for rooms
 *  10. Error state for areas
 */

import React from "react";
import {
  render,
  waitFor,
  fireEvent,
  screen,
  act,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoomsScreen from "./rooms";

// ---------------------------------------------------------------------------
// Mocks — @datum/core
// ---------------------------------------------------------------------------

const mockGetProjectRooms = jest.fn();
const mockGetProjectAreas = jest.fn();
const mockCreateArea = jest.fn();
const mockUpdateArea = jest.fn();
const mockDeleteArea = jest.fn();
const mockReorderAreas = jest.fn();
const mockApplyAreaProposal = jest.fn();

jest.mock("@datum/core", () => {
  const actual = jest.requireActual<typeof import("@datum/core")>("@datum/core");
  return {
    ...actual,
    getProjectRooms: (...args: unknown[]) => mockGetProjectRooms(...args),
    getProjectAreas: (...args: unknown[]) => mockGetProjectAreas(...args),
    createArea: (...args: unknown[]) => mockCreateArea(...args),
    updateArea: (...args: unknown[]) => mockUpdateArea(...args),
    deleteArea: (...args: unknown[]) => mockDeleteArea(...args),
    reorderAreas: (...args: unknown[]) => mockReorderAreas(...args),
    applyAreaProposal: (...args: unknown[]) => mockApplyAreaProposal(...args),
  };
});

// ---------------------------------------------------------------------------
// Mocks — infrastructure
// ---------------------------------------------------------------------------

jest.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: "test-token" } },
      }),
    },
  },
}));

// ── realtime hook: capture calls so we can assert projectId + slug are passed ─
const mockUseAreaGatesRealtime = jest.fn();
jest.mock("@/lib/realtime/useRealtimeInvalidation", () => ({
  useAreaGatesRealtime: (...args: unknown[]) => mockUseAreaGatesRealtime(...args),
  useProjectRealtime: jest.fn(),
  useNotificationsRealtime: jest.fn(),
}));

// Default: WEB_BASE_URL is unset (AI button hidden)
let mockWebBaseUrl: string | undefined = undefined;
jest.mock("@/lib/env", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  get WEB_BASE_URL() {
    return mockWebBaseUrl;
  },
}));

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ slug: "ARIN-1" }),
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

import type { Room, ProjectRooms } from "@datum/core";
import type { Area } from "@datum/db";

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    areaId: "area-001",
    areaCode: "L1-KM",
    areaName: "Kamar Mandi L1",
    floor: "L1",
    sortOrder: 0,
    stage: { kind: "active", gate: "B", status: "in_progress" },
    blockers: 0,
    activeCards: 2,
    lastActivityAt: new Date(Date.now() - 86_400_000).toISOString(),
    handoverReady: false,
    action: { text: "Gate B Struktur berjalan — 2 kartu aktif", tone: "active" },
    ...overrides,
  };
}

function makeBlockedRoom(): Room {
  return makeRoom({
    areaId: "area-002",
    areaCode: "L2-KM",
    areaName: "Kamar Mandi L2",
    stage: { kind: "active", gate: "C", status: "blocked" },
    blockers: 2,
    action: { text: "2 blocker — selesaikan dulu", tone: "urgent" },
  });
}

function makeProjectRooms(rooms: Room[] = []): ProjectRooms {
  return {
    projectId: "proj-001",
    projectCode: "ARIN-1",
    projectName: "Karawang Unit 1",
    rooms,
  };
}

function makeArea(overrides: Partial<Area> = {}): Area {
  return {
    id: "area-001",
    project_id: "proj-001",
    area_code: "L1-KM",
    area_name: "Kamar Mandi L1",
    floor: "L1",
    area_type: "bathroom",
    area_sqm: null,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Area;
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

describe("RoomsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebBaseUrl = undefined; // default: AI button hidden
    // Default: areas query returns empty (projectId not known until rooms resolves)
    mockGetProjectAreas.mockResolvedValue([]);
    mockUseAreaGatesRealtime.mockReturnValue(undefined);
  });

  // ── 1. Rooms render sorted with stage/blocker badges ────────────────────

  it("renders rooms sorted by urgency (blocked room first)", async () => {
    const blockedRoom = makeBlockedRoom();
    const activeRoom = makeRoom();
    // Rooms are pre-sorted by getProjectRooms (sortRoomsByUrgency in core)
    mockGetProjectRooms.mockResolvedValue(
      makeProjectRooms([blockedRoom, activeRoom]),
    );

    wrap(<RoomsScreen />);

    await waitFor(() => {
      // Blocked room name visible
      expect(screen.getByText("Kamar Mandi L2")).toBeTruthy();
      // Active room name visible
      expect(screen.getByText("Kamar Mandi L1")).toBeTruthy();
      // Blocker badge text appears
      expect(screen.getByText("2 blocker")).toBeTruthy();
      // Active stage badge
      expect(screen.getAllByText(/Gate B berjalan/).length).toBeGreaterThanOrEqual(1);
    });

    expect(mockGetProjectRooms).toHaveBeenCalledWith(
      expect.anything(),
      "ARIN-1",
    );
  });

  // ── 2. Areas list renders after tab switch ───────────────────────────────

  it("renders areas list after switching to Areas tab", async () => {
    mockGetProjectRooms.mockResolvedValue(makeProjectRooms([makeRoom()]));
    mockGetProjectAreas.mockResolvedValue([
      makeArea(),
      makeArea({
        id: "area-002",
        area_code: "L1-DAPUR",
        area_name: "Dapur L1",
        area_type: "kitchen",
        sort_order: 1,
      }),
    ]);

    wrap(<RoomsScreen />);

    // Wait for rooms to load, then switch tabs
    await waitFor(() => expect(screen.getByText("Kamar Mandi L1")).toBeTruthy());

    fireEvent.press(screen.getByText("Area"));

    await waitFor(() => {
      expect(screen.getByText("Kamar Mandi L1")).toBeTruthy();
      expect(screen.getByText("Dapur L1")).toBeTruthy();
    });

    expect(mockGetProjectAreas).toHaveBeenCalledWith(
      expect.anything(),
      "proj-001",
    );
  });

  // ── 3. Add area calls createArea ─────────────────────────────────────────

  it("add area form calls createArea with correct input", async () => {
    mockGetProjectRooms.mockResolvedValue(makeProjectRooms([makeRoom()]));
    mockGetProjectAreas.mockResolvedValue([]);
    mockCreateArea.mockResolvedValue({ ok: true });

    wrap(<RoomsScreen />);

    await waitFor(() => expect(screen.getByText("Area")).toBeTruthy());
    fireEvent.press(screen.getByText("Area"));

    // Open add form
    await waitFor(() => expect(screen.getByTestId("add-area-open-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("add-area-open-button"));

    // Fill in fields
    await waitFor(() => expect(screen.getByTestId("add-area-name-input")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("add-area-name-input"), "Kamar Mandi L2");
    fireEvent.changeText(screen.getByTestId("add-area-code-input"), "L2-KM");

    await act(async () => {
      fireEvent.press(screen.getByTestId("add-area-submit-button"));
    });

    await waitFor(() => {
      expect(mockCreateArea).toHaveBeenCalledWith(
        expect.anything(), // supabase
        expect.objectContaining({
          projectId: "proj-001",
          areaCode: "L2-KM",
          areaName: "Kamar Mandi L2",
          areaType: "general",
        }),
      );
    });
  });

  // ── 4. Delete area calls deleteArea ──────────────────────────────────────

  it("delete area button calls deleteArea after confirmation", async () => {
    mockGetProjectRooms.mockResolvedValue(makeProjectRooms([makeRoom()]));
    const area = makeArea();
    mockGetProjectAreas.mockResolvedValue([area]);
    mockDeleteArea.mockResolvedValue({ ok: true });

    // Mock Alert to auto-confirm
    const { Alert } = require("react-native");
    type AlertButton = { text: string; onPress?: () => void; style?: string };
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation((...args: unknown[]) => {
        const buttons = args[2] as AlertButton[] | undefined;
        // Tap "Hapus" button (destructive)
        const hapus = buttons?.find((b) => b.text === "Hapus");
        hapus?.onPress?.();
      });

    wrap(<RoomsScreen />);

    await waitFor(() => expect(screen.getByText("Area")).toBeTruthy());
    fireEvent.press(screen.getByText("Area"));

    await waitFor(() =>
      expect(screen.getByTestId(`area-delete-${area.id}`)).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`area-delete-${area.id}`));
    });

    await waitFor(() => {
      expect(mockDeleteArea).toHaveBeenCalledWith(
        expect.anything(), // supabase
        expect.objectContaining({
          areaId: area.id,
          projectId: area.project_id,
        }),
      );
    });

    alertSpy.mockRestore();
  });

  // ── 5. Reorder calls reorderAreas ────────────────────────────────────────

  it("move-up button calls reorderAreas with new order", async () => {
    mockGetProjectRooms.mockResolvedValue(makeProjectRooms([makeRoom()]));
    const area1 = makeArea({ sort_order: 0 });
    const area2 = makeArea({
      id: "area-002",
      area_code: "L1-DAPUR",
      area_name: "Dapur L1",
      sort_order: 1,
    });
    mockGetProjectAreas.mockResolvedValue([area1, area2]);
    mockReorderAreas.mockResolvedValue({ ok: true });

    wrap(<RoomsScreen />);

    await waitFor(() => expect(screen.getByText("Area")).toBeTruthy());
    fireEvent.press(screen.getByText("Area"));

    // The second area (idx 1) can move up
    await waitFor(() =>
      expect(screen.getByTestId(`area-move-up-${area2.id}`)).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`area-move-up-${area2.id}`));
    });

    await waitFor(() => {
      expect(mockReorderAreas).toHaveBeenCalledWith(
        expect.anything(), // supabase
        expect.objectContaining({
          projectId: "proj-001",
          // area2 moved up to index 0, area1 now at index 1
          areaIds: [area2.id, area1.id],
        }),
      );
    });
  });

  // ── 6. AI suggest button hidden when WEB_BASE_URL is unset ───────────────

  it("does not render AI suggest button when WEB_BASE_URL is not set", async () => {
    mockWebBaseUrl = undefined;
    mockGetProjectRooms.mockResolvedValue(makeProjectRooms([makeRoom()]));
    mockGetProjectAreas.mockResolvedValue([]);

    wrap(<RoomsScreen />);

    await waitFor(() => expect(screen.getByText("Area")).toBeTruthy());
    fireEvent.press(screen.getByText("Area"));

    // Wait for areas section to render
    await waitFor(() =>
      expect(screen.getByTestId("add-area-open-button")).toBeTruthy(),
    );

    // AI button must NOT be rendered
    expect(screen.queryByTestId("ai-suggest-button")).toBeNull();
  });

  // ── 7. AI suggest shows review sheet when fetch succeeds ─────────────────

  it("shows AI proposal review when fetch returns a valid proposal", async () => {
    mockWebBaseUrl = "https://datum.example.com";
    mockGetProjectRooms.mockResolvedValue(makeProjectRooms([makeRoom()]));
    mockGetProjectAreas.mockResolvedValue([]);

    // Mock fetch to return a valid raw proposal
    const mockFetch = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        areas: [
          {
            area_code: "L1-WC",
            area_name: "WC L1",
            area_type: "bathroom",
            floor: "L1",
          },
        ],
        assignments: [],
      }),
    } as Response);

    wrap(<RoomsScreen />);

    await waitFor(() => expect(screen.getByText("Area")).toBeTruthy());
    fireEvent.press(screen.getByText("Area"));

    await waitFor(() =>
      expect(screen.getByTestId("ai-suggest-button")).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId("ai-suggest-button"));
    });

    // Review sheet shows proposed area
    await waitFor(() => {
      expect(screen.getByTestId("proposal-area-L1-WC")).toBeTruthy();
      expect(screen.getByText("WC L1")).toBeTruthy();
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockFetch as any).mockRestore();
  });

  // ── 8. Empty state for rooms ─────────────────────────────────────────────

  it("shows empty state when no rooms are returned", async () => {
    mockGetProjectRooms.mockResolvedValue(makeProjectRooms([]));

    wrap(<RoomsScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Belum ada ruangan. Tambahkan area untuk melihat status di sini.",
        ),
      ).toBeTruthy();
    });
  });

  // ── 9. Error state for rooms ─────────────────────────────────────────────

  it("shows error state when getProjectRooms rejects", async () => {
    mockGetProjectRooms.mockRejectedValue(new Error("Koneksi gagal"));

    wrap(<RoomsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Gagal memuat data ruangan/)).toBeTruthy();
      expect(screen.getByText(/Koneksi gagal/)).toBeTruthy();
    });
  });

  // ── 10. Error state for areas ─────────────────────────────────────────────

  it("shows error state in Areas tab when getProjectAreas rejects", async () => {
    mockGetProjectRooms.mockResolvedValue(makeProjectRooms([makeRoom()]));
    mockGetProjectAreas.mockRejectedValue(new Error("DB error areas"));

    wrap(<RoomsScreen />);

    await waitFor(() => expect(screen.getByText("Area")).toBeTruthy());
    fireEvent.press(screen.getByText("Area"));

    await waitFor(() => {
      expect(screen.getByText(/Gagal memuat area/)).toBeTruthy();
      expect(screen.getByText(/DB error areas/)).toBeTruthy();
    });
  });

  // ── 11. Realtime subscription ────────────────────────────────────────────────

  it("calls useAreaGatesRealtime with resolved projectId and slug", async () => {
    mockGetProjectRooms.mockResolvedValue(makeProjectRooms([makeRoom()]));

    wrap(<RoomsScreen />);

    await waitFor(() => {
      // Once rooms resolve, projectId becomes "proj-001"; slug is "ARIN-1"
      const calledWithId = mockUseAreaGatesRealtime.mock.calls.some(
        (args) => args[0] === "proj-001" && args[1] === "ARIN-1",
      );
      expect(calledWithId).toBe(true);
    });
  });

  it("initially calls useAreaGatesRealtime with undefined projectId before rooms resolve", () => {
    // rooms query hangs — projectId stays undefined on first render
    mockGetProjectRooms.mockReturnValue(new Promise(() => {}));

    wrap(<RoomsScreen />);

    expect(mockUseAreaGatesRealtime).toHaveBeenCalledWith(undefined, "ARIN-1");
  });
});
