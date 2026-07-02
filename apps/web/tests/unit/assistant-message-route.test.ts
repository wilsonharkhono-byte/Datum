/**
 * assistant-message-route.test.ts
 *
 * Unit tests for POST /api/assistant/message — Task 2 wiring only: that
 * fetched session history is passed through to streamAssistant, and that
 * the newest turn (not history) carries the KONTEKS+question. Full
 * Anthropic-SDK streaming behavior is out of scope here (no existing
 * precedent in this repo mocks messages.stream()'s internals); we stub
 * streamAssistant itself and assert on how the route calls it, following
 * the hoisted-mock route-test convention in staff-create-route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCreateSupabaseClientForRequest,
  mockRetrieveProjectContext,
  mockBuildContextBlock,
  mockStreamAssistant,
  mockFetchRecentMessages,
  mockEnsureSession,
  mockRecordExchange,
  mockSupabaseClient,
} = vi.hoisted(() => {
  const staffMaybeSingle = vi.fn();
  const mockSupabaseClient = {
    auth: { getUser: vi.fn() },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: staffMaybeSingle }) }),
    })),
    __staffMaybeSingle: staffMaybeSingle,
  };
  return {
    mockCreateSupabaseClientForRequest: vi.fn().mockResolvedValue(mockSupabaseClient),
    mockRetrieveProjectContext: vi.fn(),
    mockBuildContextBlock: vi.fn(),
    mockStreamAssistant: vi.fn(),
    mockFetchRecentMessages: vi.fn(),
    mockEnsureSession: vi.fn(),
    mockRecordExchange: vi.fn(),
    mockSupabaseClient,
  };
});

vi.mock("@/lib/supabase/from-request", () => ({
  createSupabaseClientForRequest: mockCreateSupabaseClientForRequest,
}));

vi.mock("@/lib/assistant/retrieval", () => ({
  retrieveProjectContext: mockRetrieveProjectContext,
  buildContextBlock: mockBuildContextBlock,
}));

vi.mock("@/lib/assistant/anthropic", () => ({
  streamAssistant: mockStreamAssistant,
  extractCitations: vi.fn().mockReturnValue([]),
  AnthropicNotConfiguredError: class AnthropicNotConfiguredError extends Error {},
  textOf: vi.fn().mockReturnValue("Jawaban PM."),
}));

vi.mock("@/lib/assistant/audit", () => ({
  ensureSession: mockEnsureSession,
  recordExchange: mockRecordExchange,
  fetchRecentMessages: mockFetchRecentMessages,
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { POST } from "@/app/api/assistant/message/route";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const SESSION_ID = "22222222-2222-2222-2222-222222222222";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/assistant/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Minimal fake SDK MessageStream: emits no deltas, resolves finalMessage immediately. */
function fakeStream() {
  return {
    on: vi.fn(),
    finalMessage: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Jawaban PM." }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    abort: vi.fn(),
  };
}

async function drainNdjson(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("POST /api/assistant/message — history wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabaseClient.__staffMaybeSingle.mockResolvedValue({ data: { id: "staff-1" }, error: null });
    mockRetrieveProjectContext.mockResolvedValue([]);
    mockBuildContextBlock.mockReturnValue("KONTEKS PALSU");
    mockFetchRecentMessages.mockResolvedValue([]);
    mockStreamAssistant.mockReturnValue(fakeStream());
    mockEnsureSession.mockResolvedValue(SESSION_ID);
    mockRecordExchange.mockResolvedValue(undefined);
  });

  it("fetches history using the request's sessionId and passes it straight through to streamAssistant", async () => {
    const history = [
      { role: "user" as const, content: "Pertanyaan lama" },
      { role: "assistant" as const, content: "Jawaban lama" },
    ];
    mockFetchRecentMessages.mockResolvedValue(history);

    const req = makeRequest({ projectId: PROJECT_ID, question: "Bagaimana progresnya?", sessionId: SESSION_ID });
    const res = await POST(req);
    await drainNdjson(res);

    expect(mockFetchRecentMessages).toHaveBeenCalledWith(mockSupabaseClient, SESSION_ID);
    expect(mockStreamAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "Bagaimana progresnya?",
        contextBlock: "KONTEKS PALSU",
        history,
      }),
    );
  });

  it("passes an empty history array for a brand-new session (no sessionId in the request)", async () => {
    const req = makeRequest({ projectId: PROJECT_ID, question: "Halo" });
    const res = await POST(req);
    await drainNdjson(res);

    expect(mockFetchRecentMessages).toHaveBeenCalledWith(mockSupabaseClient, undefined);
    expect(mockStreamAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ history: [] }),
    );
  });

  it("streams the final answer and a done trailer carrying the session id", async () => {
    const req = makeRequest({ projectId: PROJECT_ID, question: "Halo", sessionId: SESSION_ID });
    const res = await POST(req);
    const events = await drainNdjson(res);

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done!.sessionId).toBe(SESSION_ID);
  });
});
