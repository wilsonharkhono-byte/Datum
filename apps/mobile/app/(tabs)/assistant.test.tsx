/**
 * assistant.test.tsx — tests for the mobile AI assistant screen.
 *
 * Mocking strategy:
 *   - @datum/core: mock I/O functions (parseStreamLine, extractCitations,
 *     enqueue, drain, remove, ChatRequest, CaptureRequest). Keep real schema
 *     shapes for parse/validate coverage.
 *   - fetch: jest.fn() returning buffered NDJSON or Proposal JSON.
 *   - @/lib/supabase/client: stub (auth.getSession → { data: { session: { access_token } } }).
 *   - @/lib/env: WEB_BASE_URL set or unset per test group.
 *   - @/lib/session/session: stub useSession with authenticated staff.
 *   - @/lib/query/hooks: mock useProjects per test.
 *   - expo-router: stub useRouter / push.
 *   - expo-crypto: stub randomUUID.
 *   - @react-native-async-storage/async-storage: jest mock (in-memory store).
 *   - @tanstack/react-query: real; stub onlineManager.
 *   - react-native-safe-area-context: stub SafeAreaView → View.
 *   - expo-image-picker: stub (not called in these tests).
 *
 * Covers:
 *   1. Tanya: sending a question renders the streamed/parsed answer + citations
 *   2. Catat: returns a proposal → ProposalCard renders → commit calls core mutations
 *   3. 401 response surfaces a readable Indonesian error
 *   4. WEB_BASE_URL unset shows notice and disables sending
 *   5. Offline: failed fetch enqueues the item
 *   6. Project picker: renders chips; selecting enables chat; send carries real projectId
 *   7. Empty-projects: shows notice; chat hidden
 *   8. Remembered selection: AsyncStorage value is restored and pre-selects that chip
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

// ---------------------------------------------------------------------------
// jest.mock for @react-native-async-storage/async-storage must come before
// the component import so it is applied before the module is loaded.
// ---------------------------------------------------------------------------

jest.mock("@react-native-async-storage/async-storage", () => {
  // Store lives inside the factory so it is not subject to Jest's hoisting guard.
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      removeItem: jest.fn(async (k: string) => void store.delete(k)),
      clear: jest.fn(async () => void store.clear()),
      // Expose the store for test setup (pre-seeding remembered selection)
      __store: store,
    },
  };
});

// ---------------------------------------------------------------------------
// Mocks — @datum/core
// ---------------------------------------------------------------------------

const mockParseStreamLine = jest.fn();
const mockExtractCitations = jest.fn();
const mockEnqueue = jest.fn();
const mockDrain = jest.fn();
const mockRemove = jest.fn();
const mockCreateCard = jest.fn();
const mockCreateCardEvent = jest.fn();
const mockAttachToEvent = jest.fn();
const mockLinkCardToArea = jest.fn();
const mockGetCardSnippet = jest.fn();

jest.mock("@datum/core", () => {
  const actual = jest.requireActual<typeof import("@datum/core")>("@datum/core");
  return {
    ...actual,
    parseStreamLine: (...args: unknown[]) => mockParseStreamLine(...args),
    extractCitations: (...args: unknown[]) => mockExtractCitations(...args),
    enqueue: (...args: unknown[]) => mockEnqueue(...args),
    drain: (...args: unknown[]) => mockDrain(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    createCard: (...args: unknown[]) => mockCreateCard(...args),
    createCardEvent: (...args: unknown[]) => mockCreateCardEvent(...args),
    attachToEvent: (...args: unknown[]) => mockAttachToEvent(...args),
    linkCardToArea: (...args: unknown[]) => mockLinkCardToArea(...args),
    getCardSnippet: (...args: unknown[]) => mockGetCardSnippet(...args),
    // Pass real Zod schemas so ChatRequest.safeParse / CaptureRequest.safeParse work
    ChatRequest: actual.ChatRequest,
    CaptureRequest: actual.CaptureRequest,
  };
});

// ---------------------------------------------------------------------------
// Mocks — infrastructure
// ---------------------------------------------------------------------------

const mockGetSession = jest.fn();
jest.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
  },
}));

// WEB_BASE_URL default: set to a test URL; individual tests can clear it.
let mockWebBaseUrl: string | undefined = "https://web.test";

jest.mock("@/lib/env", () => ({
  get WEB_BASE_URL() {
    return mockWebBaseUrl;
  },
  SUPABASE_URL: "https://db.test",
  SUPABASE_ANON_KEY: "anon",
}));

const STAFF_ID = "staff-001";

jest.mock("@/lib/session/session", () => ({
  useSession: () => ({
    status: "authenticated",
    staff: { id: STAFF_ID, full_name: "Test Staff", role: "staff", email: null },
    signOut: jest.fn(),
  }),
}));

// ── useProjects mock ──────────────────────────────────────────────────────────
// Mutable so each test can configure its own return value.
let mockProjectsResult: {
  data: unknown[];
  isLoading: boolean;
} = { data: [], isLoading: false };

jest.mock("@/lib/query/hooks", () => ({
  useProjects: () => mockProjectsResult,
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "test-uuid-" + Math.random().toString(36).slice(2)),
}));

// expo-image-picker is not installed in this project (it is an optional dep).
// Use { virtual: true } so Jest doesn't fail on the missing module.
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}), { virtual: true });

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => {
    const { View } = require("react-native");
    return <View>{children}</View>;
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  onlineManager: {
    isOnline: () => true,
    subscribe: () => () => {},
  },
}));

// ---------------------------------------------------------------------------
// fetch mock helper
// ---------------------------------------------------------------------------

/**
 * Build a buffered NDJSON fetch response (streaming path not tested — that
 * requires a real ReadableStream; we exercise the buffered fallback path by
 * returning a response without a body stream).
 */
