import { GateCodes, type GateCode } from "@datum/types";
import type { ReadinessState } from "../gates/readiness-rules";
import { gateShortName } from "../gates/labels";

/**
 * Pure derivation logic for the "Ruangan" (Rooms) surface — kept free of
 * Supabase so the stage/next-action/sort rules are unit-testable in isolation.
 *
 * One room = one area. Its "stage" is a single pipeline position derived from
 * the per-gate cell statuses the rule engine already computes, NOT a fresh
 * read of card events.
 */

/** Gate status as it lands in area_gate_status cells. */
export type CellStatus = ReadinessState;

/** Minimal per-gate input for one area. */
export type RoomGateCell = {
  gate_code: GateCode;
  status: CellStatus;
};

/** A→H index, used for "furthest" comparisons and progress. */
const GATE_ORDER: Record<GateCode, number> = Object.fromEntries(
  GateCodes.map((g, i) => [g, i]),
) as Record<GateCode, number>;

export type RoomStage =
  | { kind: "none" }
  | { kind: "active"; gate: GateCode; status: Extract<CellStatus, "in_progress" | "blocked"> }
  | { kind: "passed"; gate: GateCode };

/**
 * Current stage of a room:
 *   1. The furthest (latest A→H) gate that is in_progress or blocked — that is
 *      where the live work sits.
 *   2. Otherwise the furthest gate already passed — the room is between stages.
 *   3. Otherwise nothing has started.
 * not_started / not_applicable / ready_for_handoff cells never define the
 * stage on their own (handoff readiness is surfaced via next-action instead).
 */
export function deriveStage(cells: RoomGateCell[]): RoomStage {
  let active: { gate: GateCode; status: "in_progress" | "blocked" } | null = null;
  let passed: GateCode | null = null;

  for (const c of cells) {
    if (c.status === "in_progress" || c.status === "blocked") {
      if (active === null || GATE_ORDER[c.gate_code] > GATE_ORDER[active.gate]) {
        active = { gate: c.gate_code, status: c.status };
      }
    } else if (c.status === "passed" || c.status === "ready_for_handoff") {
      if (passed === null || GATE_ORDER[c.gate_code] > GATE_ORDER[passed]) {
        passed = c.gate_code;
      }
    }
  }

  if (active) return { kind: "active", gate: active.gate, status: active.status };
  if (passed) return { kind: "passed", gate: passed };
  return { kind: "none" };
}

/** Count of gates in the blocked state for a room. */
export function blockerCount(cells: RoomGateCell[]): number {
  return cells.filter((c) => c.status === "blocked").length;
}

/** 0..1 progress through the gate pipeline, by how far the stage has advanced. */
export function stageProgress(stage: RoomStage): number {
  const total = GateCodes.length; // 8 gates → H passed = 1.0
  if (stage.kind === "none") return 0;
  const idx = GATE_ORDER[stage.gate]; // 0..7
  // A passed gate counts as fully through that step; an active gate is mid-step.
  const completed = stage.kind === "passed" ? idx + 1 : idx + 0.5;
  return Math.min(1, completed / total);
}

/**
 * Whether every gate that has any standing is already passed AND the last one
 * is ready_for_handoff / passed — i.e. the room is at the finish line. Used to
 * surface the "siap serah" next-action.
 */
export function isHandoverReady(cells: RoomGateCell[], stage: RoomStage): boolean {
  if (stage.kind !== "passed") return false;
  // Handover (gate H) itself passed or ready means the room is done.
  const h = cells.find((c) => c.gate_code === "H");
  return h?.status === "ready_for_handoff" || h?.status === "passed";
}

export type NextAction = { text: string; tone: "urgent" | "active" | "ready" | "idle" };

/**
 * One-line hint of what to do next, derived from stage + blockers + activity.
 * Bahasa Indonesia, phone-glance length.
 */
export function nextAction(
  stage: RoomStage,
  blockers: number,
  activeCards: number,
  handoverReady: boolean,
): NextAction {
  if (blockers > 0) {
    return {
      text: blockers === 1 ? "1 blocker — selesaikan dulu" : `${blockers} blocker — selesaikan dulu`,
      tone: "urgent",
    };
  }
  if (handoverReady) {
    return { text: "Siap serah — tandai selesai", tone: "ready" };
  }
  if (stage.kind === "active") {
    const name = gateShortName(stage.gate);
    const cardPart =
      activeCards > 0 ? ` — ${activeCards} kartu aktif` : "";
    return { text: `Gate ${stage.gate} ${name} berjalan${cardPart}`, tone: "active" };
  }
  if (stage.kind === "passed") {
    return { text: `Gate ${stage.gate} selesai — lanjut gate berikutnya`, tone: "idle" };
  }
  return { text: "Belum ada aktivitas — mulai dari kartu", tone: "idle" };
}

export type Room = {
  areaId: string;
  areaCode: string;
  areaName: string;
  areaType: string;
  floor: string | null;
  sortOrder: number;
  stage: RoomStage;
  blockers: number;
  activeCards: number;
  lastActivityAt: string | null;
  handoverReady: boolean;
  action: NextAction;
};

/**
 * Urgency sort for the rooms list:
 *   1. Rooms with blockers first (most blockers first).
 *   2. Then by stage progress — the furthest-along non-blocked rooms surface
 *      next (closer to handoff = more attention-worthy this week).
 *   3. Then by most-recent activity (fresher work first).
 *   4. Stable fallback on the area's own sort order.
 */
export function sortRoomsByUrgency(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => {
    if (a.blockers !== b.blockers) return b.blockers - a.blockers;
    const pa = stageProgress(a.stage);
    const pb = stageProgress(b.stage);
    if (pa !== pb) return pb - pa;
    const ta = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
    const tb = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
    if (ta !== tb) return tb - ta;
    return a.sortOrder - b.sortOrder;
  });
}

/**
 * "2 hari lalu" style relative time in Bahasa Indonesia. `now` is injected so
 * the function stays pure/testable (no Date.now() at module scope).
 */
export function relativeTimeId(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const diffMs = now - then;
  if (diffMs < 0) return "baru saja";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "kemarin" : `${days} hari lalu`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} bulan lalu`;
  const years = Math.floor(months / 12);
  return `${years} tahun lalu`;
}
