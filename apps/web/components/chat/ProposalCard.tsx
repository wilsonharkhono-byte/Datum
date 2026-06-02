"use client";
import { useState, useTransition } from "react";
import { createCardEvent, attachToEvent, createCardEventDraft } from "@/lib/cards/mutations";
import { uploadCardAttachment } from "@/lib/cards/upload";
import { HIGH_RISK_KINDS, type EventKind } from "@datum/types";

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
  survey:         "survei",
  vendor_quote:   "quote vendor",
  vendor_pick:    "vendor dipilih",
  material:       "material",
  worker_assigned:"tukang",
  progress:       "progres",
  defect:         "defect",
  photo:          "foto",
  document:       "dokumen",
  client_request: "permintaan klien",
  note:           "catatan",
  pending:        "menunggu",
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
      if (isHighRisk) {
        // High-risk path: stage as draft, skip file upload (follow-up)
        const dfd = new FormData();
        dfd.set("cardId",      proposal.cardId);
        dfd.set("projectId",   proposal.projectId);
        dfd.set("projectCode", proposal.projectCode);
        dfd.set("cardSlug",    proposal.cardSlug);
        dfd.set("eventKind",   proposal.eventKind);
        if (proposal.rationale) dfd.set("rationale", proposal.rationale);
        for (const [k, v] of Object.entries(proposal.payload)) {
          const value = Array.isArray(v)
            ? v.join(",")
            : v == null
            ? ""
            : String(v);
          dfd.set(`payload_${k}`, value);
        }
        const dres = await createCardEventDraft(dfd);
        if (!dres.ok) {
          setStatus("error");
          setError(dres.error);
          return;
        }
        setStatus("saved");
        return;
      }

      // Low-risk path: commit directly as card_event
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
        <div className="mb-2 rounded border border-[var(--sand)] bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
          📎 {proposal.fileMeta?.name ?? proposal.pendingFile?.name} —
          akan diupload setelah ✓ Simpan
        </div>
      ) : null}
      <pre className="mb-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-[var(--sand)] bg-[var(--surface)] p-2 text-[10px] text-foreground">
        {JSON.stringify(proposal.payload, null, 2)}
      </pre>
      {proposal.rationale ? (
        <p className="mb-2 text-[10px] italic text-[var(--text-secondary)]">"{proposal.rationale}"</p>
      ) : null}
      {isHighRisk ? (
        <div className="mb-2 rounded border border-[var(--sand)] bg-[var(--sand-tint)] px-2 py-1 text-[10px] text-[var(--sand-dark)]">
          🔒 Kategori berisiko tinggi — akan dikirim ke /review untuk approval principal
        </div>
      ) : null}
      {error ? <div className="mb-2 text-[10px] text-[var(--flag-critical)]">{error}</div> : null}
      {status === "pending" || status === "error" ? (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={commit}
            aria-label="Simpan proposal ke kartu"
            className="rounded bg-foreground px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
          >
            <span aria-hidden="true">&#10003;</span> Simpan
          </button>
          <button
            type="button"
            onClick={discard}
            aria-label="Batalkan proposal"
            className="rounded px-3 py-1 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
          >
            <span aria-hidden="true">&#10007;</span> Batal
          </button>
        </div>
      ) : status === "saving" ? (
        <div className="text-[10px] text-[var(--text-secondary)]">Menyimpan…</div>
      ) : status === "saved" ? (
        <div className="text-[10px] text-[var(--flag-ok)]">
          {isHighRisk
            ? "✓ Tersimpan sebagai draft. Menunggu approval di /review."
            : "✓ Tersimpan di kartu."}
        </div>
      ) : (
        <div className="text-[10px] text-[var(--text-muted)]">Dibatalkan.</div>
      )}
    </div>
  );
}
