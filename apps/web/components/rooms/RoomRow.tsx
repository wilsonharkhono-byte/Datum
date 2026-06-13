import Link from "next/link";
import type { Room } from "@/lib/rooms/derive";
import { relativeTimeId } from "@/lib/rooms/derive";
import { StageChip } from "./StageChip";

const ACTION_TONE: Record<Room["action"]["tone"], string> = {
  urgent: "text-[#C62828]",
  active: "text-[#7A6B56]",
  ready: "text-[#1565C0]",
  idle: "text-[var(--text-muted)]",
};

/**
 * One tappable room row. Tapping deep-links to the project board scoped to this
 * area via ?area=<area_code> — the board already groups cards by topic column,
 * so the area param is the natural hook for narrowing to a room's cards. The
 * board ignores the param today (board filtering is owned elsewhere); the link
 * degrades to the normal board until that lands. Min height ≥44px for touch.
 */
export function RoomRow({ room, projectCode, now }: { room: Room; projectCode: string; now: number }) {
  const rel = relativeTimeId(room.lastActivityAt, now);
  return (
    <Link
      href={`/project/${projectCode}?area=${encodeURIComponent(room.areaCode)}`}
      className="flex min-h-[56px] items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--surface-alt)] active:bg-[var(--surface-alt)]"
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
      <span aria-hidden="true" className="shrink-0 text-[var(--text-muted)]">
        ›
      </span>
    </Link>
  );
}
