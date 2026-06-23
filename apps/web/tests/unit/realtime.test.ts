import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture every .on() registration so we can assert which tables are subscribed
// and drive their handlers directly.
type Registration = { config: { table?: string; filter?: string; event?: string }; handler: (payload: unknown) => void };
const registrations: Registration[] = [];

const channelObj: {
  on: (type: string, config: Registration["config"], handler: Registration["handler"]) => typeof channelObj;
  subscribe: () => typeof channelObj;
} = {
  on(_type, config, handler) {
    registrations.push({ config, handler });
    return channelObj;
  },
  subscribe() {
    return channelObj;
  },
};

const supabaseMock = {
  channel: vi.fn(() => channelObj),
  removeChannel: vi.fn(),
};

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => supabaseMock,
}));

import { subscribeToProjectChanges } from "@/lib/cards/realtime";

beforeEach(() => {
  registrations.length = 0;
  supabaseMock.channel.mockClear();
  supabaseMock.removeChannel.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subscribeToProjectChanges", () => {
  it("subscribes to topics (board columns) scoped to the project", () => {
    subscribeToProjectChanges("p1", () => {});
    const topics = registrations.find((r) => r.config.table === "topics");
    expect(topics).toBeDefined();
    expect(topics!.config.event).toBe("*");
    expect(topics!.config.filter).toBe("project_id=eq.p1");
  });

  it("subscribes to all four board-level tables", () => {
    subscribeToProjectChanges("p1", () => {});
    expect(registrations.map((r) => r.config.table).sort()).toEqual(
      ["card_comments", "card_events", "cards", "topics"],
    );
  });

  it("emits a topic change (debounced) when the topics listener fires", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    subscribeToProjectChanges("p1", onChange);
    registrations.find((r) => r.config.table === "topics")!.handler({});
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith({ kind: "topic" });
  });

  it("unsubscribes by removing the channel", () => {
    const unsubscribe = subscribeToProjectChanges("p1", () => {});
    unsubscribe();
    expect(supabaseMock.removeChannel).toHaveBeenCalledWith(channelObj);
  });
});
