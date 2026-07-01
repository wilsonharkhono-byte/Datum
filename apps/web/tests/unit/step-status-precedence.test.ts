// apps/web/tests/unit/step-status-precedence.test.ts
import { describe, it, expect } from "vitest";
import { projectStepStatus } from "@/lib/steps/status";

const ev = (occurred_at: string, status: string, source?: "human" | "ai") => ({
  occurred_at,
  created_at: occurred_at,
  source,
  payload: { status },
});

describe("projectStepStatus precedence", () => {
  it("derives from AI events when no human event exists", () => {
    const r = projectStepStatus({
      workEvents: [ev("2026-06-01T00:00:00Z", "done", "ai")],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("accepted");
  });

  it("ignores AI events when any human event exists (human is older)", () => {
    const r = projectStepStatus({
      workEvents: [
        ev("2026-06-01T00:00:00Z", "in_progress", "human"),
        ev("2026-06-02T00:00:00Z", "done", "ai"),
      ],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("in_progress"); // AI "done" dropped
  });

  it("treats missing source as human (back-compat)", () => {
    const r = projectStepStatus({
      workEvents: [ev("2026-06-01T00:00:00Z", "blocked")],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("blocked");
  });
});
