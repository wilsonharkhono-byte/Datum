import { render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { SessionProvider, useSession } from "./session";

const mockGetUser = jest.fn();
const mockOnAuthStateChange = jest.fn((_cb: unknown) => ({ data: { subscription: { unsubscribe: jest.fn() } } }));
const mockSignOut = jest.fn();
jest.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => mockGetUser(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
      signOut: () => mockSignOut(),
    },
  },
}));
jest.mock("@/lib/query/async-kv", () => ({ clearAsyncCache: jest.fn(async () => {}) }));
const mockGetCurrentStaff = jest.fn();
jest.mock("@datum/core", () => ({
  getCurrentStaff: (client: unknown) => mockGetCurrentStaff(client),
}));

function Probe() {
  const { staff, status } = useSession();
  return <Text>{status}:{staff?.full_name ?? "none"}</Text>;
}

describe("SessionProvider", () => {
  beforeEach(() => { mockGetUser.mockReset(); mockGetCurrentStaff.mockReset(); mockSignOut.mockReset(); });
  it("resolves to authenticated with the staff name", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetCurrentStaff.mockResolvedValue({ id: "u1", full_name: "Wilson", role: "principal", email: null });
    const { getByText } = render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(getByText("authenticated:Wilson")).toBeTruthy());
  });
  it("treats an orphan auth user (no staff row) as unauthenticated and signs out", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetCurrentStaff.mockResolvedValue(null);
    const { getByText } = render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(getByText("unauthenticated:none")).toBeTruthy());
    expect(mockSignOut).toHaveBeenCalled();
  });
  it("is unauthenticated when there is no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { getByText } = render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(getByText("unauthenticated:none")).toBeTruthy());
  });
  it("does NOT sign out on a transient staff-read failure", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetCurrentStaff.mockRejectedValue(new Error("[db] auth.currentStaff: network error"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { getByText, unmount } = render(<SessionProvider><Probe /></SessionProvider>);
    // Stays in loading (retry pending) instead of bouncing to login.
    await waitFor(() => expect(mockGetCurrentStaff).toHaveBeenCalled());
    expect(getByText("loading:none")).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
    unmount(); // clears the retry timer
    warn.mockRestore();
  });
});
