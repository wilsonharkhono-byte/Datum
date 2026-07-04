import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture every .on() registration so we can assert which tables are subscribed
// and drive their handlers directly. channel() returns a fresh object per call
// (subscribeResilient rebuilds the channel on recovery) and subscribe() captures
// its status callback so tests can simulate SUBSCRIBED/CHANNEL_ERROR/etc.
type Registration = { config: { table?: string; filter?: string; event?: string }; handler: (payload: unknown) => void };
type MockChannel = {
  on: (type: string, config: Registration["config"], handler: Registration["handler"]) => MockChannel;
  subscribe: (cb?: (status: string) => void) => MockChannel;
  statusCb: ((status: string) => void) | null;
};
const registrations: Registration[] = [];
const channels: MockChannel[] = [];

function makeChannel(): MockChannel {
  const ch: MockChannel = {
    statusCb: null,
    on(_type, config, handler) {
      registrations.push({ config, handler });
      return ch;
    },
    subscribe(cb) {
      ch.statusCb = cb ?? null;
      return ch;
    },
  };
  channels.push(ch);
  return ch;
}

const supabaseMock = {
  channel: vi.fn(() => makeChannel()),
  removeChannel: vi.fn(),
};

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => supabaseMock,
}));

import { subscribeToProjectChanges } from "@/lib/cards/realtime";

beforeEach(() => {
  registrations.length = 0;
  channels.length = 0;
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
    expect(supabaseMock.removeChannel).toHaveBeenCalledWith(channels[0]);
  });
});

describe("subscribeToProjectChanges — channel resilience", () => {
  it("rebuilds and resubscribes the channel after CHANNEL_ERROR", () => {
    vi.useFakeTimers();
    subscribeToProjectChanges("p1", () => {});
    expect(supabaseMock.channel).toHaveBeenCalledTimes(1);

    channels[0]!.statusCb!("CHANNEL_ERROR");
    // Retry is scheduled with backoff, not immediate.
    expect(supabaseMock.channel).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1100);

    expect(supabaseMock.removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(supabaseMock.channel).toHaveBeenCalledTimes(2);
    expect(channels[1]!.statusCb).not.toBeNull();
  });

  it("reports down then recovered via onHealth, and resets backoff", () => {
    vi.useFakeTimers();
    const onHealth = vi.fn();
    subscribeToProjectChanges("p1", () => {}, onHealth);

    channels[0]!.statusCb!("TIMED_OUT");
    expect(onHealth).toHaveBeenCalledWith("down");
    expect(onHealth).not.toHaveBeenCalledWith("recovered");

    vi.advanceTimersByTime(1100);
    channels[1]!.statusCb!("SUBSCRIBED");
    expect(onHealth).toHaveBeenCalledWith("recovered");
    expect(onHealth).toHaveBeenCalledTimes(2);
  });

  it("does not report down twice while a retry is pending", () => {
    vi.useFakeTimers();
    const onHealth = vi.fn();
    subscribeToProjectChanges("p1", () => {}, onHealth);

    channels[0]!.statusCb!("CHANNEL_ERROR");
    channels[0]!.statusCb!("CLOSED");
    expect(onHealth).toHaveBeenCalledTimes(1);
  });

  it("stops retrying after unsubscribe", () => {
    vi.useFakeTimers();
    const unsubscribe = subscribeToProjectChanges("p1", () => {});
    channels[0]!.statusCb!("CHANNEL_ERROR");
    unsubscribe();
    vi.advanceTimersByTime(60_000);
    // Only the initial channel was ever built; no rebuild after stop.
    expect(supabaseMock.channel).toHaveBeenCalledTimes(1);
  });

  it("ignores the CLOSED status caused by unsubscribing itself", () => {
    vi.useFakeTimers();
    const onHealth = vi.fn();
    const unsubscribe = subscribeToProjectChanges("p1", () => {}, onHealth);
    unsubscribe();
    channels[0]!.statusCb!("CLOSED");
    vi.advanceTimersByTime(60_000);
    expect(onHealth).not.toHaveBeenCalled();
    expect(supabaseMock.channel).toHaveBeenCalledTimes(1);
  });
});
