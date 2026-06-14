import { describe, expect, it } from "vitest";
import { keys } from "@/lib/query/keys";

describe("query keys", () => {
  it("builds stable, identity-scoped keys", () => {
    expect(keys.board("BDG-H1")).toEqual(["board", "BDG-H1"]);
    expect(keys.projects()).toEqual(["projects"]);
    expect(keys.card("BDG-H1", "master")).toEqual(["card", "BDG-H1", "master"]);
  });
});