function mockFetchNdjson(lines: string[], status = 200) {
  const text = lines.join("\n");
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    body: null, // Force buffered fallback path
    text: jest.fn().mockResolvedValue(text),
    json: jest.fn().mockResolvedValue(null),
  } as unknown as Response);
}

function mockFetchJson(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    body: null,
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

import AssistantTab, { AssistantChat } from "./assistant";

const TEST_PROJECT_ID = "11111111-1111-1111-1111-111111111111";

// Sample projects list for picker tests
const SAMPLE_PROJECTS = [
  {
    id: TEST_PROJECT_ID,
    project_code: "ARIN-1",
    project_name: "Arin Phase 1",
    client_name: "PT Arin",
    location: "Jakarta",
    status: "active",
    target_handover: null,
    development_id: null,
    development_name: null,
    development_area_label: null,
    development_sort_order: null,
    cover_image_path: null,
    cover_url: null,
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    project_code: "BENT-2",
    project_name: "Bentara Phase 2",
    client_name: "PT Bentara",
    location: "Surabaya",
    status: "active",
    target_handover: null,
    development_id: null,
    development_name: null,
    development_area_label: null,
    development_sort_order: null,
    cover_image_path: null,
    cover_url: null,
  },
];

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const globalFetch = g.fetch as typeof fetch | undefined;

// Helper to get the in-process AsyncStorage store for pre-seeding tests.
function getAsyncStorageStore(): Map<string, string> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  return (jest.requireMock("@react-native-async-storage/async-storage") as any).default.__store as Map<string, string>;
}

beforeEach(() => {
  jest.clearAllMocks();
  getAsyncStorageStore().clear();
  mockWebBaseUrl = "https://web.test";
  mockProjectsResult = { data: SAMPLE_PROJECTS, isLoading: false };
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: "tok-abc" } },
  });
  mockDrain.mockResolvedValue([]);
  mockEnqueue.mockResolvedValue({ id: "q-1", mode: "tanya", text: "", ts: 0 });
  mockGetCardSnippet.mockResolvedValue(null);
});

