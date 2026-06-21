/**
 * Tests for mobile optimistic mutation hooks.
 *
 * Strategy: seed a QueryClient with a fixture Board, call each hook's mutate(),
 * wait for settle, then assert cache state. No network — @datum/core mutation
 * fns are mocked. All QueryClient side-effects are inspected directly on the
 * client rather than through hook result fields to avoid act() timing issues.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react-native";
import { keys } from "@datum/core";
import type { Board, BoardCardView } from "@datum/core";
import { useAddCard, useMoveCard, useAddColumn } from "./mutations";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const FIXED_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => FIXED_UUID),
}));

jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));
jest.mock("@/lib/env", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
}));

const mockCreateCard = jest.fn();
const mockMoveCard = jest.fn();
const mockCreateTopic = jest.fn();

jest.mock("@datum/core", () => {
  const actual = jest.requireActual("@datum/core");
  return {
    ...actual,
    createCard: (...args: unknown[]) => mockCreateCard(...args),
    moveCard: (...args: unknown[]) => mockMoveCard(...args),
    createTopic: (...args: unknown[]) => mockCreateTopic(...args),
  };
});

// ─── Fixture ──────────────────────────────────────────────────────────────────

const TOPIC_A_ID = "topic-a-id";
const TOPIC_B_ID = "topic-b-id";
const CARD_1_ID = "card-1-id";
const PROJECT_ID = "project-uuid";
const CODE = "P1";

const makeFixtureBoard = (): Board => ({
  project: {
    id: PROJECT_ID,
    project_code: CODE,
    project_name: "Test Project",
    client_name: null,
    location: null,
    status: "active",
    target_handover: null,
    development_id: null,
    cover_image_path: null,
  } as unknown as Board["project"],
  columns: [
    {
      topic: {
        id: TOPIC_A_ID,
        project_id: PROJECT_ID,
        code: "COL-A",
        name: "Column A",
        topic_type: "general",
        sort_order: 0,
        created_by_staff_id: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      } as Board["columns"][0]["topic"],
      cards: [
        {
          id: CARD_1_ID,
          project_id: PROJECT_ID,
          topic_id: TOPIC_A_ID,
          title: "Existing card",
          slug: "existing-card",
          status: "active",
          current_summary: null,
          properties: null,
          created_by_staff_id: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          last_event_at: null,
          labels: [],
          deadline: null,
        } as unknown as Board["columns"][0]["cards"][0],
      ],
    },
    {
      topic: {
        id: TOPIC_B_ID,
        project_id: PROJECT_ID,
        code: "COL-B",
        name: "Column B",
        topic_type: "general",
        sort_order: 1,
        created_by_staff_id: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      } as Board["columns"][0]["topic"],
      cards: [],
    },
  ],
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient(board: Board): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(keys.board(CODE), board);
  return client;
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** Flush all timers + pending promises so React Query's batchedUpdates settle. */
async function flushAll() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

// ─── useAddCard ───────────────────────────────────────────────────────────────

describe("useAddCard", () => {
  beforeEach(() => jest.clearAllMocks());

  it("applies optimistic card to the correct column before server responds", async () => {
    // Hold the server response so we can inspect the optimistic state
    let resolveCreate!: (v: { ok: true; id: string; slug: string }) => void;
    mockCreateCard.mockReturnValue(
      new Promise<{ ok: true; id: string; slug: string }>((res) => { resolveCreate = res; }),
    );

    const board = makeFixtureBoard();
    const client = makeClient(board);

    const { result } = renderHook(() => useAddCard(CODE), {
      wrapper: wrapper(client),
    });

    // Fire mutate — onMutate runs synchronously before the async mutationFn
    act(() => {
      result.current.mutate({ projectId: PROJECT_ID, topicId: TOPIC_A_ID, title: "New card" });
    });

    // onMutate is async (awaits cancelQueries), so flush microtasks
    await flushAll();

    // Inspect optimistic cache — ghost card must be present in column A
    const optimistic = client.getQueryData<Board>(keys.board(CODE));
    const colA = optimistic?.columns.find((c) => c.topic.id === TOPIC_A_ID);
    const ghost = colA?.cards.find((c) => c.id.startsWith("optimistic:")) as BoardCardView | undefined;

    expect(ghost).toBeDefined();
    expect(ghost?.id).toBe(`optimistic:${TOPIC_A_ID}:${FIXED_UUID}`);
    expect(ghost?.title).toBe("New card");
    expect(ghost?.__optimistic).toBe(true);

    // Resolve server so mutation settles cleanly
    resolveCreate({ ok: true, id: "server-id", slug: "new-card" });
    await flushAll();
  });

  it("rolls back optimistic card when server returns error", async () => {
    mockCreateCard.mockResolvedValue({ ok: false, error: "server-error" });

    const board = makeFixtureBoard();
    const client = makeClient(board);
    const originalCount = board.columns[0]!.cards.length;

    const { result } = renderHook(() => useAddCard(CODE), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ projectId: PROJECT_ID, topicId: TOPIC_A_ID, title: "Ghost card" });
    });

    // Wait for onMutate, mutationFn, onError, onSettled all to complete
    await flushAll();
    await flushAll();

    const afterSettle = client.getQueryData<Board>(keys.board(CODE));
    const colA = afterSettle?.columns.find((c) => c.topic.id === TOPIC_A_ID);
    const ghosts = colA?.cards.filter((c) => c.id.startsWith("optimistic:")) ?? [];

    // Rolled back — no ghost remains, count is original
    expect(ghosts).toHaveLength(0);
    expect(colA?.cards).toHaveLength(originalCount);
  });
});

