import { describe, it, expect, vi } from "vitest";
import { subscribeToOwnNotifications } from "./notifications";
import type { DatumClient } from "../client";

function mockClient() {
  const regs: { event: string; filter: string }[] = [];
  const handlers: (() => void)[] = [];
  const removeChannel = vi.fn();
  const channel = {
    on(_t: string, cfg: { event: string; filter: string }, h: () => void) {
      regs.push({ event: cfg.event, filter: cfg.filter });
      handlers.push(h);
      return channel;
    },
    subscribe() { return channel; },
  };
  const client = { channel: vi.fn(() => channel), removeChannel } as unknown as DatumClient;
  return { client, regs, handlers, removeChannel };
}

describe("subscribeToOwnNotifications", () => {
  it("registers INSERT + UPDATE on the recipient filter and reports deltas", () => {
    const { client, regs, handlers } = mockClient();
    const onDelta = vi.fn();
    subscribeToOwnNotifications(client, "S1", onDelta);
    expect((client.channel as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("notifications:S1");
    expect(regs).toEqual([
      { event: "INSERT", filter: "recipient_staff_id=eq.S1" },
      { event: "UPDATE", filter: "recipient_staff_id=eq.S1" },
    ]);
    handlers[0]!();
    handlers[1]!();
    expect(onDelta).toHaveBeenNthCalledWith(1, { kind: "insert" });
    expect(onDelta).toHaveBeenNthCalledWith(2, { kind: "refresh" });
  });

  it("cleanup removes the channel", () => {
    const { client, removeChannel } = mockClient();
    subscribeToOwnNotifications(client, "S1", () => {})();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
