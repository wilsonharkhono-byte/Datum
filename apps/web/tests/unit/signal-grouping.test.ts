import { describe, expect, it } from "vitest";
import { groupSignalsByStep, type ProjectStepSignalRow } from "@/lib/steps/queries";
import type { StepSignal } from "@/lib/steps/signals";

function row(
  areaId: string,
  stepCode: string,
  severity: StepSignal["severity"],
  kind: StepSignal["kind"],
): ProjectStepSignalRow {
  return {
    areaId,
    areaName: `Area ${areaId}`,
    stepCode,
    stepName: `Step ${stepCode}`,
    tradeRole: null,
    signal: { stepCode, kind, severity, message: `${kind} on ${stepCode}` },
  };
}

describe("groupSignalsByStep", () => {
  it("keeps one row per (area, step), first (highest-severity) wins", () => {
    const rows = [
      row("a1", "B1", "critical", "blocking_timeline"),
      row("a1", "B1", "high", "behind_plan"),
      row("a1", "B1", "high", "stale_decision"),
      row("a1", "B2", "warning", "silent"),
    ];
    const grouped = groupSignalsByStep(rows);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({
      stepCode: "B1",
      otherSignalCount: 2,
      signal: { kind: "blocking_timeline", severity: "critical" },
    });
    expect(grouped[1]).toMatchObject({ stepCode: "B2", otherSignalCount: 0 });
  });

  it("does not merge the same step across different areas", () => {
    const rows = [
      row("a1", "B1", "high", "behind_plan"),
      row("a2", "B1", "high", "behind_plan"),
    ];
    expect(groupSignalsByStep(rows)).toHaveLength(2);
  });

  it("returns empty for empty input", () => {
    expect(groupSignalsByStep([])).toEqual([]);
  });
});