// ─── useMoveCard ──────────────────────────────────────────────────────────────

describe("useMoveCard", () => {
  beforeEach(() => jest.clearAllMocks());

  it("optimistically moves card to target column", async () => {
    let resolveMove!: (v: { ok: true }) => void;
    mockMoveCard.mockReturnValue(
      new Promise<{ ok: true }>((res) => { resolveMove = res; }),
    );

    const board = makeFixtureBoard();
    const client = makeClient(board);

    const { result } = renderHook(() => useMoveCard(CODE), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ cardId: CARD_1_ID, newTopicId: TOPIC_B_ID, projectId: PROJECT_ID });
    });

    await flushAll();

    const optimistic = client.getQueryData<Board>(keys.board(CODE));
    const colA = optimistic?.columns.find((c) => c.topic.id === TOPIC_A_ID);
    const colB = optimistic?.columns.find((c) => c.topic.id === TOPIC_B_ID);

    // Card removed from source column
    expect(colA?.cards.find((c) => c.id === CARD_1_ID)).toBeUndefined();
    // Card present in target column
    expect(colB?.cards.find((c) => c.id === CARD_1_ID)).toBeDefined();

    resolveMove({ ok: true });
    await flushAll();
  });

  it("rolls back move when server returns error", async () => {
    mockMoveCard.mockResolvedValue({ ok: false, error: "move-failed" });

    const board = makeFixtureBoard();
    const client = makeClient(board);

    const { result } = renderHook(() => useMoveCard(CODE), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ cardId: CARD_1_ID, newTopicId: TOPIC_B_ID, projectId: PROJECT_ID });
    });

    await flushAll();
    await flushAll();

    const afterSettle = client.getQueryData<Board>(keys.board(CODE));
    const colA = afterSettle?.columns.find((c) => c.topic.id === TOPIC_A_ID);
    const colB = afterSettle?.columns.find((c) => c.topic.id === TOPIC_B_ID);

    // Rolled back — card back in column A
    expect(colA?.cards.find((c) => c.id === CARD_1_ID)).toBeDefined();
    expect(colB?.cards.find((c) => c.id === CARD_1_ID)).toBeUndefined();
  });
});

// ─── useAddColumn ─────────────────────────────────────────────────────────────

describe("useAddColumn", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls createTopic with correct args and invalidates board on success", async () => {
    mockCreateTopic.mockResolvedValue({ ok: true, topicId: "new-topic-id" });

    const board = makeFixtureBoard();
    const client = makeClient(board);
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useAddColumn(CODE), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ projectId: PROJECT_ID, name: "New Column" });
    });

    await flushAll();
    await flushAll();

    expect(mockCreateTopic).toHaveBeenCalledWith(
      expect.anything(), // supabase client (mocked, value doesn't matter)
      { projectId: PROJECT_ID, name: "New Column" },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.board(CODE) });
  });

  it("still invalidates board even when server returns error", async () => {
    mockCreateTopic.mockResolvedValue({ ok: false, error: "topic-error" });

    const board = makeFixtureBoard();
    const client = makeClient(board);
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useAddColumn(CODE), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.mutate({ projectId: PROJECT_ID, name: "Bad Column" });
    });

    await flushAll();
    await flushAll();

    // onSettled always runs — board should still be invalidated
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: keys.board(CODE) });
    // mutation should report error
    expect(result.current.isError).toBe(true);
    expect((result.current.error as Error).message).toBe("topic-error");
  });
});
