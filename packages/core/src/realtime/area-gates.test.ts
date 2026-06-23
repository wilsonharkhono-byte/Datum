import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subscribeToAreaGateChanges } from "./area-gates";
import type { DatumClient } from "../client";

type Handler = () => void;

function mockClient() {
  const registrations: { table: string; event: string; filter?: string }[] = [];
  const handlers: Handler[] = [];
  const removeChannel = vi.fn();
  const channel = {
    on(_type: string, cfg: { table: string; event: string; filter?: string }, h: Handler) {
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

describe("subscribeToAreaGateChanges", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens channel named area-gates:<projectId>", () => {
    const { client } = mockClient();
    subscribeToAreaGateChanges(client, "P1", () => {});
    expect((client.channel as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("area-gates:P1");
  });

  it("registers 3 listeners (area_gate_status, areas, card_areas)", () => {
    const { client, registrations } = mockClient();
    subscribeToAreaGateChanges(client, "P1", () => {});
    expect(registrations.map((r) => r.table)).toEqual(["area_gate_status", "areas", "card_areas"]);
  });

  it("filters area_gate_status and areas on project_id, card_areas unfiltered", () => {
    const { client, registrations } = mockClient();
    subscribeToAreaGateChanges(client, "P1", () => {});
    const ags = registrations.find((r) => r.table === "area_gate_status")!;
    const areas = registrations.find((r) => r.table === "areas")!;
    const ca = registrations.find((r) => r.table === "card_areas")!;
    expect(ags.filter).toBe("project_id=eq.P1");
    expect(areas.filter).toBe("project_id=eq.P1");
    expect(ca.filter).toBeUndefined();
  });

  it("debounces onChange by 250ms and coalesces rapid calls", () => {
    const { client, handlers } = mockClient();
    const onChange = vi.fn();
    subscribeToAreaGateChanges(client, "P1", onChange);
    handlers[0]!(); // area_gate_status
    handlers[0]!();
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ kind: "area_gate_status" });
  });

  it("emits correct kind for each table handler", () => {
    const { client, handlers } = mockClient();
    const results: string[] = [];
    subscribeToAreaGateChanges(client, "P1", (c) => results.push(c.kind));

    // area_gate_status handler
    handlers[0]!();
    vi.advanceTimersByTime(250);

    // areas handler
    handlers[1]!();
    vi.advanceTimersByTime(250);

    // card_areas handler
    handlers[2]!();
    vi.advanceTimersByTime(250);

    expect(results).toEqual(["area_gate_status", "area", "card_area"]);
  });

  it("cleanup removes the channel and clears pending timer", () => {
    const { client, handlers, removeChannel } = mockClient();
    const onChange = vi.fn();
    const stop = subscribeToAreaGateChanges(client, "P1", onChange);
    handlers[0]!();         // queue a debounced onChange
    stop();                 // unsubscribe before 250ms
    vi.advanceTimersByTime(250);
    expect(onChange).not.toHaveBeenCalled();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
