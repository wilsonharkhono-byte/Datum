"use client";
import { useMemo, useState } from "react";
import type { CardEvent, CardAttachment, CardEventKind } from "@datum/db";
import { EventRow } from "./EventRow";
import { TimelineFilter } from "./TimelineFilter";

export function Timeline({
  events,
  attachmentsByEvent,
}: {
  events: CardEvent[];
  attachmentsByEvent: Map<string, CardAttachment[]>;
}) {
  // Available kinds = those actually present on this card
  const available = useMemo(() => {
    const s = new Set<CardEventKind>();
    for (const e of events) s.add(e.event_kind as CardEventKind);
    return s;
  }, [events]);

  // Default active = all available
  const [active, setActive] = useState<Set<CardEventKind>>(() => new Set(available));

  // When events change (revalidate), refresh active set to include any new kinds
  // (don't reset existing exclusions — only ADD kinds that just appeared)
  useMemo(() => {
    setActive((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const k of available) {
        if (!next.has(k)) {
          // If user had everything selected before, keep adding; otherwise leave them out
          // Heuristic: if prev is empty, leave; otherwise add any new kind so users don't miss new activity
          if (next.size > 0) {
            next.add(k);
            changed = true;
          }
        }
      }
      // Also remove from active any kind no longer available
      for (const k of [...next]) {
        if (!available.has(k)) { next.delete(k); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [available]);

  const visible = useMemo(
    () => events.filter((e) => active.has(e.event_kind as CardEventKind)),
    [events, active],
  );

  if (events.length === 0) {
    return <p className="mt-6 italic text-stone-500">Belum ada aktivitas tercatat.</p>;
  }

  return (
    <div>
      <TimelineFilter
        active={active}
        available={available}
        onActiveChange={setActive}
        onAll={() => setActive(new Set(available))}
        onNone={() => setActive(new Set())}
      />
      {visible.length === 0 ? (
        <p className="mt-4 italic text-stone-500">Tidak ada aktivitas yang cocok dengan filter.</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {visible.map((ev) => (
            <EventRow key={ev.id} event={ev} attachments={attachmentsByEvent.get(ev.id) ?? []} />
          ))}
        </ol>
      )}
      {visible.length > 0 && visible.length !== events.length ? (
        <p className="mt-3 text-[10px] italic text-[#847E78]">
          {visible.length} dari {events.length} aktivitas (klik chip "semua" untuk reset filter).
        </p>
      ) : null}
    </div>
  );
}
