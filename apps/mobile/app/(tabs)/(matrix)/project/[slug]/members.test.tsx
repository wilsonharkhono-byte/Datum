/**
 * members.test.tsx — Project members screen tests
 *
 * Mocking strategy:
 *   - @datum/core: mock I/O fns (getProjectMembers, getAvailableStaff,
 *     getProjectBySlug, addProjectMember, removeProjectMember); keep
 *     pure helpers real via requireActual (canManageAccess, etc.)
 *   - @/lib/supabase/client: stub (core fns mocked; no real DB calls)
 *   - @/lib/env: stub
 *   - @/lib/session/session: injectable via mockSession
 *   - expo-router: stub useLocalSearchParams({ slug: "ARIN-1" }), useRouter
 *   - react-native-safe-area-context: SafeAreaView → View
 *   - @tanstack/react-query: real impl; onlineManager stub
 *   - Alert.alert: jest.spyOn to simulate confirm/cancel
 *
 * Covers:
 *   1. Members render (name, role, since date)
 *   2. Remove button triggers Alert.alert; confirm calls removeProjectMember
 *   3. Add member calls addProjectMember with correct staffId + role
 *   4. Staff-create stub shows the "belum di mobile" notice (no network)
 *   5. Non-manager (designer role): no remove button, no add section
 *   6. Empty state when no active members
 *   7. Error state when getProjectMembers rejects
 *   8. Loading skeleton while query is pending
 */

import React from "react";
import {
  render,
  waitFor,
  fireEvent,
  screen,
  act,
} from "@testing-library/react-native";
import { Alert } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MembersScreen from "./members";

// ─────────────────────────────────────────────────────────────────────────────
// @datum/core mock
// ─────────────────────────────────────────────────────────────────────────────

const mockGetProjectMembers = jest.fn();
const mockGetAvailableStaff = jest.fn();
const mockGetProjectBySlug = jest.fn();
const mockAddProjectMember = jest.fn();
const mockRemoveProjectMember = jest.fn();

jest.mock("@datum/core", () => {
  const actual = jest.requireActual<typeof import("@datum/core")>("@datum/core");
  return {
    ...actual,
    getProjectMembers: (...args: unknown[]) => mockGetProjectMembers(...args),
    getAvailableStaff: (...args: unknown[]) => mockGetAvailableStaff(...args),
    getProjectBySlug: (...args: unknown[]) => mockGetProjectBySlug(...args),
    addProjectMember: (...args: unknown[]) => mockAddProjectMember(...args),
    removeProjectMember: (...args: unknown[]) => mockRemoveProjectMember(...args),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Infrastructure mocks
// ─────────────────────────────────────────────────────────────────────────────

jest.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: "test-token" } },
      }),
    },
  },
}));

jest.mock("@/lib/env", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
}));

let mockSessionStaff: import("@datum/core").CurrentStaff | null = {
  id: "staff-principal-001",
  full_name: "Budi Santoso",
  role: "principal",
  email: "budi@test.com",
};

jest.mock("@/lib/session/session", () => ({
  useSession: () => ({
    status: "authenticated",
    staff: mockSessionStaff,
    signOut: jest.fn(),
  }),
}));

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ slug: "ARIN-1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_SETTINGS = {
  id: "proj-uuid-001",
  project_code: "ARIN-1",
  project_name: "Arina Residence",
  client_name: "Bu Arina",
  location: "Jakarta Selatan",
  status: "construction",
  target_handover: "2025-06-30",
  kickoff_date: "2024-01-15",
};

const MEMBER_BUDI: import("@datum/core").ProjectMemberRow = {
  staff_id: "staff-budi-001",
  role_on_project: "designer",
  active_from: "2024-01-15",
  active_until: null,
  staff: {
    id: "staff-budi-001",
    full_name: "Budi Santoso",
    role: "designer",
    email: "budi@test.com",
    active: true,
  },
};

const MEMBER_DIAH: import("@datum/core").ProjectMemberRow = {
  staff_id: "staff-diah-002",
  role_on_project: "pic",
  active_from: "2024-02-01",
  active_until: null,
  staff: {
    id: "staff-diah-002",
    full_name: "Diah Permata",
    role: "pic",
    email: "diah@test.com",
    active: true,
  },
};

const MEMBER_INACTIVE: import("@datum/core").ProjectMemberRow = {
  staff_id: "staff-old-003",
  role_on_project: "estimator",
  active_from: "2023-01-01",
  active_until: "2024-01-01",
  staff: {
    id: "staff-old-003",
    full_name: "Staf Lama",
    role: "estimator",
    email: null,
    active: false,
  },
};

