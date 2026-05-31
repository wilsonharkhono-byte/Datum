import type { CardEvent } from "@datum/db";
import { EventRow } from "./EventRow";

export function Timeline({ events }: { events: CardEvent[] }) {
  if (events.length === 0) {
    return <p className="mt-6 italic text-stone-500">Belum ada aktivitas tercatat.</p>;
  }
  return (
    <ol className="mt-4 space-y-2">
      {events.map((ev) => <EventRow key={ev.id} event={ev} />)}
    </ol>
  );
}
