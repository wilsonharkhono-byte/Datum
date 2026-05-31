import type { Card } from "@datum/db";

export function CardHeader({ card }: { card: Card }) {
  return (
    <header className="mt-2 border-b border-stone-200 pb-3">
      <h1 className="text-xl font-semibold text-stone-900">{card.title}</h1>
      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-stone-600">
        <span className="rounded bg-stone-200 px-2 py-0.5 uppercase tracking-wide">{card.status}</span>
        {card.last_event_at ? (
          <span>terakhir: {new Date(card.last_event_at).toLocaleDateString("id-ID")}</span>
        ) : null}
      </div>
      {card.current_summary ? (
        <p className="mt-2 text-sm text-stone-700">{card.current_summary}</p>
      ) : null}
    </header>
  );
}
