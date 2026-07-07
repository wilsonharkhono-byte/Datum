"use client";
import type { CardEventKind } from "@datum/db";

const KIND_LABELS: Record<CardEventKind, string> = {
  // Active kinds
  decision:        "keputusan",
  drawing:         "gambar",
  vendor:          "vendor",
  material:        "material",
  work:            "kerja",
  photo:           "foto",
  document:        "dokumen",
  client_request:  "permintaan klien",
  note:            "catatan",
  // Retired kinds (still in DB enum, so the Record type requires entries;
  // never offered as chips — see KIND_ORDER)
  survey:          "survei (lama)",
  vendor_quote:    "quote vendor (lama)",
  vendor_pick:     "vendor dipilih (lama)",
  worker_assigned: "tukang (lama)",
  progress:        "progres (lama)",
  defect:          "defect (lama)",
  pending:         "menunggu (lama)",
};

// Only the 9 current kinds are offered as filter chips. Retired kinds stay
// renderable in the timeline (EventRow) — they're shown by default because
// the active set starts as "all available" — but get no chip of their own.
const KIND_ORDER: CardEventKind[] = [
  "note","decision","drawing","vendor","material","work",
  "client_request","photo","document",
];

export function TimelineFilter({
  active,
  available,
  onActiveChange,
  onAll,
  onNone,
}: {
  active: Set<CardEventKind>;
  available: Set<CardEventKind>; // kinds that actually exist on this card
  onActiveChange: (s: Set<CardEventKind>) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  // Only render chips for kinds present in this card's events
  const shown = KIND_ORDER.filter((k) => available.has(k));
  if (shown.length === 0) return null;

  function toggle(k: CardEventKind) {
    const next = new Set(active);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onActiveChange(next);
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sand-dark)]">filter</span>
      {shown.map((k) => {
        const on = active.has(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            aria-label={`Filter ${KIND_LABELS[k]}${on ? " (aktif)" : ""}`}
            aria-pressed={on}
            className={`chip${on ? " chip-sand" : ""}`}
          >
            {KIND_LABELS[k]}
          </button>
        );
      })}
      <div className="ml-2 flex gap-2">
        <button
          type="button"
          onClick={onAll}
          aria-label="Tampilkan semua jenis aktivitas"
          className="rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--sand-dark)] hover:underline"
        >
          semua
        </button>
        <button
          type="button"
          onClick={onNone}
          aria-label="Sembunyikan semua jenis aktivitas"
          className="rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--sand-dark)] hover:underline"
        >
          tidak ada
        </button>
      </div>
    </div>
  );
}
