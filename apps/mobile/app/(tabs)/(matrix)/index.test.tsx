import React from "react";
import { render, waitFor, fireEvent, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MatrixScreen from "./index";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the mobile hooks (which wrap core) so we control data directly.
const mockUseProjects = jest.fn();
const mockUseDevelopments = jest.fn();
jest.mock("@/lib/query/hooks", () => ({
  useProjects: () => mockUseProjects(),
  useDevelopments: () => mockUseDevelopments(),
}));

// Stub supabase + env (not used when hooks are mocked, but required by module graph)
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("@/lib/env", () => ({ SUPABASE_URL: "https://test.co", SUPABASE_ANON_KEY: "anon" }));

// expo-router
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// expo-image — render as a plain View so no native image loading is needed
jest.mock("expo-image", () => ({
  Image: (_props: any) => {
    const { View } = require("react-native");
    return <View testID="expo-image" />;
  },
}));

// react-native-safe-area-context
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// @tanstack/react-query onlineManager used by OfflineBanner
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  onlineManager: { isOnline: () => true, subscribe: () => () => {} },
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const DEV_A = "dev-alpha";
const DEV_B = "dev-beta";

function makeProject(
  overrides: Partial<{
    id: string;
    project_code: string;
    project_name: string;
    client_name: string | null;
    status: string;
    development_id: string | null;
    development_name: string | null;
    development_area_label: string | null;
    development_sort_order: number | null;
    cover_url: string | null;
    cover_image_path: string | null;
    location: string | null;
    target_handover: string | null;
  }> = {},
) {
  return {
    id: "p1",
    project_code: "ARIN-1",
    project_name: "Karawang Unit 1",
    client_name: "Nabil",
    location: "Karawang",
    status: "design",
    target_handover: null,
    development_id: DEV_A,
    development_name: "Alpha",
    development_area_label: "West Java",
    development_sort_order: 1,
    cover_image_path: null,
    cover_url: null,
    ...overrides,
  };
}

const PROJECTS_SEEDED = [
  makeProject({ id: "p1", project_code: "ARIN-1", project_name: "Karawang Unit 1", development_id: DEV_A, development_name: "Alpha", development_sort_order: 1 }),
  makeProject({ id: "p2", project_code: "ARIN-2", project_name: "Karawang Unit 2", client_name: "Siti", development_id: DEV_A, development_name: "Alpha", development_sort_order: 1 }),
  makeProject({ id: "p3", project_code: "BETA-1", project_name: "Bekasi Block B", client_name: "Omar", status: "construction", development_id: DEV_B, development_name: "Beta", development_area_label: "Jakarta", development_sort_order: 2 }),
];

const DEVELOPMENTS = [
  { id: DEV_A, name: "Alpha", area_label: "West Java", sort_order: 1 },
  { id: DEV_B, name: "Beta", area_label: "Jakarta", sort_order: 2 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function useLoading() {
  mockUseProjects.mockReturnValue({ isLoading: true, isError: false, data: undefined, error: null, refetch: jest.fn() });
  mockUseDevelopments.mockReturnValue({ isLoading: true, data: undefined });
}

function useData(projects = PROJECTS_SEEDED, developments = DEVELOPMENTS) {
  mockUseProjects.mockReturnValue({ isLoading: false, isError: false, data: projects, error: null, refetch: jest.fn() });
  mockUseDevelopments.mockReturnValue({ isLoading: false, data: developments });
}

function useError(message = "Network error") {
  const err = new Error(message);
  mockUseProjects.mockReturnValue({ isLoading: false, isError: true, data: undefined, error: err, refetch: jest.fn() });
  mockUseDevelopments.mockReturnValue({ isLoading: false, data: [] });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MatrixScreen — projects landing", () => {
  beforeEach(() => {
    mockUseProjects.mockReset();
    mockUseDevelopments.mockReset();
    mockPush.mockReset();
  });

  // --- Loading ---
  it("shows skeleton loading state while data is fetching", () => {
    useLoading();
    wrap(<MatrixScreen />);
    // Skeleton renders with accessibilityLabel "Memuat" — at least one is present
    const skeletons = screen.getAllByLabelText("Memuat");
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  // --- Empty (no projects assigned) ---
  it("shows empty state when user has no projects", async () => {
    useData([], []);
    wrap(<MatrixScreen />);
    await waitFor(() =>
      expect(screen.getByText("Belum ada proyek yang ditugaskan.")).toBeTruthy(),
    );
  });

  // --- Error ---
  it("shows error state with retry button on fetch failure", async () => {
    useError("Koneksi gagal");
    wrap(<MatrixScreen />);
    await waitFor(() =>
      expect(screen.getByText(/Gagal memuat proyek: Koneksi gagal/)).toBeTruthy(),
    );
    expect(screen.getByText("Coba lagi")).toBeTruthy();
  });

  // --- Grouped sections render ---
  it("renders grouped section headers from seeded data", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() => {
      // Section headers contain group names and counts
      expect(screen.getByText(/Alpha · 2/)).toBeTruthy();
      expect(screen.getByText(/Beta · 1/)).toBeTruthy();
    });
  });

  it("renders project codes within cards (testID)", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() => {
      // Each ProjectCard has a testID of "project-card-{code}"
      expect(screen.getByTestId("project-card-ARIN-1")).toBeTruthy();
      expect(screen.getByTestId("project-card-ARIN-2")).toBeTruthy();
      expect(screen.getByTestId("project-card-BETA-1")).toBeTruthy();
    });
  });

  it("shows client names on project cards", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() => {
      expect(screen.getByText("Client: Nabil")).toBeTruthy();
    });
  });

  it("shows area_label in section header", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() => {
      expect(screen.getByText("West Java")).toBeTruthy();
    });
  });

  // --- Header stats ---
  it("shows project count and development count in header", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() => {
      // 3 non-closed projects; 2 developments
      expect(screen.getByText(/3 proyek aktif · 2 pengembangan/)).toBeTruthy();
    });
  });

  it("renders the Buat proyek button", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() => expect(screen.getByText("+ Buat proyek")).toBeTruthy());
  });

  // --- Filtered empty ---
  it("shows filtered-empty message when search matches nothing", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() => expect(screen.getByTestId("project-card-ARIN-1")).toBeTruthy());

    fireEvent.changeText(
      screen.getByPlaceholderText("Cari proyek, klien, atau lokasi…"),
      "zzz-nomatch-xyz",
    );

    await waitFor(() =>
      expect(
        screen.getByText("Tidak ada proyek yang cocok dengan filter."),
      ).toBeTruthy(),
    );
  });

  // --- Search filtering ---
  it("filters projects by search query", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() => expect(screen.getByTestId("project-card-ARIN-1")).toBeTruthy());

    fireEvent.changeText(
      screen.getByPlaceholderText("Cari proyek, klien, atau lokasi…"),
      "BETA",
    );

    await waitFor(() => expect(screen.getByTestId("project-card-BETA-1")).toBeTruthy());
    expect(screen.queryByTestId("project-card-ARIN-1")).toBeNull();
  });

  // --- Status pill filter ---
  it("filters projects by status pill", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() => expect(screen.getByTestId("project-card-ARIN-1")).toBeTruthy());

    // Tap "Konstruksi" pill via testID
    fireEvent.press(screen.getByTestId("filter-pill-construction"));

    await waitFor(() => expect(screen.getByTestId("project-card-BETA-1")).toBeTruthy());
    expect(screen.queryByTestId("project-card-ARIN-1")).toBeNull();
  });

  // --- Navigation ---
  it("navigates to project detail when card is pressed", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("project-card-ARIN-1")).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId("project-card-ARIN-1"));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/(matrix)/project/ARIN-1");
  });

  // --- Collapsible sections ---
  it("collapses a section when the header is pressed", async () => {
    useData();
    wrap(<MatrixScreen />);
    await waitFor(() => expect(screen.getByTestId("project-card-ARIN-1")).toBeTruthy());

    // Press "Alpha" section header to collapse it
    fireEvent.press(screen.getByText(/Alpha · 2/));

    await waitFor(() =>
      expect(screen.queryByTestId("project-card-ARIN-1")).toBeNull(),
    );
    // Beta section should still be visible
    expect(screen.getByTestId("project-card-BETA-1")).toBeTruthy();
  });

  // --- Backwards compat: original assertions still pass ---
  it("shows the empty state when there are no projects (compat)", async () => {
    useData([], []);
    wrap(<MatrixScreen />);
    await waitFor(() =>
      expect(screen.getByText("Belum ada proyek yang ditugaskan.")).toBeTruthy(),
    );
  });

  it("lists projects from the core query (compat)", async () => {
    useData([
      makeProject({ id: "p1", project_code: "ARIN-1", project_name: "Karawang", client_name: "Nabil", development_id: null, development_name: null, development_area_label: null, development_sort_order: null }),
    ], []);
    wrap(<MatrixScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("project-card-ARIN-1")).toBeTruthy();
    });
  });
});
