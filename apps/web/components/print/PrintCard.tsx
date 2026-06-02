import type { Card, CardEvent } from "@datum/db";
import { PrintEventList } from "./PrintEventList";

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  dormant: "Tertunda",
  closed: "Selesai",
};

export function PrintCard({
  card,
  events,
  topicName,
}: {
  card: Card;
  events: CardEvent[];
  topicName?: string;
}) {
  return (
    <section className="print-break-avoid mb-6 border-b border-stone-300 pb-4">
      <header className="mb-2">
        <div className="text-[9pt] uppercase tracking-wide text-stone-500">
          {topicName ?? ""}
        </div>
        <h2 className="text-lg font-semibold text-stone-900">{card.title}</h2>
        <div className="mt-1 flex flex-wrap gap-3 text-[9pt] text-stone-600">
          <span>Status: {STATUS_LABEL[card.status as string] ?? card.status}</span>
          {card.last_event_at ? (
            <span>Aktivitas terakhir: {new Date(card.last_event_at).toLocaleDateString("id-ID")}</span>
          ) : null}
        </div>
        {card.current_summary ? (
          <p className="mt-2 text-sm text-stone-800">{card.current_summary}</p>
        ) : null}
      </header>
      <PrintEventList events={events} />
    </section>
  );
}