const AVAIL_STAFF = [
  { id: "staff-andi-004", full_name: "Andi Wijaya", role: "estimator", email: "andi@test.com" },
];

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = makeQC();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionStaff = {
    id: "staff-principal-001",
    full_name: "Budi Santoso",
    role: "principal",
    email: "budi@test.com",
  };
  mockGetProjectBySlug.mockResolvedValue(PROJECT_SETTINGS);
  mockGetProjectMembers.mockResolvedValue([MEMBER_BUDI, MEMBER_DIAH, MEMBER_INACTIVE]);
  mockGetAvailableStaff.mockResolvedValue(AVAIL_STAFF);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("MembersScreen", () => {
  it("1. renders active member names and roles", async () => {
    render(<MembersScreen />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("Budi Santoso")).toBeTruthy();
      expect(screen.getByText("Diah Permata")).toBeTruthy();
    });

    // Inactive member should NOT appear
    expect(screen.queryByText("Staf Lama")).toBeNull();
    // Active member count
    expect(screen.getByText("2 orang")).toBeTruthy();
  });

  it("2. remove button triggers Alert.alert; confirm calls removeProjectMember", async () => {
    const alertSpy = jest.spyOn(Alert, "alert");
    mockRemoveProjectMember.mockResolvedValue({ ok: true });

    render(<MembersScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("Budi Santoso")).toBeTruthy());

    // Press remove button for Budi
    const removeBtn = screen.getAllByLabelText(/Hapus Budi Santoso/i)[0];
    expect(removeBtn).toBeTruthy();
    fireEvent.press(removeBtn!);

    // Alert.alert was called with the member name
    expect(alertSpy).toHaveBeenCalledWith(
      "Hapus Anggota",
      expect.stringContaining("Budi Santoso"),
      expect.any(Array),
    );

    // Simulate pressing the "Hapus" button in the alert
    const alertButtons = alertSpy.mock.calls[0]?.[2] as { text: string; onPress?: () => void }[] | undefined;
    const hapusBtn = alertButtons?.find((b) => b.text === "Hapus");
    expect(hapusBtn).toBeDefined();

    await act(async () => {
      hapusBtn?.onPress?.();
    });

    await waitFor(() => {
      expect(mockRemoveProjectMember).toHaveBeenCalledWith(
        expect.anything(), // supabase
        expect.objectContaining({
          staffId: "staff-budi-001",
          roleOnProject: "designer",
          projectId: "proj-uuid-001",
        }),
      );
    });
  });

  it("3. add member calls addProjectMember with correct staffId + role", async () => {
    mockAddProjectMember.mockResolvedValue({ ok: true });

    render(<MembersScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("Andi Wijaya")).toBeTruthy());

    // Select Andi
    fireEvent.press(screen.getByText("Andi Wijaya"));

    // Press the add button (unique label distinguishes from section header)
    fireEvent.press(screen.getByText("Tambahkan ke Proyek"));

    await waitFor(() => {
      expect(mockAddProjectMember).toHaveBeenCalledWith(
        expect.anything(), // supabase
        expect.objectContaining({
          staffId: "staff-andi-004",
          roleOnProject: "designer",
          projectId: "proj-uuid-001",
        }),
      );
    });
  });

  it("4. staff-create stub shows the 'belum di mobile' notice when pressed", async () => {
    const alertSpy = jest.spyOn(Alert, "alert");

    render(<MembersScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/Buat staf baru/)).toBeTruthy());

    // Press the stub button
    fireEvent.press(screen.getByText(/Buat staf baru/));

    expect(alertSpy).toHaveBeenCalledWith(
      "Buat Staf Baru",
      expect.stringContaining("belum di mobile"),
      expect.any(Array),
    );
    // No addProjectMember or removeProjectMember calls (no server path)
    expect(mockAddProjectMember).not.toHaveBeenCalled();
    expect(mockRemoveProjectMember).not.toHaveBeenCalled();
  });

  it("5. non-manager (designer role): no remove button, no add section", async () => {
    // Override session to a non-manager
    mockSessionStaff = {
      id: "staff-diah-002",
      full_name: "Diah Permata",
      role: "designer",
      email: "diah@test.com",
    };

    render(<MembersScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("Budi Santoso")).toBeTruthy());

    // No remove buttons
    expect(screen.queryAllByLabelText(/Hapus/)).toHaveLength(0);
    // No add member button
    expect(screen.queryByText("Tambahkan ke Proyek")).toBeNull();
    // The notice for non-managers should appear
    expect(screen.getByText(/Hanya principal dan admin/)).toBeTruthy();
  });

  it("6. empty state when no active members", async () => {
    mockGetProjectMembers.mockResolvedValue([MEMBER_INACTIVE]);

    render(<MembersScreen />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Belum ada anggota aktif/)).toBeTruthy(),
    );
  });

  it("7. error state when getProjectMembers rejects", async () => {
    mockGetProjectMembers.mockRejectedValue(new Error("DB error"));

    render(<MembersScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("DB error")).toBeTruthy());
  });

  it("8. loading skeleton while projectSettings query is pending", async () => {
    // Never resolves
    mockGetProjectBySlug.mockReturnValue(new Promise(() => {}));

    render(<MembersScreen />, { wrapper: Wrapper });
    // No member names yet (still loading)
    expect(screen.queryByText("Budi Santoso")).toBeNull();
  });
});
