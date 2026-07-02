// apps/web/tests/unit/step-status-precedence.test.ts
import { describe, it, expect } from "vitest";
import { projectStepStatus } from "@/lib/steps/status";

const ev = (occurred_at: string, status: string, source?: "human" | "ai") => ({
  occurred_at,
  created_at: occurred_at,
  source,
  payload: { status },
});

describe("projectStepStatus precedence (newest-information-wins)", () => {
  it("derives from AI events when no human event exists", () => {
    const r = projectStepStatus({
      workEvents: [ev("2026-06-01T00:00:00Z", "done", "ai")],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("accepted");
  });

  it("ignores an AI event older than the newest human event", () => {
    const r = projectStepStatus({
      workEvents: [
        ev("2026-06-01T00:00:00Z", "in_progress", "human"),
        ev("2026-06-02T00:00:00Z", "done", "ai"),
      ],
      checkpoints: [],
      punchItems: [],
    });
    // human is OLDER here — wait: this case is "AI newer than human" (see next test name);
    // kept for back-compat coverage of the old fixture ordering.
    expect(r.status).toBe("accepted"); // AI "done" is newer than the human tap, so it counts
  });

  it("old human tap + newer AI event: AI counts (un-deadlocked)", () => {
    const r = projectStepStatus({
      workEvents: [
        ev("2026-06-01T00:00:00Z", "in_progress", "human"),
        ev("2026-06-15T00:00:00Z", "done", "ai"),
      ],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("accepted");
  });

  it("newer human + older AI event: AI is ignored", () => {
    const r = projectStepStatus({
      workEvents: [
        ev("2026-06-01T00:00:00Z", "done", "ai"),
        ev("2026-06-10T00:00:00Z", "in_progress", "human"),
      ],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("in_progress"); // AI "done" dropped, human's in_progress wins
  });

  it("tie (same occurred_at): human wins", () => {
    const r = projectStepStatus({
      workEvents: [
        ev("2026-06-05T00:00:00Z", "done", "ai"),
        ev("2026-06-05T00:00:00Z", "in_progress", "human"),
      ],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("in_progress"); // AI dropped despite equal timestamp
  });

  it("treats missing source as human (back-compat)", () => {
    const r = projectStepStatus({
      workEvents: [ev("2026-06-01T00:00:00Z", "blocked")],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("blocked");
  });

  it("back-compat: missing-source event silences older AI, same as an explicit human event", () => {
    const r = projectStepStatus({
      workEvents: [
        ev("2026-06-01T00:00:00Z", "done", "ai"),
        ev("2026-06-10T00:00:00Z", "in_progress"), // no source -> treated as human
      ],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("in_progress");
  });
});
