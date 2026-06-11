import type { CardEvent, CardAttachment } from "@datum/db";
import { HIGH_RISK_KINDS, isDecisionOpen, isClientRequestOpen, type EventKind } from "@datum/types";
import { resolveCardEvent } from "@/lib/cards/mutations";
import { valueLabel } from "@/lib/cards/payload-render";
import { EventAttachments } from "./EventAttachments";

function extractUrls(payload: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const urlRe = /(https?:\/\/[^\s"'<>)]+)/g;
  for (const v of Object.values(payload)) {
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(urlRe)) urls.push(m[1]!);
  }
  return [...new Set(urls)]; // dedup
}

function looksLikeImage(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|heic|heif)(\?|$)/i.test(url);
}

function safeHostname(u: string): string {
  try { return new URL(u).hostname; } catch { return u.slice(0, 30) + "…"; }
}

const KIND_LABEL: Record<string, string> = {
  decision: "keputusan",
  drawing: "gambar",
  vendor: "vendor",
  material: "material",
  work: "kerja",
  photo: "foto",
  document: "dokumen",
  client_request: "permintaan klien",
  note: "catatan",
  // Retired but might still appear in case of edge cases
  survey: "survei (lama)",
  vendor_quote: "quote vendor (lama)",
  vendor_pick: "vendor dipilih (lama)",
  worker_assigned: "tukang (lama)",
  progress: "progres (lama)",
  defect: "defect (lama)",
  pending: "menunggu (lama)",
};

function summarize(ev: CardEvent): string {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.event_kind) {
    case "decision":        return `${String(p.topic)} — ${String(p.proposed_spec ?? p.current_spec ?? "")}`;
    case "drawing":         return String(p.description ?? p.drawing_code ?? "");
    case "vendor": {
      const verb = p.interaction === "quote" ? "Quote dari"
                 : p.interaction === "pick" ? "Pilih"
                 : p.interaction === "survey" ? "Survei oleh"
                 : p.interaction === "contract" ? "Kontrak dengan"
                 : "Interaksi";
      const amount = typeof p.amount === "number" ? ` · Rp ${p.amount.toLocaleString("id-ID")}` : "";
      return `${verb} ${p.vendor_name ?? ""}${amount}`;
    }
    case "material":        return `${String(p.item)} — ${valueLabel(String(p.status))}`;
    case "work": {
      const status = valueLabel((p.status as string) ?? "?");
      const who = typeof p.worker_name === "string" && p.worker_name.length > 0 ? `${p.worker_name} · ` : "";
      const desc = typeof p.description === "string" ? p.description
                 : typeof p.scope === "string" ? p.scope
                 : "";
      const pct = typeof p.percent_complete === "number" ? ` (${p.percent_complete}%)` : "";
      return `${who}${status}${pct}${desc ? " — " + desc : ""}`;
    }
    case "photo":           return String(p.caption ?? "(foto)");
    case "document":        return String(p.title);
    case "client_request":  return String(p.request_text);
    case "note":            return String(p.body);
    // Retired kinds — kept for historical event display
    case "survey":          return [p.vendor_name, p.location].filter(Boolean).map(String).join(" · ");
    case "vendor_quote":    return `${String(p.vendor_name)} · Rp ${(p.amount as number).toLocaleString("id-ID")}`;
    case "vendor_pick":     return String(p.vendor_name);
    case "worker_assigned": return `${String(p.worker_name)}${p.scope ? ` — ${String(p.scope)}` : ""}`;
    case "progress":        return `${String(p.status)}${p.percent_complete != null ? ` (${String(p.percent_complete)}%)` : ""}`;
    case "defect":          return `${String(p.severity)} · ${String(p.description)}`;
    case "pending":         return String(p.what);
    default:                return JSON.stringify(p);
  }
}

export function EventRow({
  event,
  attachments,
  projectCode,
  cardSlug,
}: {
  event: CardEvent;
  attachments: CardAttachment[];
  projectCode: string;
  cardSlug: string;
}) {
  const urls = extractUrls(event.payload as Record<string, unknown>);
  const isHighRisk = HIGH_RISK_KINDS.has(event.event_kind as EventKind);
  return (
    <li className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
      <div className="flex gap-3">
        <span className="w-24 flex-shrink-0 text-[11px] uppercase tracking-wide text-[var(--sand-dark)]">
          {KIND_LABEL[event.event_kind] ?? event.event_kind}
        </span>
        <span className="w-24 flex-shrink-0 text-[11px] text-[var(--text-secondary)]">
          {new Date(event.occurred_at).toLocaleDateString("id-ID", { year: "2-digit", month: "short", day: "numeric" })}
        </span>
        <span className="flex-1 text-[var(--foreground)]">{summarize(event)}</span>
        {isHighRisk ? (
          <span
            className="inline-flex flex-shrink-0 items-center gap-1 self-start rounded-full bg-[var(--flag-high-bg)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--flag-high)]"
            title="Catatan berisiko tinggi — principal sudah dinotifikasi"
          >
            Berisiko tinggi
          </span>
        ) : null}
        <ResolveAction event={event} projectCode={projectCode} cardSlug={cardSlug} />
      </div>
      {urls.length > 0 ? (
        <div className="ml-[12.5rem] mt-1 flex flex-wrap gap-1.5">
          {urls.map((u) => (
            <a
              key={u}
              href={u}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-0.5 text-[10px] font-medium text-[var(--sand-dark)] hover:border-[var(--sand-dark)]"
              aria-label={`Buka tautan: ${u}`}
            >
              {looksLikeImage(u) ? "🖼" : "🔗"} {safeHostname(u)}
            </a>
          ))}
        </div>
      ) : null}
      <EventAttachments attachments={attachments} />
    </li>
  );
}

/** One-click resolution for open-loop events. Renders nothing for events
 *  that are already resolved or have no lifecycle. */
function ResolveAction({
  event,
  projectCode,
  cardSlug,
}: {
  event: CardEvent;
  projectCode: string;
  cardSlug: string;
}) {
  const p = event.payload as Record<string, unknown>;
  let newStatus: "decided" | "answered" | null = null;
  let label = "";
  if (
    event.event_kind === "decision" &&
    isDecisionOpen(p as { status?: string; approved_by?: string })
  ) {
    newStatus = "decided";
    label = "Tandai diputuskan";
  } else if (
    event.event_kind === "client_request" &&
    isClientRequestOpen(p as { status?: string })
  ) {
    newStatus = "answered";
    label = "Tandai terjawab";
  }
  if (!newStatus) return null;
  return (
    <form
      action={async (fd: FormData) => {
        const res = await resolveCardEvent(fd);
        if (!res.ok) alert(`Gagal menandai: ${res.error}`);
      }}
      className="flex-shrink-0 self-start"
    >
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="projectCode" value={projectCode} />
      <input type="hidden" name="cardSlug" value={cardSlug} />
      <input type="hidden" name="newStatus" value={newStatus} />
      <button
        type="submit"
        className="rounded border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-0.5 text-[10px] font-medium text-[var(--sand-dark)] hover:border-[var(--sand-dark)]"
      >
        {label}
      </button>
    </form>
  );
}
