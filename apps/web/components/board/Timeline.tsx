"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CardEvent, CardAttachment, CardEventKind } from "@datum/db";
import { EventRow } from "./EventRow";
import { TimelineFilter } from "./TimelineFilter";

export function Timeline({
  events,
  attachmentsByEvent,
  projectCode,
  cardSlug,
}: {
  events: CardEvent[];
  attachmentsByEvent: Map<string, CardAttachment[]>;
  projectCode: string;
  cardSlug: string;
}) {
  const router = useRouter();

  const cardId = events[0]?.card_id; // all events belong to the same card
  useEffect(() => {
    if (!cardId) return;
    const supabase = createSupabaseBrowserClient();
    const ch = supabase
      .channel(`card-events:${cardId}`)
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "card_events", filter: `card_id=eq.${cardId}` },
        () => router.refresh(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [cardId, router]);

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
    return (
      <div className="mt-6 rounded border border-dashed border-[var(--border)] p-6">
        <p className="italic text-[var(--text-secondary)]">Belum ada aktivitas tercatat.</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Klik &ldquo;+ tambah aktivitas&rdquo; di atas untuk mencatat keputusan, gambar, vendor, atau item lainnya.
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Atau gunakan Asisten (mode Catat) untuk mencatat lebih cepat.
        </p>
      </div>
    );
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
        <p className="mt-4 italic text-[var(--text-muted)]">Tidak ada aktivitas yang cocok dengan filter.</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {visible.map((ev) => (
            <EventRow
              key={ev.id}
              event={ev}
              attachments={attachmentsByEvent.get(ev.id) ?? []}
              projectCode={projectCode}
              cardSlug={cardSlug}
            />
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
