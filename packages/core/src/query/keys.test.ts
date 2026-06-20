import { describe, it, expect } from "vitest";
import { keys, PERSISTED_KEY_ROOTS } from "./keys";

describe("query keys", () => {
  it("builds exact tuples", () => {
    expect(keys.board("ARIN-1")).toEqual(["board", "ARIN-1"]);
    expect(keys.projects()).toEqual(["projects"]);
    expect(keys.card("ARIN-1", "kitchen")).toEqual(["card", "ARIN-1", "kitchen"]);
  });
  it("declares the persisted roots", () => {
    expect(PERSISTED_KEY_ROOTS).toEqual(["board", "projects", "card"]);
  });
});
