import React from "react";
import { render, waitFor, fireEvent, screen, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SearchScreen from "./search";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @datum/core searchAll
const mockSearchAll = jest.fn();
jest.mock("@datum/core", () => ({
  searchAll: (...args: any[]) => mockSearchAll(...args),
}));

// Supabase client (not called directly when searchAll is mocked, but required by module graph)
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

// Env
jest.mock("@/lib/env", () => ({ SUPABASE_URL: "https://test.co", SUPABASE_ANON_KEY: "anon" }));

// expo-router
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// react-native-safe-area-context
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// @tanstack/react-query — keep real impl but stub onlineManager for OfflineBanner
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  onlineManager: { isOnline: () => true, subscribe: () => () => {} },
}));

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

import type { SearchHit, SearchResults } from "@datum/core";

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    id: "hit-1",
    kind: "card",
    projectCode: "ARIN-1",
    cardSlug: "arin-1-bathroom",
    cardTitle: "Bathroom Renovation",
    snippet: "…bathroom tile layout…",
    href: "/project/ARIN-1/cards/arin-1-bathroom",
    occurredAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

const EMPTY_RESULTS: SearchResults = {
  developments: [],
  projects: [],
  cards: [],
  events: [],
  comments: [],
  attachments: [],
};

function makeResults(overrides: Partial<SearchResults> = {}): SearchResults {
  return { ...EMPTY_RESULTS, ...overrides };
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

describe("SearchScreen", () => {
  beforeEach(() => {
    mockSearchAll.mockReset();
    mockPush.mockReset();
    jest.useFakeTimers();
  });

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  // --- Idle state ---
  it("shows idle hint when query is too short (< 2 chars)", () => {
    wrap(<SearchScreen />);
    expect(
      screen.getByText(
        "Ketik di kotak di atas untuk mencari kartu, aktivitas, atau komentar.",
      ),
    ).toBeTruthy();
    expect(mockSearchAll).not.toHaveBeenCalled();
  });

  it("does not call searchAll with a 1-char query after debounce fires", async () => {
    wrap(<SearchScreen />);
    fireEvent.changeText(screen.getByTestId("search-input"), "a");
    act(() => { jest.advanceTimersByTime(400); });
    expect(mockSearchAll).not.toHaveBeenCalled();
  });

  // --- Debounce: query fires searchAll ---
  it("calls searchAll after debounce when query is >= 2 chars", async () => {
    mockSearchAll.mockResolvedValue(makeResults());
    wrap(<SearchScreen />);

    fireEvent.changeText(screen.getByTestId("search-input"), "bathroom");
    // Before debounce resolves, searchAll not called
    expect(mockSearchAll).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(mockSearchAll).toHaveBeenCalledTimes(1);
      expect(mockSearchAll).toHaveBeenCalledWith({}, "bathroom");
    });
  });

  // --- Grouped results render ---
  it("renders grouped results with section headers", async () => {
    mockSearchAll.mockResolvedValue(
      makeResults({
        cards: [
          makeHit({ id: "c1", kind: "card", cardTitle: "Bathroom Renovation", projectCode: "ARIN-1" }),
          makeHit({ id: "c2", kind: "card", cardTitle: "Kitchen Remodel", projectCode: "ARIN-2", cardSlug: "arin-2-kitchen" }),
        ],
        projects: [
          makeHit({ id: "p1", kind: "project", cardTitle: "ARIN-1 · Karawang Unit 1", projectCode: "ARIN-1", cardSlug: "" }),
        ],
      }),
    );

    wrap(<SearchScreen />);
    fireEvent.changeText(screen.getByTestId("search-input"), "renovation");
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      // Section headers
      expect(screen.getByText(/Proyek \(1\)/)).toBeTruthy();
      expect(screen.getByText(/Kartu \(2\)/)).toBeTruthy();
      // Hit titles
      expect(screen.getByText("ARIN-1 · Karawang Unit 1")).toBeTruthy();
      expect(screen.getByText("Bathroom Renovation")).toBeTruthy();
      expect(screen.getByText("Kitchen Remodel")).toBeTruthy();
    });
  });

  // --- Empty results state ---
  it("shows empty-results message when searchAll returns no hits", async () => {
    mockSearchAll.mockResolvedValue(makeResults());

    wrap(<SearchScreen />);
    fireEvent.changeText(screen.getByTestId("search-input"), "zzz-nomatch");
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(
        screen.getByText(`Tidak ada hasil untuk "zzz-nomatch".`),
      ).toBeTruthy();
    });
  });

  // --- Navigation: project hit ---
  it("navigates to project route when a project hit row is pressed", async () => {
    mockSearchAll.mockResolvedValue(
      makeResults({
        projects: [
          makeHit({ id: "p1", kind: "project", cardTitle: "ARIN-1 · Karawang", projectCode: "ARIN-1", cardSlug: "" }),
        ],
      }),
    );

    wrap(<SearchScreen />);
    fireEvent.changeText(screen.getByTestId("search-input"), "karawang");
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => expect(screen.getByTestId("hit-row-p1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("hit-row-p1"));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/(matrix)/project/ARIN-1");
  });

  // --- Navigation: card hit ---
  it("navigates to card route when a card hit row is pressed", async () => {
    mockSearchAll.mockResolvedValue(
      makeResults({
        cards: [
          makeHit({ id: "c1", kind: "card", projectCode: "ARIN-1", cardSlug: "arin-1-bathroom", cardTitle: "Bathroom" }),
        ],
      }),
    );

    wrap(<SearchScreen />);
    fireEvent.changeText(screen.getByTestId("search-input"), "bathroom");
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => expect(screen.getByTestId("hit-row-c1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("hit-row-c1"));
    expect(mockPush).toHaveBeenCalledWith(
      "/(tabs)/(matrix)/project/ARIN-1/card/arin-1-bathroom",
    );
  });

  // --- Navigation: comment hit routes to owning card ---
  it("navigates to owning card route for a comment hit", async () => {
    mockSearchAll.mockResolvedValue(
      makeResults({
        comments: [
          makeHit({ id: "co1", kind: "comment", projectCode: "BETA-1", cardSlug: "beta-1-foundation", cardTitle: "Foundation" }),
        ],
      }),
    );

    wrap(<SearchScreen />);
    fireEvent.changeText(screen.getByTestId("search-input"), "foundation");
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => expect(screen.getByTestId("hit-row-co1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("hit-row-co1"));
    expect(mockPush).toHaveBeenCalledWith(
      "/(tabs)/(matrix)/project/BETA-1/card/beta-1-foundation",
    );
  });

  // --- Error state ---
  it("shows error state when searchAll rejects", async () => {
    mockSearchAll.mockRejectedValue(new Error("Koneksi gagal"));

    wrap(<SearchScreen />);
    fireEvent.changeText(screen.getByTestId("search-input"), "error test");
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(screen.getByText(/Gagal memuat hasil: Koneksi gagal/)).toBeTruthy();
    });
    expect(screen.getByText("Coba lagi")).toBeTruthy();
  });

  // --- Result count display ---
  it("displays total result count", async () => {
    mockSearchAll.mockResolvedValue(
      makeResults({
        cards: [makeHit({ id: "c1" }), makeHit({ id: "c2" })],
        projects: [makeHit({ id: "p1", kind: "project", cardSlug: "" })],
      }),
    );

    wrap(<SearchScreen />);
    fireEvent.changeText(screen.getByTestId("search-input"), "test query");
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(screen.getByText("3 hasil ditemukan")).toBeTruthy();
    });
  });

  // --- Development section renders ---
  it("renders a Pengembangan section when developments are returned", async () => {
    mockSearchAll.mockResolvedValue(
      makeResults({
        developments: [
          makeHit({ id: "d1", kind: "development", cardTitle: "Alpha Estate", projectCode: "", cardSlug: "", snippet: "West Java" }),
        ],
      }),
    );

    wrap(<SearchScreen />);
    fireEvent.changeText(screen.getByTestId("search-input"), "alpha");
    act(() => { jest.advanceTimersByTime(300); });

    await waitFor(() => {
      expect(screen.getByText(/Pengembangan \(1\)/)).toBeTruthy();
      expect(screen.getByText("Alpha Estate")).toBeTruthy();
    });
  });
});
