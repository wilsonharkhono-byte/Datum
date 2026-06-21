import { render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MatrixScreen from "./index";

const mockGetProjectsList = jest.fn();
jest.mock("@datum/core", () => ({
  ...jest.requireActual("@datum/core"),
  getProjectsList: (...a: unknown[]) => mockGetProjectsList(...a),
}));
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("@/lib/env", () => ({ SUPABASE_URL: "https://test.co", SUPABASE_ANON_KEY: "anon" }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("MatrixScreen", () => {
  beforeEach(() => mockGetProjectsList.mockReset());
  it("shows the empty state when there are no projects", async () => {
    mockGetProjectsList.mockResolvedValue([]);
    const { getByText } = wrap(<MatrixScreen />);
    await waitFor(() => expect(getByText("Belum ada proyek yang ditugaskan.")).toBeTruthy());
  });
  it("lists projects from the core query", async () => {
    mockGetProjectsList.mockResolvedValue([
      { id: "p1", project_code: "ARIN-1", project_name: "Karawang", client_name: "Nabil", location: "Karawang", status: "active", target_handover: null, development_id: null, development_name: null, development_area_label: null, development_sort_order: null, cover_image_path: null, cover_url: null },
    ]);
    const { getByText } = wrap(<MatrixScreen />);
    await waitFor(() => expect(getByText("ARIN-1")).toBeTruthy());
    expect(getByText("Karawang")).toBeTruthy();
  });
});
