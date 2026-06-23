/**
 * Tests for the Schedule & Readiness screen and its sub-components.
 *
 * Strategy:
 * - Seed a QueryClient with MatrixData + ScheduledCell[] fixtures.
 * - Render ScheduleScreen via a thin wrapper with the expo-router mock.
 * - Mock @datum/core data-access fns; let pure helpers (gateLabel, ADVANCEABLE,
 *   GATE_SHORT_NAME) pass through via requireActual.
 * - Cover: areas render with gate statuses; advance sheet opens on tapping an
 *   advanceable gate; confirm calls markGatePassed + invalidates; empty-areas
 *   state; error state.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import { keys } from "@datum/core";
import type { MatrixData, MatrixCell, ScheduledCell } from "@datum/core";

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

// ── realtime hook: capture calls so we can assert projectId is passed ─────────
const mockUseAreaGatesRealtime = jest.fn();
jest.mock("@/lib/realtime/useRealtimeInvalidation", () => ({
  useAreaGatesRealtime: (...args: unknown[]) => mockUseAreaGatesRealtime(...args),
  useProjectRealtime: jest.fn(),
  useNotificationsRealtime: jest.fn(),
}));
jest.mock("@/lib/env", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
}));

// expo-router
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(() => ({ slug: "P1" })),
  useRouter: jest.fn(() => ({ back: jest.fn() })),
  Stack: {
    Screen: ({ options }: { options?: { title?: string } }) => null,
  },
}));

// session
jest.mock("@/lib/session/session", () => ({
  useSession: jest.fn(() => ({
    status: "authenticated",
    staff: { id: "staff-uuid-1", full_name: "Wilson", role: "principal", email: null },
    signOut: jest.fn(),
  })),
}));

// @datum/core: mock data-access fns; keep pure helpers via requireActual
const mockFetchMatrix = jest.fn();
const mockGetProjectScheduleCells = jest.fn();
const mockGetBoardForProject = jest.fn();
const mockGetGateCheckpoints = jest.fn();
const mockMarkGatePassed = jest.fn();
const mockSetAreaTargetDate = jest.fn();

jest.mock("@datum/core", () => {
  const actual = jest.requireActual("@datum/core");
  return {
    ...actual,
    fetchMatrix: (...args: unknown[]) => mockFetchMatrix(...args),
    getProjectScheduleCells: (...args: unknown[]) => mockGetProjectScheduleCells(...args),
    getBoardForProject: (...args: unknown[]) => mockGetBoardForProject(...args),
    getGateCheckpoints: (...args: unknown[]) => mockGetGateCheckpoints(...args),
    markGatePassed: (...args: unknown[]) => mockMarkGatePassed(...args),
    setAreaTargetDate: (...args: unknown[]) => mockSetAreaTargetDate(...args),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT_ID = "proj-uuid-1";
const CODE = "P1";
const AREA_BATH_ID = "area-bath-uuid";
const AREA_LIVING_ID = "area-living-uuid";

const FIXTURE_BOARD = {
  project: {
    id: PROJECT_ID,
    project_code: CODE,
    project_name: "Villa Sentosa",
    client_name: null,
    location: null,
    status: "active",
    target_handover: null,
    development_id: null,
    cover_image_path: null,
  },
  columns: [],
} as unknown as import("@datum/core").Board;

function makeCellKey(areaId: string, gateCode: string) {
  return `${areaId}|${gateCode}`;
}

function makeMatrixData(override: Partial<MatrixData> = {}): MatrixData {
  const cells = new Map<string, MatrixCell>();

  // Bathroom: Gate A = ready_for_handoff (advanceable), Gate B = in_progress (advanceable)
  cells.set(makeCellKey(AREA_BATH_ID, "A"), {
    project_id: PROJECT_ID,
    area_id: AREA_BATH_ID,
    gate_code: "A",
    status: "ready_for_handoff",
    blocking_reason: null,
    current_owner_id: null,
  });
  cells.set(makeCellKey(AREA_BATH_ID, "B"), {
    project_id: PROJECT_ID,
    area_id: AREA_BATH_ID,
    gate_code: "B",
    status: "in_progress",
    blocking_reason: null,
    current_owner_id: null,
  });
  cells.set(makeCellKey(AREA_BATH_ID, "C"), {
    project_id: PROJECT_ID,
    area_id: AREA_BATH_ID,
    gate_code: "C",
    status: "blocked",
    blocking_reason: "Material belum datang",
    current_owner_id: null,
  });

  // Living: Gate A = passed, no others
  cells.set(makeCellKey(AREA_LIVING_ID, "A"), {
    project_id: PROJECT_ID,
    area_id: AREA_LIVING_ID,
    gate_code: "A",
    status: "passed",
    blocking_reason: null,
    current_owner_id: null,
  });

  return {
    project_id: PROJECT_ID,
    project_code: CODE,
    project_name: "Villa Sentosa",
    areas: [
      {
        id: AREA_BATH_ID,
        area_code: "BATH",
        area_name: "Master Bathroom",
        floor: "LT1",
        sort_order: 0,
      },
      {
        id: AREA_LIVING_ID,
        area_code: "LIVING",
        area_name: "Ruang Tamu",
        floor: "LT1",
        sort_order: 1,
      },
    ],
    gates: ["A", "B", "C", "D", "E", "F", "G", "H"],
    cells,
    ...override,
  };
}

const FIXTURE_SCHEDULE_CELLS: ScheduledCell[] = [
  {
    area_id: AREA_BATH_ID,
    gate_code: "H",
    status: "not_started",
    target_start_date: "2026-08-01",
    target_end_date: "2026-09-01",
    actual_start_date: null,
    actual_end_date: null,
  } as ScheduledCell,
];

const FIXTURE_CHECKPOINTS = [
  { id: "cp-1", itemText: "Cek sambungan pipa", required: true, sortOrder: 1 },
  { id: "cp-2", itemText: "Pastikan kemiringan benar", required: false, sortOrder: 2 },
];

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function seedClient(client: QueryClient, matrixOverride?: Partial<MatrixData>) {
  client.setQueryData(keys.board(CODE), FIXTURE_BOARD);
  client.setQueryData(keys.matrix(PROJECT_ID), makeMatrixData(matrixOverride));
  client.setQueryData(keys.schedule(PROJECT_ID), FIXTURE_SCHEDULE_CELLS);
}

// Import after mocks
const ScheduleScreen =
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("./schedule").default as React.ComponentType;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScheduleScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBoardForProject.mockResolvedValue(FIXTURE_BOARD);
    mockFetchMatrix.mockResolvedValue(makeMatrixData());
    mockGetProjectScheduleCells.mockResolvedValue(FIXTURE_SCHEDULE_CELLS);
    mockGetGateCheckpoints.mockResolvedValue(FIXTURE_CHECKPOINTS);
    mockMarkGatePassed.mockResolvedValue({ ok: true, completedDate: "2026-06-22" });
    mockSetAreaTargetDate.mockResolvedValue({ ok: true });
    mockUseAreaGatesRealtime.mockReturnValue(undefined);
  });

  // ── Renders areas with gate statuses ────────────────────────────────────────

  it("renders area names once data is loaded", async () => {
    const client = makeClient();
    seedClient(client);
    const { getByText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });
    expect(getByText("Master Bathroom")).toBeTruthy();
    expect(getByText("Ruang Tamu")).toBeTruthy();
  });

  it("renders correct project name in heading", () => {
    const client = makeClient();
    seedClient(client);
    const { getByText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });
    expect(getByText("Villa Sentosa")).toBeTruthy();
  });

  it("expands area accordion and shows gate rows", async () => {
    const client = makeClient();
    seedClient(client);
    const { getByText, getByLabelText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    // Tap Master Bathroom header to expand (use accessibilityLabel, not Text)
    await act(async () => {
      fireEvent.press(getByLabelText("Master Bathroom, buka"));
    });

    // Gate A should be visible (MEP Rough-in)
    expect(getByText("A · MEP Rough-in")).toBeTruthy();
    // Gate C = blocked
    expect(getByText("C · Plafon")).toBeTruthy();
  });

  it("shows 'Siap serah' badge for ready_for_handoff gate", async () => {
    const client = makeClient();
    seedClient(client);
    const { getByText, getByLabelText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    await act(async () => {
      fireEvent.press(getByLabelText("Master Bathroom, buka"));
    });

    expect(getByText("Siap serah")).toBeTruthy();
  });

  it("shows 'Terblokir' badge for blocked gate", async () => {
    const client = makeClient();
    seedClient(client);
    const { getByText, getByLabelText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    await act(async () => {
      fireEvent.press(getByLabelText("Master Bathroom, buka"));
    });

    expect(getByText("Terblokir")).toBeTruthy();
  });

  it("shows blocking reason text under the blocked gate", async () => {
    const client = makeClient();
    seedClient(client);
    const { getByText, getByLabelText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    await act(async () => {
      fireEvent.press(getByLabelText("Master Bathroom, buka"));
    });

    expect(getByText("Material belum datang")).toBeTruthy();
  });

  // ── Advance gate flow ────────────────────────────────────────────────────────

  it("shows 'Tandai selesai' button for advanceable gate", async () => {
    const client = makeClient();
    seedClient(client);
    const { getByLabelText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    await act(async () => {
      fireEvent.press(getByLabelText("Master Bathroom, buka"));
    });

    // Gate A is ready_for_handoff → advance button should exist via accessibilityLabel
    expect(getByLabelText("Tandai Gate A selesai")).toBeTruthy();
  });

  it("opens GateAdvanceSheet when tapping advance button for Gate A", async () => {
    const client = makeClient();
    seedClient(client);
    const { getByLabelText, getByText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    // Expand accordion
    await act(async () => {
      fireEvent.press(getByLabelText("Master Bathroom, buka"));
    });

    // Tap the Gate A advance button (identified by accessibilityLabel)
    await act(async () => {
      fireEvent.press(getByLabelText("Tandai Gate A selesai"));
    });

    // Sheet header should appear
    expect(getByText("Tandai gate selesai")).toBeTruthy();
    expect(getByText("Gate A · Master Bathroom")).toBeTruthy();
  });

  it("shows checkpoints in the advance sheet", async () => {
    const client = makeClient();
    seedClient(client);
    // Seed checkpoints
    client.setQueryData(keys.gateCheckpoints("A"), FIXTURE_CHECKPOINTS);

    const { getByLabelText, getByText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    await act(async () => {
      fireEvent.press(getByLabelText("Master Bathroom, buka"));
    });
    await act(async () => {
      fireEvent.press(getByLabelText("Tandai Gate A selesai"));
    });

    expect(getByText("Cek sambungan pipa")).toBeTruthy();
    expect(getByText("Pastikan kemiringan benar")).toBeTruthy();
  });

  it("confirms advance and calls markGatePassed", async () => {
    const client = makeClient();
    seedClient(client);
    client.setQueryData(keys.gateCheckpoints("A"), FIXTURE_CHECKPOINTS);

    const { getByLabelText, getAllByText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    await act(async () => {
      fireEvent.press(getByLabelText("Master Bathroom, buka"));
    });
    await act(async () => {
      fireEvent.press(getByLabelText("Tandai Gate A selesai"));
    });

    // Tap the confirm button in the sheet footer (last "Tandai selesai" text)
    const confirmBtns = getAllByText("Tandai selesai");
    await act(async () => {
      fireEvent.press(confirmBtns[confirmBtns.length - 1]!);
    });

    await waitFor(() => {
      expect(mockMarkGatePassed).toHaveBeenCalledWith(
        expect.anything(), // supabase client
        "staff-uuid-1",    // staffId from session
        expect.objectContaining({
          projectId: PROJECT_ID,
          areaId: AREA_BATH_ID,
          gateCode: "A",
        }),
      );
    });
  });

  it("invalidates matrix and schedule after confirming advance", async () => {
    const client = makeClient();
    seedClient(client);
    client.setQueryData(keys.gateCheckpoints("A"), []);

    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { getByLabelText, getAllByText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    await act(async () => {
      fireEvent.press(getByLabelText("Master Bathroom, buka"));
    });
    await act(async () => {
      fireEvent.press(getByLabelText("Tandai Gate A selesai"));
    });

    const confirmBtns = getAllByText("Tandai selesai");
    await act(async () => {
      fireEvent.press(confirmBtns[confirmBtns.length - 1]!);
    });

    await waitFor(() => {
      const calls = invalidateSpy.mock.calls;
      const matrixCall = calls.some(
        (args) => JSON.stringify(args[0]) === JSON.stringify({ queryKey: keys.matrix(PROJECT_ID) }),
      );
      const scheduleCall = calls.some(
        (args) => JSON.stringify(args[0]) === JSON.stringify({ queryKey: keys.schedule(PROJECT_ID) }),
      );
      expect(matrixCall).toBe(true);
      expect(scheduleCall).toBe(true);
    });
  });

  // ── Empty areas state ────────────────────────────────────────────────────────

  it("shows empty state when matrix has no areas", () => {
    const client = makeClient();
    client.setQueryData(keys.board(CODE), FIXTURE_BOARD);
    client.setQueryData(keys.matrix(PROJECT_ID), makeMatrixData({ areas: [], cells: new Map() }));
    client.setQueryData(keys.schedule(PROJECT_ID), []);

    const { getByText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });
    expect(getByText(/Belum ada area di proyek P1/)).toBeTruthy();
  });

  // ── Error state ──────────────────────────────────────────────────────────────

  it("shows error state when matrix query fails", async () => {
    const client = makeClient();
    client.setQueryData(keys.board(CODE), FIXTURE_BOARD);
    // Do not seed matrix so it will try to fetch and fail
    mockFetchMatrix.mockRejectedValue(new Error("Network error"));

    const { findByText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });
    await findByText(/Gagal memuat jadwal/);
  });

  // ── Loading skeleton ─────────────────────────────────────────────────────────

  it("shows skeletons while data is loading", () => {
    // Don't pre-seed: queries will be in pending state
    const client = makeClient();
    mockFetchMatrix.mockReturnValue(new Promise(() => {}));
    mockGetBoardForProject.mockReturnValue(new Promise(() => {}));

    const { getAllByLabelText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });
    expect(getAllByLabelText("Memuat").length).toBeGreaterThan(0);
  });

  // ── Rules explainer ──────────────────────────────────────────────────────────

  it("renders rules explainer collapsed by default", () => {
    const client = makeClient();
    seedClient(client);
    const { getByText, queryByText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    expect(getByText("Aturan kesiapan")).toBeTruthy();
    // Content only visible when expanded
    expect(queryByText("Belum mulai")).toBeNull();
  });

  it("expands rules explainer on tap", async () => {
    const client = makeClient();
    seedClient(client);
    const { getByText } = render(<ScheduleScreen />, { wrapper: wrapper(client) });

    await act(async () => {
      fireEvent.press(getByText("Aturan kesiapan"));
    });

    expect(getByText("Belum mulai")).toBeTruthy();
    expect(getByText("Siap serah")).toBeTruthy();
  });

  // ── Realtime subscription ────────────────────────────────────────────────────

  it("calls useAreaGatesRealtime with resolved projectId", () => {
    const client = makeClient();
    seedClient(client);
    render(<ScheduleScreen />, { wrapper: wrapper(client) });
    // useAreaGatesRealtime must have been called at least once with the project id
    // (may also be called with undefined before board resolves)
    const calledWithId = mockUseAreaGatesRealtime.mock.calls.some(
      (args) => args[0] === PROJECT_ID,
    );
    expect(calledWithId).toBe(true);
  });

  it("does not crash when projectId is undefined (board not yet resolved)", () => {
    const client = makeClient();
    // Do not seed board data → projectId stays undefined on first render
    mockGetBoardForProject.mockReturnValue(new Promise(() => {}));
    expect(() => render(<ScheduleScreen />, { wrapper: wrapper(client) })).not.toThrow();
    // hook called with undefined initially — that is valid
    expect(mockUseAreaGatesRealtime).toHaveBeenCalledWith(undefined);
  });
});

// ─── AreaGateCard unit tests ──────────────────────────────────────────────────

import { AreaGateCard } from "@/components/schedule/AreaGateCard";

describe("AreaGateCard", () => {
  const matrix = makeMatrixData();
  const area = matrix.areas[0]!; // Master Bathroom

  function renderCard(targetDate: string | null = null) {
    return render(
      <AreaGateCard
        area={area}
        matrix={matrix}
        scheduledCells={FIXTURE_SCHEDULE_CELLS}
        onAdvanceGate={jest.fn()}
        onSetTarget={jest.fn()}
        targetDate={targetDate}
      />,
    );
  }

  it("renders area name in header", () => {
    const { getByText } = renderCard();
    // Text is rendered inside the pressable header
    expect(getByText("Master Bathroom")).toBeTruthy();
  });

  it("is collapsed by default (no gate rows visible)", () => {
    const { queryByText } = renderCard();
    expect(queryByText("A · MEP Rough-in")).toBeNull();
  });

  it("expands on press to show gate rows", async () => {
    const { getByLabelText, getByText } = renderCard();
    await act(async () => {
      fireEvent.press(getByLabelText("Master Bathroom, buka"));
    });
    expect(getByText("A · MEP Rough-in")).toBeTruthy();
  });

  it("shows target date chip when targetDate is set", () => {
    const { getByLabelText } = renderCard("2026-09-01");
    expect(getByLabelText(/Target serah terima/)).toBeTruthy();
  });

  it("shows '+ target' affordance when no targetDate", () => {
    const { getByLabelText } = renderCard(null);
    expect(getByLabelText("Set target serah terima")).toBeTruthy();
  });

  it("opens date editor inline when tapping target chip", async () => {
    const { getAllByPlaceholderText, getByLabelText } = renderCard("2026-09-01");
    await act(async () => {
      fireEvent.press(getByLabelText(/Target serah terima/));
    });
    expect(getAllByPlaceholderText("YYYY-MM-DD").length).toBeGreaterThan(0);
  });

  it("calls onSetTarget with new date on save", async () => {
    const onSetTarget = jest.fn().mockResolvedValue(undefined);
    const { getByLabelText, getAllByPlaceholderText, getByText } = render(
      <AreaGateCard
        area={area}
        matrix={matrix}
        scheduledCells={FIXTURE_SCHEDULE_CELLS}
        onAdvanceGate={jest.fn()}
        onSetTarget={onSetTarget}
        targetDate={null}
      />,
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Set target serah terima"));
    });
    const input = getAllByPlaceholderText("YYYY-MM-DD")[0]!;
    fireEvent.changeText(input, "2026-10-01");
    await act(async () => {
      fireEvent.press(getByText("Simpan"));
    });

    expect(onSetTarget).toHaveBeenCalledWith(area.id, "2026-10-01");
  });
});
