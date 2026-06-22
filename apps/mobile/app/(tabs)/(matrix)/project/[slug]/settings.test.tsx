/**
 * settings.test.tsx — Project settings screen tests
 *
 * Mocking strategy:
 *   - @datum/core: mock I/O fns (getProjectBySlug, updateProject); keep
 *     pure helpers real via requireActual (canManageAccess, PROJECT_STATUS)
 *   - @/lib/supabase/client: stub
 *   - @/lib/env: stub
 *   - @/lib/session/session: injectable via mockSessionStaff
 *   - expo-router: stub useLocalSearchParams({ slug: "ARIN-1" }), useRouter
 *   - react-native-safe-area-context: SafeAreaView → View
 *   - @tanstack/react-query: real impl; onlineManager stub
 *
 * Covers:
 *   1. Settings screen renders current project values in the Proyek tab
 *   2. Save calls updateProject with the patched values
 *   3. "Tersimpan" chip appears after a successful save
 *   4. Non-manager (designer): only "Area" tab visible; edit affordances hidden
 *   5. Akses tab has a "Buka Manajemen Anggota" button
 *   6. Area tab has a "Buka Manajemen Area" button
 *   7. Empty / not-found state when getProjectBySlug returns null
 *   8. Error state when getProjectBySlug throws
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
import SettingsScreen from "./settings";

// ─────────────────────────────────────────────────────────────────────────────
// @datum/core mock
// ─────────────────────────────────────────────────────────────────────────────

const mockGetProjectBySlug = jest.fn();
const mockUpdateProject = jest.fn();

jest.mock("@datum/core", () => {
  const actual = jest.requireActual<typeof import("@datum/core")>("@datum/core");
  return {
    ...actual,
    getProjectBySlug: (...args: unknown[]) => mockGetProjectBySlug(...args),
    updateProject: (...args: unknown[]) => mockUpdateProject(...args),
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

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ slug: "ARIN-1" }),
  useRouter: () => ({ push: mockRouterPush, back: jest.fn() }),
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
  mockUpdateProject.mockResolvedValue({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("SettingsScreen", () => {
  it("1. renders current project values in the Proyek tab", async () => {
    render(<SettingsScreen />, { wrapper: Wrapper });

    // Switch to Proyek tab
    await waitFor(() => expect(screen.getByText("Proyek")).toBeTruthy());
    fireEvent.press(screen.getByText("Proyek"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Arina Residence")).toBeTruthy();
      expect(screen.getByDisplayValue("Bu Arina")).toBeTruthy();
      expect(screen.getByDisplayValue("Jakarta Selatan")).toBeTruthy();
      expect(screen.getByDisplayValue("2024-01-15")).toBeTruthy();
      expect(screen.getByDisplayValue("2025-06-30")).toBeTruthy();
    });
  });

  it("2. save calls updateProject with patched values", async () => {
    render(<SettingsScreen />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText("Proyek")).toBeTruthy());
    fireEvent.press(screen.getByText("Proyek"));

    await waitFor(() => expect(screen.getByDisplayValue("Arina Residence")).toBeTruthy());

    // Change project name
    fireEvent.changeText(
      screen.getByDisplayValue("Arina Residence"),
      "Arina Residence Updated",
    );

    // Press save
    fireEvent.press(screen.getByText("Simpan"));

    await waitFor(() => {
      expect(mockUpdateProject).toHaveBeenCalledWith(
        expect.anything(), // supabase
        expect.objectContaining({
          projectId: "proj-uuid-001",
          projectName: "Arina Residence Updated",
        }),
      );
    });
  });

  it("3. 'Tersimpan' chip appears after successful save", async () => {
    render(<SettingsScreen />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText("Proyek")).toBeTruthy());
    fireEvent.press(screen.getByText("Proyek"));
    await waitFor(() => expect(screen.getByText("Simpan")).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByText("Simpan"));
    });

    await waitFor(() => expect(screen.getByText("Tersimpan")).toBeTruthy());
  });

  it("4. non-manager (designer): only Area tab visible; edit affordances hidden", async () => {
    mockSessionStaff = {
      id: "staff-diah-002",
      full_name: "Diah Permata",
      role: "designer",
      email: "diah@test.com",
    };

    render(<SettingsScreen />, { wrapper: Wrapper });
    // Wait for the Area tab to render (non-manager only sees this tab)
    await waitFor(() => expect(screen.getByText("Area")).toBeTruthy());

    // Akses and Proyek tabs should NOT be visible
    expect(screen.queryByText("Akses")).toBeNull();
    expect(screen.queryByText("Proyek")).toBeNull();

    // Area tab is visible
    expect(screen.getByText("Area")).toBeTruthy();

    // Edit form is not present
    expect(screen.queryByText("Simpan")).toBeNull();
  });

  it("5. Akses tab has a 'Buka Manajemen Anggota' button", async () => {
    render(<SettingsScreen />, { wrapper: Wrapper });

    // Akses is the default tab for managers
    await waitFor(() => expect(screen.getByText("Buka Manajemen Anggota →")).toBeTruthy());

    fireEvent.press(screen.getByText("Buka Manajemen Anggota →"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining("members"),
    );
  });

  it("6. Area tab has a 'Buka Manajemen Area' button", async () => {
    render(<SettingsScreen />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText("Area")).toBeTruthy());
    fireEvent.press(screen.getByText("Area"));

    await waitFor(() => expect(screen.getByText("Buka Manajemen Area →")).toBeTruthy());

    fireEvent.press(screen.getByText("Buka Manajemen Area →"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining("rooms"),
    );
  });

  it("7. empty / not-found state when getProjectBySlug returns null", async () => {
    mockGetProjectBySlug.mockResolvedValue(null);

    render(<SettingsScreen />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Proyek tidak ditemukan/)).toBeTruthy(),
    );
  });

  it("8. error state when getProjectBySlug throws", async () => {
    mockGetProjectBySlug.mockRejectedValue(new Error("Network error"));

    render(<SettingsScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("Network error")).toBeTruthy());
  });
});
