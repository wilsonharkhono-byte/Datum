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
  mockBuildPortfolioContextBlock,
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
    mockBuildPortfolioContextBlock: vi.fn(),
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
  buildPortfolioContextBlock: mockBuildPortfolioContextBlock,
  jakartaToday: () => "2026-07-02",
}));

vi.mock("@/lib/assistant/anthropic", () => ({
  streamAssistant: mockStreamAssistant,
  extractCitations: vi.fn().mockReturnValue([]),
  AnthropicNotConfiguredError: class AnthropicNotConfiguredError extends Error {},
  // Real-ish behavior (not a fixed constant) so tests can control the final
  // answer text via the fake stream's content blocks, same shape as the real
  // textOf in anthropic.ts.
  textOf: vi.fn((content: { type: string; text?: string }[]) =>
    content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
  ),
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
    mockBuildPortfolioContextBlock.mockResolvedValue("PORTOFOLIO PALSU");
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

describe("POST /api/assistant/message — action tail (Task 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabaseClient.__staffMaybeSingle.mockResolvedValue({ data: { id: "staff-1" }, error: null });
    mockRetrieveProjectContext.mockResolvedValue([]);
    mockBuildContextBlock.mockReturnValue("KONTEKS PALSU");
    mockBuildPortfolioContextBlock.mockResolvedValue("PORTOFOLIO PALSU");
    mockFetchRecentMessages.mockResolvedValue([]);
    mockEnsureSession.mockResolvedValue(SESSION_ID);
    mockRecordExchange.mockResolvedValue(undefined);
  });

  function fakeStreamWithText(text: string) {
    return {
      on: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({
        content: [{ type: "text", text }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      abort: vi.fn(),
    };
  }

  it("parses a valid action tail and includes it in the done trailer", async () => {
    const raw = `Baik.\n<action>{"type":"remind","message":"Cek flood test"}</action>`;
    mockStreamAssistant.mockReturnValue(fakeStreamWithText(raw));

    const req = makeRequest({ projectId: PROJECT_ID, question: "Ingatkan mandor", sessionId: SESSION_ID });
    const res = await POST(req);
    const events = await drainNdjson(res);

    const done = events.find((e) => e.type === "done");
    expect(done!.action).toEqual({ type: "remind", message: "Cek flood test" });
  });

  it("strips the action tail from the text handed to recordExchange (never persists the raw tag)", async () => {
    const raw = `Baik, akan saya bantu.\n<action>{"type":"remind","message":"Cek flood test"}</action>`;
    mockStreamAssistant.mockReturnValue(fakeStreamWithText(raw));

    const req = makeRequest({ projectId: PROJECT_ID, question: "Ingatkan mandor", sessionId: SESSION_ID });
    const res = await POST(req);
    await drainNdjson(res);

    expect(mockRecordExchange).toHaveBeenCalledWith(
      mockSupabaseClient,
      expect.objectContaining({ answer: "Baik, akan saya bantu." }),
    );
  });

  it("done.action is null when there is no action tail", async () => {
    mockStreamAssistant.mockReturnValue(fakeStreamWithText("Jawaban biasa tanpa aksi."));

    const req = makeRequest({ projectId: PROJECT_ID, question: "Halo", sessionId: SESSION_ID });
    const res = await POST(req);
    const events = await drainNdjson(res);

    const done = events.find((e) => e.type === "done");
    expect(done!.action).toBeNull();
  });

  it("done.action is null and the malformed tag is stripped when the tail is invalid", async () => {
    const raw = `Jawaban.\n<action>{"type":"remind"}</action>`; // missing required message
    mockStreamAssistant.mockReturnValue(fakeStreamWithText(raw));

    const req = makeRequest({ projectId: PROJECT_ID, question: "Halo", sessionId: SESSION_ID });
    const res = await POST(req);
    const events = await drainNdjson(res);

    const done = events.find((e) => e.type === "done");
    expect(done!.action).toBeNull();
    expect(mockRecordExchange).toHaveBeenCalledWith(
      mockSupabaseClient,
      expect.objectContaining({ answer: "Jawaban." }),
    );
  });
});

// ─── Portfolio mode (Phase 3 Task 5): projectId optional ─────────────────────

describe("POST /api/assistant/message — portfolio mode (no projectId)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabaseClient.__staffMaybeSingle.mockResolvedValue({ data: { id: "staff-1" }, error: null });
    mockRetrieveProjectContext.mockResolvedValue([]);
    mockBuildContextBlock.mockReturnValue("KONTEKS PALSU");
    mockBuildPortfolioContextBlock.mockResolvedValue("PORTOFOLIO PALSU");
    mockFetchRecentMessages.mockResolvedValue([]);
    mockStreamAssistant.mockReturnValue(fakeStream());
    mockEnsureSession.mockResolvedValue(SESSION_ID);
    mockRecordExchange.mockResolvedValue(undefined);
  });

  it("accepts a request with no projectId at all (still 2xx, no validation error)", async () => {
    const req = makeRequest({ question: "Proyek mana paling berisiko?" });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("routes to buildPortfolioContextBlock (not retrieveProjectContext/buildContextBlock) when projectId is absent", async () => {
    const req = makeRequest({ question: "Apa 3 hal terpenting hari ini?" });
    const res = await POST(req);
    await drainNdjson(res);

    expect(mockBuildPortfolioContextBlock).toHaveBeenCalledWith(mockSupabaseClient, "2026-07-02", expect.any(String));
    expect(mockRetrieveProjectContext).not.toHaveBeenCalled();
    expect(mockBuildContextBlock).not.toHaveBeenCalled();
    expect(mockStreamAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ contextBlock: "PORTOFOLIO PALSU" }),
    );
  });

  it("still routes to the single-project branch when projectId IS given (no regression)", async () => {
    const req = makeRequest({ projectId: PROJECT_ID, question: "Halo" });
    const res = await POST(req);
    await drainNdjson(res);

    expect(mockRetrieveProjectContext).toHaveBeenCalledWith(mockSupabaseClient, PROJECT_ID, "Halo");
    expect(mockBuildPortfolioContextBlock).not.toHaveBeenCalled();
  });

  it("passes projectId: null through to ensureSession/recordExchange in portfolio mode", async () => {
    const req = makeRequest({ question: "Halo portofolio" });
    const res = await POST(req);
    await drainNdjson(res);

    expect(mockEnsureSession).toHaveBeenCalledWith(
      mockSupabaseClient,
      expect.objectContaining({ projectId: null }),
    );
    expect(mockRecordExchange).toHaveBeenCalledWith(
      mockSupabaseClient,
      expect.objectContaining({ projectId: null }),
    );
  });

  it("rejects an invalid projectId (present but malformed) even though projectId itself is optional", async () => {
    const req = makeRequest({ projectId: "not-a-uuid", question: "Halo" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("strips a portfolio-mode action tail server-side — done.action is always null even when the model proposes one", async () => {
    const raw = `Baik.\n<action>{"type":"remind","message":"Cek flood test"}</action>`;
    mockStreamAssistant.mockReturnValue({
      on: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: raw }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      abort: vi.fn(),
    });

    const req = makeRequest({ question: "Ingatkan semua mandor" });
    const res = await POST(req);
    const events = await drainNdjson(res);

    const done = events.find((e) => e.type === "done");
    expect(done!.action).toBeNull();
    // The raw tag is still stripped from the persisted/displayed text even
    // though the action itself is discarded.
    expect(mockRecordExchange).toHaveBeenCalledWith(
      mockSupabaseClient,
      expect.objectContaining({ answer: "Baik." }),
    );
  });
});
