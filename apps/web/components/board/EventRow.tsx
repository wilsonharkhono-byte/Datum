import type { CardEvent, CardAttachment } from "@datum/db";
import { HIGH_RISK_KINDS, isDecisionOpen, isClientRequestOpen, type EventKind } from "@datum/types";
import { resolveCardEvent } from "@/lib/cards/mutations";
import { summarize, extractUrls, looksLikeImage, safeHostname } from "@datum/core";
import { aiResultLine, isUnlinkedCardHint } from "@/lib/cards/ai-result-line";
import { EventAttachments } from "./EventAttachments";

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

export function EventRow({
  event,
  attachments,
  projectCode,
  cardSlug,
  aiStepNames,
}: {
  event: CardEvent;
  attachments: CardAttachment[];
  projectCode: string;
  cardSlug: string;
  /** Step names the AI wrote off the back of this event (empty when none/not applicable). */
  aiStepNames?: string[];
}) {
  const urls = extractUrls(event.payload as Record<string, unknown>);
  const isHighRisk = HIGH_RISK_KINDS.has(event.event_kind as EventKind);
  const resultLine = aiResultLine(event.ai_step_status, event.ai_step_error, aiStepNames ?? []);
  return (
    <li className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
      {/* Mobile: stacks — a meta line (kind + date) above a full-width summary,
          with the badge/action wrapping below. md+: restores the columnar row
          via `md:contents`, which dissolves the meta wrapper so the kind and
          date spans flow as fixed columns again. */}
      <div className="flex flex-col gap-1 md:flex-row md:gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 md:contents">
          <span className="text-[11px] uppercase tracking-wide text-[var(--sand-dark)] md:w-24 md:flex-shrink-0">
            {KIND_LABEL[event.event_kind] ?? event.event_kind}
          </span>
          <span className="text-[11px] text-[var(--text-secondary)] md:w-24 md:flex-shrink-0">
            {new Date(event.occurred_at).toLocaleDateString("id-ID", { year: "2-digit", month: "short", day: "numeric" })}
          </span>
        </div>
        <span className="min-w-0 flex-1 break-words text-[var(--foreground)]">{summarize(event)}</span>
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
        <div className="mt-1 flex flex-wrap gap-1.5 md:ml-[12.5rem]">
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
      <EventAttachments attachments={attachments} projectCode={projectCode} cardSlug={cardSlug} />
      {resultLine ? (
        <p className="mt-1 text-[10px] italic text-[var(--text-muted)] md:ml-[12.5rem]">
          {isUnlinkedCardHint(event.ai_step_status, event.ai_step_error) ? (
            <>
              AI: kartu belum tertaut ke ruangan —{" "}
              <a href="#areas-terkait" className="not-italic underline hover:no-underline">
                tautkan agar progres terbaca
              </a>
            </>
          ) : (
            resultLine
          )}
        </p>
      ) : null}
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
