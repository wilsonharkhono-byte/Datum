import { describe, expect, it } from "vitest";
import { must } from "./must";

describe("must", () => {
  it("returns the result unchanged when error is null", () => {
    const res = { data: [1, 2], count: 2, error: null };
    expect(must(res, "x")).toBe(res);
  });

  it("throws a labeled error when the query failed", () => {
    const res = { data: null, error: { message: "connection refused" } };
    expect(() => must(res, "brief.drafts")).toThrow("[db] brief.drafts: connection refused");
  });
});
