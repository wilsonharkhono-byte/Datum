"use client";
import { useState, useTransition } from "react";
import { createCardEvent, attachToEvent } from "@/lib/cards/mutations";
import { uploadCardAttachment } from "@/lib/cards/upload";
import { HIGH_RISK_KINDS, type EventKind } from "@datum/types";
import { CheckIcon, XIcon, PaperclipIcon } from "@/components/icons/Icon";

export type Proposal = {
  projectId:  string;
  cardId:     string;
  cardTitle:  string;
  cardSlug:   string;
  topicName:  string;
  eventKind:  string;
  payload:    Record<string, unknown>;
  rationale:  string;
  confidence: number;
  projectCode: string;
  fileMeta?:  { name: string; mime: string; size: number } | null;
  pendingFile?: File;
};

const KIND_LABELS: Record<string, string> = {
  decision:       "keputusan",
  drawing:        "gambar",
  vendor:         "vendor",
  material:       "material",
  work:           "kerja",
  photo:          "foto",
  document:       "dokumen",
  client_request: "permintaan klien",
  note:           "catatan",
  // Retired — kept so in-flight historical proposals still render
  survey:         "survei (lama)",
  vendor_quote:   "quote vendor (lama)",
  vendor_pick:    "vendor dipilih (lama)",
  worker_assigned:"tukang (lama)",
  progress:       "progres (lama)",
  defect:         "defect (lama)",
  pending:        "menunggu (lama)",
};

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [status, setStatus] = useState<"pending" | "saving" | "saved" | "discarded" | "error">("pending");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const isHighRisk = HIGH_RISK_KINDS.has(proposal.eventKind as EventKind);

  function commit() {
    setError(null);
    setStatus("saving");

    startTransition(async () => {
      // Always commit directly to the card. High-risk kinds get a label
      // (rendered via the timeline chip + a notification to principals),
      // not a draft gate. The principal can edit/delete the event from
      // the card if AI got it wrong.
      const fd = new FormData();
      fd.set("cardId",      proposal.cardId);
      fd.set("projectId",   proposal.projectId);
      fd.set("projectCode", proposal.projectCode);
      fd.set("cardSlug",    proposal.cardSlug);
      fd.set("eventKind",   proposal.eventKind);
      for (const [k, v] of Object.entries(proposal.payload)) {
        const value = Array.isArray(v)
          ? v.join(",")
          : v == null
          ? ""
          : String(v);
        fd.set(`payload_${k}`, value);
      }
      if (proposal.rationale && proposal.rationale.trim().length > 0) {
        fd.set("payload_ai_rationale", proposal.rationale);
      }
      const res = await createCardEvent(fd);
      if (!res.ok) {
        setStatus("error");
        setError(res.error);
        return;
      }
      // Upload pending file if present
      if (proposal.pendingFile) {
        const up = await uploadCardAttachment({
          file: proposal.pendingFile,
          projectId: proposal.projectId,
          cardId: proposal.cardId,
          cardEventId: res.eventId,
        });
        if (!up.ok) {
          setStatus("error");
          setError(`Event tersimpan tapi upload gagal: ${up.error}`);
          return;
        }
        const aFd = new FormData();
        aFd.set("cardEventId", res.eventId);
        aFd.set("projectCode", proposal.projectCode);
        aFd.set("cardSlug", proposal.cardSlug);
        aFd.set("storagePath", up.storagePath);
        aFd.set("mimeType", up.mimeType);
        const a = await attachToEvent(aFd);
        if (!a.ok) {
          setStatus("error");
          setError(`Event tersimpan tapi simpan lampiran gagal: ${a.error}`);
          return;
        }
      }
      setStatus("saved");
    });
  }

  function discard() {
    setStatus("discarded");
  }

  const conf = Math.round(proposal.confidence * 100);
  const confColor =
    conf >= 80 ? "text-[var(--flag-ok)]" : conf >= 50 ? "text-[var(--sand-dark)]" : "text-[var(--flag-critical)]";

  return (
    <div className="max-w-[85%] rounded-md border border-[var(--sand)] bg-[var(--sand-tint)] p-3 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <div className="font-semibold text-foreground">
          → {proposal.cardTitle}
          <span className="ml-1 font-normal text-[var(--text-muted)]">· {proposal.topicName}</span>
        </div>
        <span className={`text-[10px] font-semibold uppercase ${confColor}`}>{conf}% yakin</span>
      </div>
      <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">
        {KIND_LABELS[proposal.eventKind] ?? proposal.eventKind}
      </div>
      {proposal.fileMeta || proposal.pendingFile ? (
        <div className="mb-2 inline-flex items-center gap-1.5 rounded border border-[var(--sand)] bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
          <PaperclipIcon size={11} />
          <span>{proposal.fileMeta?.name ?? proposal.pendingFile?.name} — akan diupload setelah simpan</span>
        </div>
      ) : null}
      <pre className="mb-2 max-h-20 overflow-y-auto whitespace-pre-wrap rounded border border-[var(--sand)] bg-[var(--surface)] p-2 text-[10px] text-foreground">
        {JSON.stringify(proposal.payload, null, 2)}
      </pre>
      {proposal.rationale ? (
        <p className="mb-2 text-[10px] italic text-[var(--text-secondary)]">"{proposal.rationale}"</p>
      ) : null}
      {isHighRisk ? (
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--flag-high-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--flag-high)]">
          Berisiko tinggi · principal akan dinotifikasi
        </div>
      ) : null}
      {error ? <div className="mb-2 text-[10px] text-[var(--flag-critical)]">{error}</div> : null}
      {status === "pending" || status === "error" ? (
        <div className="sticky bottom-0 -mx-3 -mb-3 flex gap-2 border-t border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 backdrop-blur-sm">
          <button
            type="button"
            onClick={commit}
            aria-label="Simpan proposal ke kartu"
            className="inline-flex items-center gap-1.5 rounded bg-foreground px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white shadow-[0_2px_6px_-1px_rgba(122,107,86,0.4)] hover:bg-[var(--sand-dark)]"
          >
            <CheckIcon size={13} /> Simpan ke kartu
          </button>
          <button
            type="button"
            onClick={discard}
            aria-label="Batalkan proposal"
            className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--text-secondary)]"
          >
            <XIcon size={12} /> Batal
          </button>
        </div>
      ) : status === "saving" ? (
        <div className="text-[10px] text-[var(--text-secondary)]">Menyimpan…</div>
      ) : status === "saved" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded bg-[var(--flag-ok-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--flag-ok)]">
            <CheckIcon size={11} />
            {isHighRisk ? "Tersimpan di kartu · principal dinotifikasi" : "Tersimpan di kartu"}
          </span>
          <a
            href={`/project/${proposal.projectCode}/cards/${proposal.cardSlug}`}
            className="inline-flex items-center gap-1 rounded border border-[var(--sand)] bg-[var(--surface)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--sand-dark)] hover:border-[var(--sand-dark)] hover:bg-[var(--sand-tint)]"
            aria-label={`Buka kartu ${proposal.cardTitle}`}
          >
            → Buka {proposal.cardTitle}
          </a>
        </div>
      ) : (
        <div className="text-[10px] text-[var(--text-muted)]">Dibatalkan.</div>
      )}
    </div>
  );
}
