import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subscribeToProjectChanges } from "./project";
import type { DatumClient } from "../client";

type Handler = () => void;

function mockClient() {
  const registrations: { table: string; event: string; filter: string }[] = [];
  const handlers: Handler[] = [];
  const removeChannel = vi.fn();
  const channel = {
    on(_type: string, cfg: { table: string; event: string; filter: string }, h: Handler) {
      registrations.push({ table: cfg.table, event: cfg.event, filter: cfg.filter });
      handlers.push(h);
      return channel;
    },
    subscribe() { return channel; },
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel,
  } as unknown as DatumClient;
  return { client, registrations, handlers, removeChannel };
}

describe("subscribeToProjectChanges", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens one channel and registers 4 filtered listeners", () => {
    const { client, registrations } = mockClient();
    subscribeToProjectChanges(client, "P1", () => {});
    expect((client.channel as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("project:P1");
    expect(registrations.map((r) => r.table)).toEqual(["cards", "card_events", "card_comments", "topics"]);
    expect(registrations.every((r) => r.filter === "project_id=eq.P1")).toBe(true);
  });

  it("debounces onChange by 250ms", () => {
    const { client, handlers } = mockClient();
    const onChange = vi.fn();
    subscribeToProjectChanges(client, "P1", onChange);
    handlers[0]!();
    handlers[0]!();
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ kind: "card" });
  });

  it("cleanup removes the channel", () => {
    const { client, removeChannel } = mockClient();
    const stop = subscribeToProjectChanges(client, "P1", () => {});
    stop();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
