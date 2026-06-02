import Link from "next/link";
import type { Card } from "@datum/db";

export function MiniCard({ card, projectCode }: { card: Card; projectCode: string }) {
  return (
    <Link
      href={`/project/${projectCode}/cards/${card.slug}`}
      className="block rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs hover:border-[var(--sand-dark)]"
    >
      <div className="font-medium text-foreground">{card.title}</div>
      {card.current_summary ? (
        <div className="mt-0.5 line-clamp-2 text-[10px] text-[var(--text-secondary)]">{card.current_summary}</div>
      ) : null}
      {card.last_event_at ? (
        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
          {new Date(card.last_event_at).toLocaleDateString("id-ID", { year: "numeric", month: "short", day: "numeric" })}
        </div>
      ) : null}
    </Link>
  );
}
