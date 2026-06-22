import { describe, expect, it } from "vitest";
import { projectStepStatus, type StepStatusInput } from "@/lib/steps/status";

type WorkEv = StepStatusInput["workEvents"][number];
const ev = (status: string, occurredAt: string, extra: Record<string, unknown> = {}): WorkEv =>
  ({ occurred_at: occurredAt, created_at: occurredAt, payload: { status, ...extra } });

function input(over: Partial<StepStatusInput> = {}): StepStatusInput {
  return { workEvents: [], checkpoints: [], punchItems: [], ...over };
}

describe("projectStepStatus", () => {
  it("not_started when there are no work events", () => {
    expect(projectStepStatus(input()).status).toBe("not_started");
  });

  it("in_progress on a non-terminal work event", () => {
    const r = projectStepStatus(input({ workEvents: [ev("in_progress", "2026-07-02T00:00:00Z")] }));
    expect(r.status).toBe("in_progress");
    expect(r.lastProgressAt).toBe("2026-07-02T00:00:00Z");
  });

  it("blocked when the latest work event is blocked, carrying the reason", () => {
    const r = projectStepStatus(input({ workEvents: [
      ev("in_progress", "2026-07-02T00:00:00Z"),
      ev("blocked", "2026-07-03T00:00:00Z", { blocked_on: "marmer belum datang" }),
    ] }));
    expect(r.status).toBe("blocked");
    expect(r.blockingReason).toBe("marmer belum datang");
  });

  it("done_with_defects when work is done but a kritis/mayor punch is open", () => {
    const r = projectStepStatus(input({
      workEvents: [ev("done", "2026-07-05T00:00:00Z")],
      punchItems: [{ severity: "mayor", status: "open" }],
    }));
    expect(r.status).toBe("done_with_defects");
  });

  it("done_with_defects when work is done but a required checkpoint has not passed", () => {
    const r = projectStepStatus(input({
      workEvents: [ev("done", "2026-07-05T00:00:00Z")],
      checkpoints: [{ required: true, result: "pending" }],
    }));
    expect(r.status).toBe("done_with_defects");
  });

  it("accepted when work done, all required checkpoints pass, no open kritis/mayor punch", () => {
    const r = projectStepStatus(input({
      workEvents: [ev("done", "2026-07-05T00:00:00Z")],
      checkpoints: [{ required: true, result: "pass" }, { required: false, result: "pending" }],
      punchItems: [{ severity: "minor", status: "open" }, { severity: "kritis", status: "closed" }],
    }));
    expect(r.status).toBe("accepted");
  });

  it("done via percent_complete >= 100 counts as done", () => {
    const r = projectStepStatus(input({
      workEvents: [ev("in_progress", "2026-07-05T00:00:00Z", { percent_complete: 100 })],
      checkpoints: [{ required: true, result: "pass" }],
    }));
    expect(r.status).toBe("accepted");
  });

  it("captures actual_start at the earliest in_progress event", () => {
    const r = projectStepStatus(input({ workEvents: [
      ev("in_progress", "2026-07-02T00:00:00Z"),
      ev("in_progress", "2026-07-05T00:00:00Z"),
    ] }));
    expect(r.actualStart).toBe("2026-07-02T00:00:00Z");
    expect(r.actualEnd).toBe(null);
  });

  it("captures actual_end when the step resolves to accepted/done_with_defects", () => {
    const r = projectStepStatus(input({
      workEvents: [ev("in_progress", "2026-07-02T00:00:00Z"), ev("done", "2026-07-08T00:00:00Z")],
      checkpoints: [{ required: true, result: "pass" }],
    }));
    expect(r.status).toBe("accepted");
    expect(r.actualStart).toBe("2026-07-02T00:00:00Z");
    expect(r.actualEnd).toBe("2026-07-08T00:00:00Z");
  });

  it("has null actuals when never started", () => {
    const r = projectStepStatus(input());
    expect(r.actualStart).toBe(null);
    expect(r.actualEnd).toBe(null);
  });
});
