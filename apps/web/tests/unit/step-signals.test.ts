import { describe, expect, it } from "vitest";
import { computeStepSignals } from "@/lib/steps/signals";
import type { SignalStep, ComputeSignalsInput } from "@/lib/steps/signals";
import type { TradeStepDep } from "@/lib/steps/types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<SignalStep> & { step_code: string; name: string }): SignalStep {
  return {
    step_type: "site_work",
    trade_role: null,
    lead_time_days: 0,
    typical_duration_days: 3,
    status: "not_started",
    planned_start: null,
    planned_end: null,
    actual_start: null,
    actual_end: null,
    last_progress_at: null,
    blocking_reason: null,
    ...overrides,
  };
}

// Fixed reference: "today" = 2026-07-10
const TODAY = "2026-07-10";
const NOW = "2026-07-10T08:00:00Z";

// ─── behind_plan ──────────────────────────────────────────────────────────────

describe("behind_plan", () => {
  it("high when today > planned_end and status is not done", () => {
    const step = makeStep({
      step_code: "B4",
      name: "Screed",
      status: "in_progress",
      planned_start: "2026-07-01",
      planned_end: "2026-07-05", // 5 days ago
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    const sig = result.find((s) => s.kind === "behind_plan");
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe("high");
    expect(sig!.message).not.toBe("");
  });

  it("warning when today > planned_start and status is not_started", () => {
    const step = makeStep({
      step_code: "B3",
      name: "Waterproofing",
      status: "not_started",
      planned_start: "2026-07-05", // 5 days ago
      planned_end: "2026-07-15",
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    const sig = result.find((s) => s.kind === "behind_plan");
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe("warning");
    expect(sig!.message).not.toBe("");
  });

  it("no signal when status is accepted (done)", () => {
    const step = makeStep({
      step_code: "B3",
      name: "Waterproofing",
      status: "accepted",
      planned_start: "2026-07-01",
      planned_end: "2026-07-05",
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    expect(result.filter((s) => s.kind === "behind_plan")).toHaveLength(0);
  });

  it("no signal when no planned window", () => {
    const step = makeStep({
      step_code: "B3",
      name: "Waterproofing",
      status: "not_started",
      // planned_start and planned_end are null
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    expect(result.filter((s) => s.kind === "behind_plan")).toHaveLength(0);
  });

  it("no signal when today is within the planned window", () => {
    const step = makeStep({
      step_code: "B3",
      name: "Waterproofing",
      status: "in_progress",
      planned_start: "2026-07-08",
      planned_end: "2026-07-15",
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    expect(result.filter((s) => s.kind === "behind_plan")).toHaveLength(0);
  });

  it("high overrides warning when today > planned_end (end test takes precedence)", () => {
    // today > planned_end AND status is not_started → high fires, not both
    const step = makeStep({
      step_code: "B3",
      name: "Waterproofing",
      status: "not_started",
      planned_start: "2026-07-01", // also today > start
      planned_end: "2026-07-05",   // also today > end → high fires
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    const behinds = result.filter((s) => s.kind === "behind_plan");
    // De-dupe: only one behind_plan per step
    expect(behinds).toHaveLength(1);
    expect(behinds.at(0)!.severity).toBe("high");
  });
});

// ─── silent ───────────────────────────────────────────────────────────────────

describe("silent", () => {
  it("warning when in_progress and last_progress_at is 4 days ago", () => {
    const step = makeStep({
      step_code: "B5",
      name: "Waterproofing",
      status: "in_progress",
      planned_start: "2026-07-05",
      planned_end: "2026-07-15",
      last_progress_at: "2026-07-06T10:00:00Z", // 4 days ago relative to NOW
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    const sig = result.find((s) => s.kind === "silent");
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe("warning");
    expect(sig!.message).not.toBe("");
  });

  it("high when in_progress and last_progress_at is 7 days ago", () => {
    const step = makeStep({
      step_code: "B5",
      name: "Waterproofing",
      status: "in_progress",
      planned_start: "2026-07-01",
      planned_end: "2026-07-20",
      last_progress_at: "2026-07-03T10:00:00Z", // 7 days ago
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    const sig = result.find((s) => s.kind === "silent");
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe("high");
  });

  it("no signal when last_progress_at is 1 day ago (under threshold)", () => {
    const step = makeStep({
      step_code: "B5",
      name: "Waterproofing",
      status: "in_progress",
      planned_start: "2026-07-05",
      planned_end: "2026-07-15",
      last_progress_at: "2026-07-09T10:00:00Z", // 1 day ago
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    expect(result.filter((s) => s.kind === "silent")).toHaveLength(0);
  });

  it("no signal when step is not_started and outside its planned window", () => {
    const step = makeStep({
      step_code: "B5",
      name: "Waterproofing",
      status: "not_started",
      planned_start: "2026-07-15", // future
      planned_end: "2026-07-20",
      last_progress_at: null,
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    expect(result.filter((s) => s.kind === "silent")).toHaveLength(0);
  });

  it("no signal when step is blocked (blocking_timeline handles it)", () => {
    const step = makeStep({
      step_code: "B5",
      name: "Waterproofing",
      status: "blocked",
      planned_start: "2026-07-05",
      planned_end: "2026-07-15",
      last_progress_at: "2026-07-01T10:00:00Z",
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    expect(result.filter((s) => s.kind === "silent")).toHaveLength(0);
  });
});

// ─── lead_time_risk ───────────────────────────────────────────────────────────

describe("lead_time_risk", () => {
  const deps: TradeStepDep[] = [
    { step_code: "B4", predecessor_code: "B3" }, // B3 must precede B4
  ];

  it("fires high when successor planned_start is within lead_time_days of today", () => {
    const booking = makeStep({
      step_code: "B3",
      name: "Booking Aplikator Waterproofing",
      step_type: "procurement",
      status: "not_started",
      lead_time_days: 14,
    });
    const waterproofing = makeStep({
      step_code: "B4",
      name: "Waterproofing",
      step_type: "site_work",
      status: "not_started",
      planned_start: "2026-07-20", // 10 days from TODAY — within 14-day lead
    });
    const result = computeStepSignals({
      steps: [booking, waterproofing],
      deps,
      today: TODAY,
      now: NOW,
    });
    const sig = result.find((s) => s.kind === "lead_time_risk");
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe("high");
    expect(sig!.stepCode).toBe("B3");
    expect(sig!.message).not.toBe("");
  });

  it("no signal when successor planned_start is beyond the lead time", () => {
    const booking = makeStep({
      step_code: "B3",
      name: "Booking Aplikator Waterproofing",
      step_type: "procurement",
      status: "not_started",
      lead_time_days: 7,
    });
    const waterproofing = makeStep({
      step_code: "B4",
      name: "Waterproofing",
      step_type: "site_work",
      status: "not_started",
      planned_start: "2026-07-25", // 15 days from TODAY — outside 7-day lead
    });
    const result = computeStepSignals({
      steps: [booking, waterproofing],
      deps,
      today: TODAY,
      now: NOW,
    });
    expect(result.filter((s) => s.kind === "lead_time_risk")).toHaveLength(0);
  });

  it("no signal when step has lead_time_days = 0", () => {
    const step = makeStep({
      step_code: "B3",
      name: "Some step",
      status: "not_started",
      lead_time_days: 0,
    });
    const successor = makeStep({
      step_code: "B4",
      name: "Successor",
      status: "not_started",
      planned_start: "2026-07-11", // tomorrow
    });
    const result = computeStepSignals({
      steps: [step, successor],
      deps,
      today: TODAY,
      now: NOW,
    });
    expect(result.filter((s) => s.kind === "lead_time_risk")).toHaveLength(0);
  });

  it("no signal when the step with lead time is already in_progress", () => {
    const booking = makeStep({
      step_code: "B3",
      name: "Booking Aplikator",
      step_type: "procurement",
      status: "in_progress", // already started
      lead_time_days: 14,
    });
    const waterproofing = makeStep({
      step_code: "B4",
      name: "Waterproofing",
      status: "not_started",
      planned_start: "2026-07-15",
    });
    const result = computeStepSignals({
      steps: [booking, waterproofing],
      deps,
      today: TODAY,
      now: NOW,
    });
    expect(result.filter((s) => s.kind === "lead_time_risk")).toHaveLength(0);
  });
});

// ─── blocking_timeline ────────────────────────────────────────────────────────

describe("blocking_timeline", () => {
  const deps: TradeStepDep[] = [
    { step_code: "B5", predecessor_code: "B4" },
  ];

  it("critical when blocked step has successor starting within 7 days", () => {
    const blocker = makeStep({
      step_code: "B4",
      name: "Pengiriman Material",
      status: "blocked",
      blocking_reason: "Material belum tersedia di gudang",
    });
    const successor = makeStep({
      step_code: "B5",
      name: "Pemasangan Keramik",
      status: "not_started",
      planned_start: "2026-07-15", // 5 days from TODAY
    });
    const result = computeStepSignals({
      steps: [blocker, successor],
      deps,
      today: TODAY,
      now: NOW,
    });
    const sig = result.find((s) => s.kind === "blocking_timeline");
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe("critical");
    expect(sig!.stepCode).toBe("B4");
    expect(sig!.detail).toContain("Material belum tersedia di gudang");
    expect(sig!.message).not.toBe("");
  });

  it("no signal when successor's planned_start is more than 7 days away", () => {
    const blocker = makeStep({
      step_code: "B4",
      name: "Pengiriman Material",
      status: "blocked",
    });
    const successor = makeStep({
      step_code: "B5",
      name: "Pemasangan Keramik",
      status: "not_started",
      planned_start: "2026-07-25", // 15 days from TODAY
    });
    const result = computeStepSignals({
      steps: [blocker, successor],
      deps,
      today: TODAY,
      now: NOW,
    });
    expect(result.filter((s) => s.kind === "blocking_timeline")).toHaveLength(0);
  });

  it("no signal when step is in_progress (not blocked)", () => {
    const step = makeStep({
      step_code: "B4",
      name: "Pengiriman Material",
      status: "in_progress",
    });
    const successor = makeStep({
      step_code: "B5",
      name: "Pemasangan Keramik",
      planned_start: "2026-07-12",
    });
    const result = computeStepSignals({
      steps: [step, successor],
      deps,
      today: TODAY,
      now: NOW,
    });
    expect(result.filter((s) => s.kind === "blocking_timeline")).toHaveLength(0);
  });

  it("fires even when successor planned_start is today (0 days away)", () => {
    const blocker = makeStep({
      step_code: "B4",
      name: "Pengiriman Material",
      status: "blocked",
      blocking_reason: "Supir tidak hadir",
    });
    const successor = makeStep({
      step_code: "B5",
      name: "Pemasangan Keramik",
      status: "not_started",
      planned_start: TODAY, // today
    });
    const result = computeStepSignals({
      steps: [blocker, successor],
      deps,
      today: TODAY,
      now: NOW,
    });
    const sig = result.find((s) => s.kind === "blocking_timeline");
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe("critical");
  });
});

// ─── stale_decision ───────────────────────────────────────────────────────────

describe("stale_decision", () => {
  it("high for a decision step past its planned_end", () => {
    const step = makeStep({
      step_code: "B1",
      name: "Pilih Sanitair",
      step_type: "decision",
      status: "in_progress",
      planned_start: "2026-06-25",
      planned_end: "2026-07-01", // 9 days ago
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    const sig = result.find((s) => s.kind === "stale_decision");
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe("high");
    expect(sig!.message).not.toBe("");
  });

  it("high for a procurement step past its planned_end", () => {
    const step = makeStep({
      step_code: "B2",
      name: "Order Keramik",
      step_type: "procurement",
      status: "not_started",
      planned_start: "2026-06-20",
      planned_end: "2026-07-05", // 5 days ago
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    const sig = result.find((s) => s.kind === "stale_decision");
    expect(sig).toBeDefined();
    expect(sig!.severity).toBe("high");
  });

  it("no signal when the decision is accepted (done)", () => {
    const step = makeStep({
      step_code: "B1",
      name: "Pilih Sanitair",
      step_type: "decision",
      status: "accepted",
      planned_start: "2026-07-01",
      planned_end: "2026-07-05",
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    expect(result.filter((s) => s.kind === "stale_decision")).toHaveLength(0);
  });

  it("no signal for a site_work step past planned_end", () => {
    // site_work past planned_end = behind_plan, not stale_decision
    const step = makeStep({
      step_code: "B4",
      name: "Screed",
      step_type: "site_work",
      status: "in_progress",
      planned_start: "2026-07-01",
      planned_end: "2026-07-05",
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    expect(result.filter((s) => s.kind === "stale_decision")).toHaveLength(0);
    // But behind_plan should fire
    expect(result.filter((s) => s.kind === "behind_plan")).toHaveLength(1);
  });

  it("no signal when planned_end is in the future", () => {
    const step = makeStep({
      step_code: "B1",
      name: "Pilih Sanitair",
      step_type: "decision",
      status: "in_progress",
      planned_start: "2026-07-08",
      planned_end: "2026-07-15", // future
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    expect(result.filter((s) => s.kind === "stale_decision")).toHaveLength(0);
  });
});

// ─── clean plan → no signals ──────────────────────────────────────────────────

describe("clean plan", () => {
  it("returns no signals when all steps are on-plan and recently updated", () => {
    const steps: SignalStep[] = [
      makeStep({
        step_code: "B1",
        name: "Pilih Sanitair",
        step_type: "decision",
        status: "accepted",
        planned_start: "2026-07-01",
        planned_end: "2026-07-05",
      }),
      makeStep({
        step_code: "B4",
        name: "Screed",
        step_type: "site_work",
        status: "in_progress",
        planned_start: "2026-07-08",
        planned_end: "2026-07-15",
        last_progress_at: "2026-07-09T10:00:00Z", // yesterday
      }),
      makeStep({
        step_code: "B5",
        name: "Waterproofing",
        step_type: "site_work",
        status: "not_started",
        planned_start: "2026-07-15", // future
        planned_end: "2026-07-20",
      }),
    ];
    const result = computeStepSignals({ steps, deps: [], today: TODAY, now: NOW });
    expect(result).toHaveLength(0);
  });
});

// ─── multi-signal step ────────────────────────────────────────────────────────

describe("multi-signal step", () => {
  it("a step can emit both behind_plan and stale_decision simultaneously", () => {
    const step = makeStep({
      step_code: "B1",
      name: "Pilih Sanitair",
      step_type: "decision",
      status: "not_started",
      planned_start: "2026-07-01", // past
      planned_end: "2026-07-05",   // past
    });
    const result = computeStepSignals({ steps: [step], deps: [], today: TODAY, now: NOW });
    const kinds = result.map((s) => s.kind);
    // behind_plan (high, because today > planned_end) fires
    expect(kinds).toContain("behind_plan");
    // stale_decision also fires (decision past planned_end)
    expect(kinds).toContain("stale_decision");
    // De-dupe: each kind appears only once
    expect(result.filter((s) => s.kind === "behind_plan")).toHaveLength(1);
    expect(result.filter((s) => s.kind === "stale_decision")).toHaveLength(1);
  });

  it("results are sorted critical first, then high, warning, info", () => {
    const deps: TradeStepDep[] = [
      { step_code: "B5", predecessor_code: "B4" },
    ];
    const steps: SignalStep[] = [
      // B4: blocked + successor imminent → critical
      makeStep({
        step_code: "B4",
        name: "Pengiriman Material",
        status: "blocked",
        planned_start: "2026-07-05",
        planned_end: "2026-07-08",
        blocking_reason: "Stok habis",
      }),
      // B5: not_started, planned window starts 3 days from now (within IMMINENT window too)
      makeStep({
        step_code: "B5",
        name: "Pemasangan Keramik",
        status: "not_started",
        planned_start: "2026-07-13",
        planned_end: "2026-07-18",
      }),
      // B1: decision, stale → high
      makeStep({
        step_code: "B1",
        name: "Pilih Sanitair",
        step_type: "decision",
        status: "in_progress",
        planned_start: "2026-06-25",
        planned_end: "2026-07-01",
      }),
    ];
    const result = computeStepSignals({ steps, deps, today: TODAY, now: NOW });
    const criticals = result.filter((s) => s.severity === "critical");
    const highs = result.filter((s) => s.severity === "high");
    expect(criticals.length).toBeGreaterThan(0);
    expect(highs.length).toBeGreaterThan(0);
    // First signal must be critical
    expect(result.at(0)!.severity).toBe("critical");
  });
});
