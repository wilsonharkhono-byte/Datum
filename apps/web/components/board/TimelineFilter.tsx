"use client";
import type { CardEventKind } from "@datum/db";

const KIND_LABELS: Record<CardEventKind, string> = {
  decision:        "keputusan",
  drawing:         "gambar",
  survey:          "survei",
  vendor_quote:    "quote vendor",
  vendor_pick:     "vendor",
  material:        "material",
  worker_assigned: "tukang",
  progress:        "progres",
  defect:          "defect",
  photo:           "foto",
  document:        "dokumen",
  client_request:  "permintaan klien",
  note:            "catatan",
  pending:         "menunggu",
};

const KIND_ORDER: CardEventKind[] = [
  "decision","drawing","survey","vendor_quote","vendor_pick",
  "material","worker_assigned","progress","defect","photo",
  "document","client_request","note","pending",
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
    <div className="mt-3 flex flex-wrap items-center gap-1 text-[10px]">
      <span className="mr-1 font-semibold uppercase tracking-wide text-[#7A6B56]">filter:</span>
      {shown.map((k) => {
        const on = active.has(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            className={
              "rounded border px-2 py-0.5 font-semibold uppercase tracking-wide " +
              (on
                ? "border-[var(--sand-dark)] bg-[var(--sand-tint)] text-[var(--sand-dark)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--text-secondary)]")
            }
          >
            {KIND_LABELS[k]}
          </button>
        );
      })}
      <div className="ml-2 flex gap-1">
        <button
          type="button"
          onClick={onAll}
          className="rounded px-2 py-0.5 text-[10px] text-[#7A6B56] hover:underline"
        >
          semua
        </button>
        <button
          type="button"
          onClick={onNone}
          className="rounded px-2 py-0.5 text-[10px] text-[#7A6B56] hover:underline"
        >
          tidak ada
        </button>
      </div>
    </div>
  );
}
