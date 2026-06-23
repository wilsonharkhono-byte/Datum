import { describe, expect, it } from "vitest";
import {
  blockerCount,
  deriveStage,
  isHandoverReady,
  nextAction,
  relativeTimeId,
  sortRoomsByUrgency,
  stageProgress,
  type Room,
  type RoomGateCell,
} from "@datum/core";
import type { GateCode } from "@datum/types";

function cell(gate: GateCode, status: RoomGateCell["status"]): RoomGateCell {
  return { gate_code: gate, status };
}

describe("deriveStage", () => {
  it("returns none when nothing has started", () => {
    expect(deriveStage([])).toEqual({ kind: "none" });
    expect(deriveStage([cell("A", "not_started"), cell("B", "not_applicable")])).toEqual({
      kind: "none",
    });
  });

  it("picks the furthest in_progress gate as the active stage", () => {
    const stage = deriveStage([
      cell("A", "passed"),
      cell("B", "in_progress"),
      cell("D", "in_progress"),
      cell("C", "not_started"),
    ]);
    expect(stage).toEqual({ kind: "active", gate: "D", status: "in_progress" });
  });

  it("prefers a blocked gate's own status but still picks the furthest active gate", () => {
    const stage = deriveStage([
      cell("B", "blocked"),
      cell("D", "in_progress"),
    ]);
    // D is furthest along, so the stage sits at D (in_progress); B's blocker is
    // surfaced via blockerCount / nextAction, not by moving the stage back.
    expect(stage).toEqual({ kind: "active", gate: "D", status: "in_progress" });
  });

  it("reports a blocked gate as the active stage when it is the furthest", () => {
    const stage = deriveStage([cell("B", "passed"), cell("D", "blocked")]);
    expect(stage).toEqual({ kind: "active", gate: "D", status: "blocked" });
  });

  it("falls back to the furthest passed gate when no gate is active", () => {
    const stage = deriveStage([
      cell("A", "passed"),
      cell("B", "passed"),
      cell("C", "not_started"),
    ]);
    expect(stage).toEqual({ kind: "passed", gate: "B" });
  });

  it("treats ready_for_handoff as a passed-class stage when nothing is active", () => {
    const stage = deriveStage([cell("A", "passed"), cell("H", "ready_for_handoff")]);
    expect(stage).toEqual({ kind: "passed", gate: "H" });
  });
});

describe("blockerCount", () => {
  it("counts blocked cells", () => {
    expect(blockerCount([cell("B", "blocked"), cell("D", "blocked"), cell("A", "passed")])).toBe(2);
    expect(blockerCount([cell("A", "in_progress")])).toBe(0);
  });
});

describe("stageProgress", () => {
  it("is 0 for none and increases toward H", () => {
    expect(stageProgress({ kind: "none" })).toBe(0);
    const a = stageProgress({ kind: "active", gate: "A", status: "in_progress" });
    const d = stageProgress({ kind: "active", gate: "D", status: "in_progress" });
    expect(d).toBeGreaterThan(a);
    expect(stageProgress({ kind: "passed", gate: "H" })).toBe(1);
  });
});

describe("isHandoverReady", () => {
  it("is true only when gate H is ready/passed and stage is passed-class", () => {
    const cells = [cell("G", "passed"), cell("H", "ready_for_handoff")];
    const stage = deriveStage(cells);
    expect(isHandoverReady(cells, stage)).toBe(true);
  });
  it("is false while a gate is still active", () => {
    const cells = [cell("G", "in_progress"), cell("H", "not_started")];
    const stage = deriveStage(cells);
    expect(isHandoverReady(cells, stage)).toBe(false);
  });
});

describe("nextAction", () => {
  it("prioritizes blockers", () => {
    const a = nextAction({ kind: "active", gate: "D", status: "blocked" }, 2, 3, false);
    expect(a.tone).toBe("urgent");
    expect(a.text).toContain("2 blocker");
  });

  it("surfaces handover readiness", () => {
    const a = nextAction({ kind: "passed", gate: "H" }, 0, 0, true);
    expect(a.tone).toBe("ready");
    expect(a.text).toContain("Siap serah");
  });

  it("describes an active gate with active card count", () => {
    const a = nextAction({ kind: "active", gate: "D", status: "in_progress" }, 0, 3, false);
    expect(a.tone).toBe("active");
    expect(a.text).toContain("Gate D");
    expect(a.text).toContain("3 kartu aktif");
  });

  it("guides an idle started room and an empty room", () => {
    expect(nextAction({ kind: "passed", gate: "B" }, 0, 0, false).text).toContain("lanjut");
    expect(nextAction({ kind: "none" }, 0, 0, false).text).toContain("Belum ada aktivitas");
  });
});

describe("sortRoomsByUrgency", () => {
  function room(partial: Partial<Room>): Room {
    return {
      areaId: partial.areaId ?? "x",
      areaCode: "AX",
      areaName: "Area",
      floor: null,
      sortOrder: partial.sortOrder ?? 0,
      stage: partial.stage ?? { kind: "none" },
      blockers: partial.blockers ?? 0,
      activeCards: 0,
      lastActivityAt: partial.lastActivityAt ?? null,
      handoverReady: false,
      action: { text: "", tone: "idle" },
    };
  }

  it("puts blocked rooms first, then by progress, then recency", () => {
    const blocked = room({ areaId: "blocked", blockers: 1, stage: { kind: "active", gate: "B", status: "blocked" } });
    const farAlong = room({ areaId: "far", stage: { kind: "passed", gate: "G" }, lastActivityAt: "2026-06-01T00:00:00Z" });
    const early = room({ areaId: "early", stage: { kind: "active", gate: "A", status: "in_progress" }, lastActivityAt: "2026-06-10T00:00:00Z" });
    const order = sortRoomsByUrgency([early, farAlong, blocked]).map((r) => r.areaId);
    expect(order).toEqual(["blocked", "far", "early"]);
  });

  it("breaks progress ties by most-recent activity", () => {
    const stale = room({ areaId: "stale", stage: { kind: "active", gate: "C", status: "in_progress" }, lastActivityAt: "2026-06-01T00:00:00Z" });
    const fresh = room({ areaId: "fresh", stage: { kind: "active", gate: "C", status: "in_progress" }, lastActivityAt: "2026-06-12T00:00:00Z" });
    const order = sortRoomsByUrgency([stale, fresh]).map((r) => r.areaId);
    expect(order).toEqual(["fresh", "stale"]);
  });
});

describe("relativeTimeId", () => {
  const now = Date.parse("2026-06-13T12:00:00Z");
  it("returns null for null/invalid input", () => {
    expect(relativeTimeId(null, now)).toBeNull();
    expect(relativeTimeId("not-a-date", now)).toBeNull();
  });
  it("formats Bahasa relative buckets", () => {
    expect(relativeTimeId("2026-06-13T11:59:50Z", now)).toBe("baru saja");
    expect(relativeTimeId("2026-06-13T11:30:00Z", now)).toBe("30 menit lalu");
    expect(relativeTimeId("2026-06-13T09:00:00Z", now)).toBe("3 jam lalu");
    expect(relativeTimeId("2026-06-12T12:00:00Z", now)).toBe("kemarin");
    expect(relativeTimeId("2026-06-11T12:00:00Z", now)).toBe("2 hari lalu");
    expect(relativeTimeId("2026-05-04T12:00:00Z", now)).toBe("1 bulan lalu");
    expect(relativeTimeId("2025-06-13T12:00:00Z", now)).toBe("1 tahun lalu");
  });
});
