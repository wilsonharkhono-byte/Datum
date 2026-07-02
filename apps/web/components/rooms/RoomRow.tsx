"use client";

import { useState } from "react";
import Link from "next/link";
import type { Room } from "@/lib/rooms/derive";
import { relativeTimeId } from "@/lib/rooms/derive";
import { StageChip } from "./StageChip";
import { RoomStepsPanel } from "./RoomStepsPanel";
import { RoomAssistantButton } from "./RoomAssistantButton";
import type { getRoomStepView, AreaStepEventRow } from "@/lib/steps/queries";

type StepView = Awaited<ReturnType<typeof getRoomStepView>>;
type StepEvents = Map<string, AreaStepEventRow[]>;

const ACTION_TONE: Record<Room["action"]["tone"], string> = {
  urgent: "text-[#C62828]",
  active: "text-[#7A6B56]",
  ready: "text-[#1565C0]",
  idle: "text-[var(--text-muted)]",
};

/**
 * One tappable room row. The header shows the daily-glance summary (collapsed
 * by default). Tapping the chevron expands a per-room step panel and assistant
 * button. Tapping the row itself deep-links to the project board scoped to
 * this area via ?area=<area_code>.
 *
 * Converted to "use client" to support the expand toggle — previously a server
 * component with no interactivity. Min height ≥44px for touch.
 */
export function RoomRow({
  room,
  projectCode,
  now,
  stepView,
  stepEvents,
  autoExpand,
  autoOpenStepId,
}: {
  room: Room;
  projectCode: string;
  now: number;
  stepView?: StepView;
  stepEvents?: StepEvents;
  /** Pre-expand this row on mount (from a ?areaStep= deep link — see rooms/page.tsx). */
  autoExpand?: boolean;
  /** Step id within this room's panel to auto-open, same deep link. */
  autoOpenStepId?: string;
}) {
  const [expanded, setExpanded] = useState(autoExpand ?? false);
  const rel = relativeTimeId(room.lastActivityAt, now);
  const hasSteps = (stepView?.steps.length ?? 0) > 0;

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      {/* ── Header row ──────────────────────────────────────────────────── */}
      <div className="flex min-h-[56px] items-center gap-1 bg-[var(--surface)]">
        {/* Clickable summary — links to board */}
        <Link
          href={`/project/${projectCode}?area=${encodeURIComponent(room.areaCode)}`}
          className="flex min-h-[56px] flex-1 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--surface-alt)] active:bg-[var(--surface-alt)]"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-[#141210]">{room.areaName}</span>
              {room.floor ? (
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-[#7A6B56]">
                  {room.floor}
                </span>
              ) : null}
              {room.blockers > 0 ? (
                <span className="shrink-0 rounded bg-[rgba(198,40,40,0.10)] px-1.5 py-0.5 text-[10px] font-bold text-[#C62828]">
                  {room.blockers} blocker
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <StageChip stage={room.stage} />
              {rel ? <span className="text-[11px] text-[var(--text-muted)]">{rel}</span> : null}
            </div>
            <p className={`mt-1 truncate text-[11px] ${ACTION_TONE[room.action.tone]}`}>
              {room.action.text}
            </p>
          </div>
        </Link>

        {/* Expand toggle — only shown when step data is available */}
        {stepView ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Tutup langkah" : "Lihat langkah"}
            onClick={() => setExpanded((v) => !v)}
            className="flex min-h-[56px] shrink-0 items-center px-3 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)] active:bg-[var(--surface-alt)] md:min-h-0"
          >
            <span className="text-xs font-medium">
              {expanded ? "▾" : "▸"}{" "}
              <span className="hidden sm:inline">Langkah</span>
            </span>
          </button>
        ) : (
          <span aria-hidden="true" className="shrink-0 px-3 text-[var(--text-muted)]">
            ›
          </span>
        )}
      </div>

      {/* ── Expanded step panel ─────────────────────────────────────────── */}
      {expanded && stepView && hasSteps ? (
        <div>
          <RoomStepsPanel areaId={room.areaId} view={stepView} stepEvents={stepEvents} autoOpenStepId={autoOpenStepId} />
          <div className="flex justify-end border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2">
            <RoomAssistantButton areaName={room.areaName} view={stepView} />
          </div>
        </div>
      ) : expanded && stepView && !hasSteps ? (
        <p className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[12px] text-[var(--text-muted)]">
          Tidak ada langkah untuk ruangan ini.
        </p>
      ) : null}
    </div>
  );
}
