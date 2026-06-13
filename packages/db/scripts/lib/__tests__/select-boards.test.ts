import { describe, expect, it } from "vitest";
import { isInScope } from "../select-boards";

describe("isInScope", () => {
  it("includes an open project board", () => {
    expect(isInScope({ name: "AR.IN - BDG H-1", closed: false }).include).toBe(true);
  });
  it("includes the WHA pipeline boards", () => {
    expect(isInScope({ name: "WHA - WORKING DRAWINGS", closed: false }).include).toBe(true);
  });
  it("excludes closed boards", () => {
    const r = isInScope({ name: "DARMO HILL", closed: true });
    expect(r.include).toBe(false);
    expect(r.reason).toBe("closed");
  });
  it("excludes templates and junk regardless of case/whitespace", () => {
    expect(isInScope({ name: "ARCH - TEMPLATE", closed: false }).include).toBe(false);
    expect(isInScope({ name: "INTR - TEMPLATE", closed: false }).include).toBe(false);
    expect(isInScope({ name: "  untitled  ", closed: false }).include).toBe(false);
    expect(isInScope({ name: "To Do List - Timbul", closed: false }).include).toBe(false);
  });
});
