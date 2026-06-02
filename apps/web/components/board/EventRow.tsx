import type { CardEvent, CardAttachment } from "@datum/db";
import { EventAttachments } from "./EventAttachments";

const KIND_LABEL: Record<string, string> = {
  decision: "keputusan",
  drawing: "gambar",
  survey: "survei",
  vendor_quote: "quote vendor",
  vendor_pick: "vendor dipilih",
  material: "material",
  worker_assigned: "tukang",
  progress: "progres",
  defect: "defect",
  photo: "foto",
  document: "dokumen",
  client_request: "permintaan klien",
  note: "catatan",
  pending: "menunggu",
};

function summarize(ev: CardEvent): string {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.event_kind) {
    case "decision":        return `${String(p.topic)} — ${String(p.proposed_spec ?? p.current_spec ?? "")}`;
    case "drawing":         return String(p.description ?? p.drawing_code ?? "");
    case "survey":          return [p.vendor_name, p.location].filter(Boolean).map(String).join(" · ");
    case "vendor_quote":    return `${String(p.vendor_name)} · Rp ${(p.amount as number).toLocaleString("id-ID")}`;
    case "vendor_pick":     return String(p.vendor_name);
    case "material":        return `${String(p.item)} — ${String(p.status)}`;
    case "worker_assigned": return `${String(p.worker_name)}${p.scope ? ` — ${String(p.scope)}` : ""}`;
    case "progress":        return `${String(p.status)}${p.percent_complete != null ? ` (${String(p.percent_complete)}%)` : ""}`;
    case "defect":          return `${String(p.severity)} · ${String(p.description)}`;
    case "photo":           return String(p.caption ?? "(foto)");
    case "document":        return String(p.title);
    case "client_request":  return String(p.request_text);
    case "note":            return String(p.body);
    case "pending":         return String(p.what);
    default:                return JSON.stringify(p);
  }
}

export function EventRow({
  event,
  attachments,
}: {
  event: CardEvent;
  attachments: CardAttachment[];
}) {
  return (
    <li className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
      <div className="flex gap-3">
        <span className="w-24 flex-shrink-0 text-[11px] uppercase tracking-wide text-[var(--sand-dark)]">
          {KIND_LABEL[event.event_kind] ?? event.event_kind}
        </span>
        <span className="w-24 flex-shrink-0 text-[11px] text-[var(--text-muted)]">
          {new Date(event.occurred_at).toLocaleDateString("id-ID", { year: "2-digit", month: "short", day: "numeric" })}
        </span>
        <span className="flex-1 text-foreground">{summarize(event)}</span>
      </div>
      <EventAttachments attachments={attachments} />
    </li>
  );
}
