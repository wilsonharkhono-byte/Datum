/**
 * Gate provider-coverage tests.
 *
 * Regression for the on-device cold-start crash (2026-07-23, Galaxy S24):
 * expo-router mounts the initial (tabs) route before Gate's login redirect
 * effect runs, and TabsLayout calls useQuery (inbox unread badge). Gate used
 * to render bare children until the session was authenticated, so that first
 * frame had NO QueryClient → "No QueryClient set" → hard crash in release.
 * Contract now: Gate always wraps children in a QueryClient once the session
 * state is known, and renders nothing while it is still loading.
 */
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Gate } from "./_layout";

jest.mock("@react-native-community/netinfo", () =>
  require("@react-native-community/netinfo/jest/netinfo-mock.js"),
);

// In-memory KV so the authenticated case's persister never touches real
// AsyncStorage (open handles keep the jest worker alive otherwise).
jest.mock("@/lib/query/async-kv", () => {
  const store = new Map<string, string>();
  return {
    asyncStorageKV: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => void store.set(k, v),
      removeItem: async (k: string) => void store.delete(k),
    },
  };
});

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  Stack: Object.assign(
    ({ children }: { children?: React.ReactNode }) => children ?? null,
    { Screen: () => null },
  ),
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => [] as string[],
}));

const mockUseSession = jest.fn();
jest.mock("@/lib/session/session", () => ({
  useSession: () => mockUseSession(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/** Renders only when a QueryClient is provided; throws exactly like TabsLayout otherwise. */
function QueryProbe() {
  const { status } = useQuery({
    queryKey: ["probe"],
    queryFn: async () => 1,
    enabled: false,
  });
  return <Text>probe:{status}</Text>;
}

describe("Gate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("provides a QueryClient before authentication (cold-start tabs frame must not crash)", () => {
    mockUseSession.mockReturnValue({ status: "unauthenticated", staff: null });
    render(
      <Gate>
        <QueryProbe />
      </Gate>,
    );
    expect(screen.getByText(/probe:/)).toBeTruthy();
  });

  it("renders nothing while the session is still loading", () => {
    mockUseSession.mockReturnValue({ status: "loading", staff: null });
    render(
      <Gate>
        <QueryProbe />
      </Gate>,
    );
    expect(screen.queryByText(/probe:/)).toBeNull();
  });

  it("provides a QueryClient when authenticated", () => {
    mockUseSession.mockReturnValue({
      status: "authenticated",
      staff: { id: "s1", full_name: "Tester", role: "admin" },
    });
    render(
      <Gate>
        <QueryProbe />
      </Gate>,
    );
    expect(screen.getByText(/probe:/)).toBeTruthy();
  });
});
