import Link from "next/link";
import { TrelloIcon } from "@/components/icons/Icon";
import { LABEL_STYLE } from "@/lib/cards/labels";
import type { CardDeadline } from "@/lib/gates/board-deadlines";
import type { BoardCardView } from "@/lib/cards/optimisticBoard";

export function MiniCard({ card, projectCode }: { card: BoardCardView; projectCode: string }) {
  const inner = (
    <>
      {card.labels.length > 0 || card.deadline ? (
        <div className="mb-1 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <span
              key={`${l.kind}-${l.label}`}
              className="inline-flex items-center rounded-sm px-1.5 py-px text-[8.5px] font-bold uppercase tracking-[0.06em] leading-tight"
              style={{ background: LABEL_STYLE[l.kind].bg, color: LABEL_STYLE[l.kind].fg }}
              title={l.label}
            >
              {l.label}
            </span>
          ))}
          {card.deadline ? <DeadlineChip deadline={card.deadline} /> : null}
        </div>
      ) : null}
      <div className="font-medium text-foreground">{card.title}</div>
      {card.current_summary ? (
        <div className="mt-0.5 line-clamp-2 text-[10px] text-[var(--text-secondary)]">{card.current_summary}</div>
      ) : null}
      {card.last_event_at ? (
        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
          {new Date(card.last_event_at).toLocaleDateString("id-ID", { year: "numeric", month: "short", day: "numeric" })}
        </div>
      ) : null}
      {(card.properties as { trello_card_id?: string } | null)?.trello_card_id ? (
        <div className="mt-1 inline-flex items-center gap-1 rounded bg-[var(--surface-alt)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
          <TrelloIcon size={10} />
          <span>Trello</span>
        </div>
      ) : null}
    </>
  );

  if (card.__optimistic) {
    return (
      <div
        aria-busy="true"
        className="block min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs opacity-70 md:min-h-0"
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={`/project/${projectCode}/cards/${card.slug}`}
      className="block min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs hover:border-[var(--sand-dark)] md:min-h-0"
    >
      {inner}
    </Link>
  );
}

/** Compact gate-deadline chip: "B lewat 3 hari" / "B hari ini" / "B · 12 hari". */
function DeadlineChip({ deadline }: { deadline: CardDeadline }) {
  // Use WIB (Asia/Jakarta) calendar-day semantics so "hari ini" holds all day
  // and "lewat" only flips at WIB midnight, not UTC midnight (~07:00 WIB).
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const daysLeft = Math.round(
    (Date.parse(deadline.targetEndDate) - Date.parse(todayStr)) / 86_400_000,
  );
  const overdue = daysLeft < 0;
  const urgent = !overdue && daysLeft <= 14;
  const style = overdue
    ? { background: "var(--flag-critical-bg)", color: "var(--flag-critical)" }
    : urgent
      ? { background: "var(--flag-warning-bg)", color: "var(--flag-warning)" }
      : { background: "var(--sand-tint)", color: "var(--sand-dark)" };
  const text = overdue
    ? `${deadline.gateCode} lewat ${-daysLeft} hari`
    : daysLeft === 0
      ? `${deadline.gateCode} hari ini`
      : `${deadline.gateCode} · ${daysLeft} hari`;
  return (
    <span
      className="inline-flex items-center rounded-sm px-1.5 py-px text-[8.5px] font-bold uppercase tracking-[0.06em] leading-tight"
      style={style}
      title={`Target gate ${deadline.gateCode}: ${deadline.targetEndDate}`}
    >
      {text}
    </span>
  );
}