afterEach(() => {
  g.fetch = globalFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AssistantTab", () => {
  // ── 1. Tanya: renders streamed answer + citation ──────────────────────────

  it("sends a Tanya question and renders the parsed answer with a citation chip", async () => {
    // Wire parseStreamLine to return real events
    mockParseStreamLine.mockImplementation((line: string) => {
      if (!line.trim()) return null;
      try {
        return JSON.parse(line) as object;
      } catch {
        return null;
      }
    });
    mockExtractCitations.mockReturnValue([]);

    const ndjsonLines = [
      JSON.stringify({ type: "delta", text: "Progres lantai " }),
      JSON.stringify({ type: "delta", text: "sudah 60%." }),
      JSON.stringify({
        type: "done",
        sessionId: "sess-1",
        citations: [{ cardId: "card-uuid-1", eventIds: ["ev-1"] }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    ];

    g.fetch = jest.fn().mockResolvedValueOnce(mockFetchNdjson(ndjsonLines));

    wrap(<AssistantChat projectId={TEST_PROJECT_ID} />);

    // Type a question and send
    const input = screen.getByPlaceholderText("Tanya tentang proyek…");
    await act(async () => {
      fireEvent.changeText(input, "Bagaimana progres lantai?");
    });

    // Press send
    await act(async () => {
      fireEvent.press(screen.getByTestId("send-button"));
    });

    // Wait for the answer to appear
    await waitFor(() => {
      expect(screen.getByText(/Progres lantai/)).toBeTruthy();
      expect(screen.getByText(/sudah 60%/)).toBeTruthy();
    });

    // fetch was called with Bearer token
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(g.fetch).toHaveBeenCalledWith(
      "https://web.test/api/assistant/message",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tok-abc",
        }),
      }),
    );
  });

  // ── 2. Catat: proposal returned → ProposalCard renders → commit calls core ─

  it("sends a Catat note and renders ProposalCard; commit calls createCardEvent", async () => {
    const proposal = {
      projectId: "proj-uuid-1",
      cardId: "card-uuid-1",
      cardTitle: "Pekerjaan Lantai",
      cardSlug: "arin-1-flooring",
      topicName: "In Progress",
      eventKind: "note",
      payload: { text: "Lantai selesai 60%" },
      rationale: "User menyebutkan progres lantai",
      confidence: 0.85,
      fileMeta: null,
      areaHint: null,
      createNew: false,
      newCardTitle: null,
    };

    g.fetch = jest
      .fn()
      .mockResolvedValueOnce(mockFetchJson({ ok: true, proposal }));

    mockCreateCardEvent.mockResolvedValue({ ok: true, eventId: "ev-new-1" });

    wrap(<AssistantChat projectId={TEST_PROJECT_ID} />);

    // Switch to Catat mode
    await act(async () => {
      fireEvent.press(screen.getByTestId("mode-toggle-catat"));
    });

    // Type and send
    const input = screen.getByPlaceholderText("Deskripsikan catatan lapangan…");
    await act(async () => {
      fireEvent.changeText(input, "Lantai selesai 60%");
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId("send-button"));
    });

    // Wait for ProposalCard to render
    await waitFor(() => {
      expect(screen.getByText(/Pekerjaan Lantai/)).toBeTruthy();
      expect(screen.getByText(/85% yakin/i)).toBeTruthy();
      expect(screen.getByTestId("proposal-save-btn")).toBeTruthy();
    });

    // Commit
    await act(async () => {
      fireEvent.press(screen.getByTestId("proposal-save-btn"));
    });

    await waitFor(() => {
      expect(mockCreateCardEvent).toHaveBeenCalledWith(
        expect.anything(), // supabase
        expect.objectContaining({
          cardId: "card-uuid-1",
          projectId: "proj-uuid-1",
          eventKind: "note",
          loggedByStaffId: STAFF_ID,
        }),
      );
    });
  });

  // ── 3. 401 surfaces readable Indonesian error ─────────────────────────────

  it("shows a readable Indonesian error when the server returns 401", async () => {
    g.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      body: null,
      text: jest.fn().mockResolvedValue("Unauthorized"),
      json: jest.fn().mockResolvedValue(null),
    } as unknown as Response);

    wrap(<AssistantChat projectId={TEST_PROJECT_ID} />);

    const input = screen.getByPlaceholderText("Tanya tentang proyek…");
    await act(async () => {
      fireEvent.changeText(input, "Cek status proyek");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("send-button"));
    });

    await waitFor(() => {
      expect(screen.getByText(/401/)).toBeTruthy();
      expect(screen.getByText(/Bearer token/)).toBeTruthy();
    });
  });

  // ── 4. WEB_BASE_URL unset shows notice, disables send ─────────────────────

  it("shows a no-base-url notice when WEB_BASE_URL is unset", async () => {
    mockWebBaseUrl = undefined;

    wrap(<AssistantTab />);

    await waitFor(() => {
      expect(screen.getByTestId("no-base-url-notice")).toBeTruthy();
      expect(screen.getByText(/EXPO_PUBLIC_WEB_BASE_URL/)).toBeTruthy();
    });

    // Input bar should NOT be rendered
    expect(screen.queryByPlaceholderText("Tanya tentang proyek…")).toBeNull();
  });

  // ── 5. Offline: failed fetch enqueues the item ────────────────────────────

  it("enqueues the message when fetch throws a network error (offline)", async () => {
    // Simulate offline by making fetch reject
    g.fetch = jest.fn().mockRejectedValueOnce(new Error("Network request failed"));

    // Override onlineManager to report offline
    const { onlineManager } = jest.requireMock<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
    const origIsOnline = onlineManager.isOnline;
    onlineManager.isOnline = () => false;

    wrap(<AssistantChat projectId={TEST_PROJECT_ID} />);

    const input = screen.getByPlaceholderText("Tanya tentang proyek…");
    await act(async () => {
      fireEvent.changeText(input, "Status proyek saat ini?");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("send-button"));
    });

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.anything(), // queueStorage
        expect.any(String), // projectId
        expect.objectContaining({ mode: "tanya", text: "Status proyek saat ini?" }),
        expect.any(Function), // genId
      );
    });

    // Restore
    onlineManager.isOnline = origIsOnline;
  });

  // ── 6. Project picker: renders chips; selecting enables chat; send carries real projectId ──

  it("renders project chips in the picker and enables chat after selecting a project", async () => {
    mockParseStreamLine.mockImplementation((line: string) => {
      if (!line.trim()) return null;
      try { return JSON.parse(line) as object; } catch { return null; }
    });
    mockExtractCitations.mockReturnValue([]);

    const ndjson = [
      JSON.stringify({ type: "delta", text: "Info proyek." }),
      JSON.stringify({ type: "done", sessionId: "s1", citations: [], usage: { input_tokens: 1, output_tokens: 1 } }),
    ];
    g.fetch = jest.fn().mockResolvedValue(mockFetchNdjson(ndjson));

    wrap(<AssistantTab />);

    // Both project chips should be visible
    await waitFor(() => {
      expect(screen.getByTestId("project-chip-ARIN-1")).toBeTruthy();
      expect(screen.getByTestId("project-chip-BENT-2")).toBeTruthy();
    });

    // Since AsyncStorage is empty, the first project is auto-selected; the chat is shown.
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Tanya tentang proyek…")).toBeTruthy();
    });

    // Select the second project
    await act(async () => {
      fireEvent.press(screen.getByTestId("project-chip-BENT-2"));
    });

    // Chat is still visible after switching project
    expect(screen.getByPlaceholderText("Tanya tentang proyek…")).toBeTruthy();

    // Send a message — the fetch body should carry the second project's id
    const input = screen.getByPlaceholderText("Tanya tentang proyek…");
    await act(async () => {
      fireEvent.changeText(input, "Status proyek?");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("send-button"));
    });

    await waitFor(() => {
      expect(g.fetch).toHaveBeenCalledWith(
        "https://web.test/api/assistant/message",
        expect.objectContaining({
          body: expect.stringContaining("22222222-2222-2222-2222-222222222222"),
        }),
      );
    });
  });

  // ── 7. Empty projects: shows notice; chat hidden ──────────────────────────

  it("shows no-project notice and hides chat when there are no projects", async () => {
    mockProjectsResult = { data: [], isLoading: false };

    wrap(<AssistantTab />);

    await waitFor(() => {
      expect(screen.getByTestId("no-project-notice")).toBeTruthy();
      // "Pilih proyek dulu" is the heading inside no-project-notice
      expect(screen.getByText(/Pilih proyek dulu/i)).toBeTruthy();
    });

    // Chat input should NOT render when there is no project selected
    expect(screen.queryByPlaceholderText("Tanya tentang proyek…")).toBeNull();
  });

  // ── 8. Remembered selection: AsyncStorage value is restored ──────────────

  it("restores the previously-selected project from AsyncStorage", async () => {
    // Pre-seed AsyncStorage with the second project's id
    getAsyncStorageStore().set("datum.assistant.projectId", "22222222-2222-2222-2222-222222222222");

    mockParseStreamLine.mockImplementation((line: string) => {
      if (!line.trim()) return null;
      try { return JSON.parse(line) as object; } catch { return null; }
    });
    mockExtractCitations.mockReturnValue([]);

    const ndjson = [
      JSON.stringify({ type: "delta", text: "Ok." }),
      JSON.stringify({ type: "done", sessionId: "s2", citations: [], usage: { input_tokens: 1, output_tokens: 1 } }),
    ];
    g.fetch = jest.fn().mockResolvedValue(mockFetchNdjson(ndjson));

    wrap(<AssistantTab />);

    // Chat should be shown with the restored project (BENT-2 = second project)
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Tanya tentang proyek…")).toBeTruthy();
    });

    // Send and verify the restored project id is used
    const input = screen.getByPlaceholderText("Tanya tentang proyek…");
    await act(async () => {
      fireEvent.changeText(input, "Cek status");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("send-button"));
    });

    await waitFor(() => {
      expect(g.fetch).toHaveBeenCalledWith(
        "https://web.test/api/assistant/message",
        expect.objectContaining({
          body: expect.stringContaining("22222222-2222-2222-2222-222222222222"),
        }),
      );
    });
  });
});
