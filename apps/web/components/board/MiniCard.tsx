import Link from "next/link";
import { TrelloIcon } from "@/components/icons/Icon";
import { LABEL_STYLE, type CardWithLabels } from "@/lib/cards/labels";

export function MiniCard({ card, projectCode }: { card: CardWithLabels; projectCode: string }) {
  return (
    <Link
      href={`/project/${projectCode}/cards/${card.slug}`}
      className="block rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs hover:border-[var(--sand-dark)]"
    >
      {card.labels.length > 0 ? (
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
    </Link>
  );
}
