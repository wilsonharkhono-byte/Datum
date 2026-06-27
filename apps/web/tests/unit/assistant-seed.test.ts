import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAssistantSeed, takeAssistantSeed } from "@/lib/assistant/seed";

describe("assistant seed", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("set then take round-trips", () => {
    setAssistantSeed("halo");
    expect(takeAssistantSeed()).toBe("halo");
  });
  it("take is one-shot (second call is null)", () => {
    setAssistantSeed("x");
    expect(takeAssistantSeed()).toBe("x");
    expect(takeAssistantSeed()).toBeNull();
  });
  it("take returns null when nothing set", () => {
    expect(takeAssistantSeed()).toBeNull();
  });
  it("does not throw if storage throws", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} });
    expect(() => setAssistantSeed("x")).not.toThrow();
    expect(takeAssistantSeed()).toBeNull();
  });
});
