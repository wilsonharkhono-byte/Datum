import { describe, it, expect } from "vitest";
import {
  summarizeStatusCounts,
  UNAVAILABLE,
  type StatusCountRow,
} from "@/lib/cron/health";

describe("summarizeStatusCounts", () => {
  it("builds a status -> count map from grouped rows, zero-filling known statuses", () => {
    const rows: StatusCountRow[] = [
      { status: "pending", count: 3 },
      { status: "done", count: 12 },
    ];
    const result = summarizeStatusCounts(rows, ["pending", "processing", "done", "failed", "skipped"]);
    expect(result).toEqual({
      pending: 3,
      processing: 0,
      done: 12,
      failed: 0,
      skipped: 0,
    });
  });

  it("returns all-zero counts for an empty row set", () => {
    const result = summarizeStatusCounts([], ["pending", "done"]);
    expect(result).toEqual({ pending: 0, done: 0 });
  });

  it("ignores statuses not in the known list (defensive against schema drift)", () => {
    const rows: StatusCountRow[] = [{ status: "weird_new_status", count: 1 }];
    const result = summarizeStatusCounts(rows, ["pending", "done"]);
    expect(result).toEqual({ pending: 0, done: 0 });
  });
});

describe("UNAVAILABLE sentinel", () => {
  it("is a stable string marker distinct from any real payload shape", () => {
    expect(UNAVAILABLE).toBe("unavailable");
  });
});
