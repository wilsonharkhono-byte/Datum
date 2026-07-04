"use client";
import { useState, useTransition } from "react";
import { createCard, createCardEvent, attachToEvent } from "@/lib/cards/mutations";
import { linkCardToArea } from "@/lib/cards/area-link-mutations";
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
  // Capture-time area hint: the existing project area this note most likely
  // refers to. When present, ProposalCard offers to link the card to it on
  // commit (the area drives the gate × area matrix).
  areaHint?:  { areaId: string; areaCode: string; areaName: string } | null;
  // When the AI matched a Trello-import template placeholder card, the save
  // creates a NEW card instead of burying the event in the placeholder.
  createNew?:    boolean;
  newCardTitle?: string | null;  // default title for the new card ("YYYY-MM-DD - …")
  topicId?:      string;         // column the new card is created in
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
  const [confirmArmed, setConfirmArmed] = useState(false);
  // Default to ON when a hint is present: linking is the whole point of the
  // hint, but the user can opt out before committing.
  const [linkArea, setLinkArea] = useState(true);
  const [areaLinked, setAreaLinked] = useState(false);
  const [title, setTitle] = useState(proposal.newCardTitle ?? "");
  // The card the event ultimately landed on — equals the proposal card unless a
  // new card was created on commit. Drives the saved-state "Buka kartu" link.
  const [savedCard, setSavedCard] = useState<{ slug: string; title: string }>({
    slug: proposal.cardSlug,
    title: proposal.cardTitle,
  });
  const [, startTransition] = useTransition();

  const areaHint = proposal.areaHint ?? null;

  const isHighRisk = HIGH_RISK_KINDS.has(proposal.eventKind as EventKind);
  const conf = Math.round(proposal.confidence * 100);
  const lowConfidence = conf < 50;

  function handleSave() {
    // Confidence gate: a low-confidence proposal needs a deliberate second tap
    // before anything is written to the card.
    if (lowConfidence && !confirmArmed) {
      setConfirmArmed(true);
      return;
    }
    commit();
  }

  function commit() {
    setError(null);
    setStatus("saving");

    startTransition(async () => {
      // 1. Resolve the target card. When the AI matched a template placeholder,
      //    create a fresh, properly-named card instead of writing into the stub.
      let cardId = proposal.cardId;
      let cardSlug = proposal.cardSlug;
      let cardTitle = proposal.cardTitle;

      if (proposal.createNew) {
        const finalTitle = (title.trim() || (proposal.newCardTitle ?? "").trim());
        if (!finalTitle) {
          setStatus("error");
          setError("Judul kartu tidak boleh kosong");
          return;
        }
        if (!proposal.topicId) {
          setStatus("error");
          setError("Kolom kartu tidak diketahui — tidak bisa membuat kartu baru");
          return;
        }
        const cf = new FormData();
        cf.set("projectId", proposal.projectId);
        cf.set("topicId", proposal.topicId);
        cf.set("projectCode", proposal.projectCode);
        cf.set("title", finalTitle);
        const created = await createCard(cf);
        if (!created.ok) {
          setStatus("error");
          setError(created.error);
          return;
        }
        cardId = created.id;
        cardSlug = created.slug;
        cardTitle = finalTitle;
      }

      // 2. Attach the event to the resolved card. High-risk kinds get a label
      //    (timeline chip + principal notification), not a draft gate — the
      //    principal can edit/delete the event if AI got it wrong.
      const fd = new FormData();
      fd.set("cardId",      cardId);
      fd.set("projectId",   proposal.projectId);
      fd.set("projectCode", proposal.projectCode);
      fd.set("cardSlug",    cardSlug);
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
        setError(
          proposal.createNew
            ? `Kartu "${cardTitle}" dibuat, tapi gagal menyimpan catatan: ${res.error}`
            : res.error,
        );
        return;
      }
      // 3. Upload pending file if present
      if (proposal.pendingFile) {
        const up = await uploadCardAttachment({
          file: proposal.pendingFile,
          projectId: proposal.projectId,
          cardId,
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
        aFd.set("cardSlug", cardSlug);
        aFd.set("storagePath", up.storagePath);
        aFd.set("mimeType", up.mimeType);
        const a = await attachToEvent(aFd);
        if (!a.ok) {
          setStatus("error");
          setError(`Event tersimpan tapi simpan lampiran gagal: ${a.error}`);
          return;
        }
      }
      // 4. Optionally link the card to the hinted area. A link failure shouldn't
      // discard the saved event — surface it softly and still mark saved.
      if (areaHint && linkArea) {
        const lf = new FormData();
        lf.set("cardId", cardId);
        lf.set("areaId", areaHint.areaId);
        lf.set("projectCode", proposal.projectCode);
        lf.set("cardSlug", cardSlug);
        const linkRes = await linkCardToArea(lf);
        if (linkRes.ok) {
          setAreaLinked(true);
        } else {
          setError(`Catatan tersimpan, tapi gagal menautkan ke ${areaHint.areaName}: ${linkRes.error}`);
        }
      }
      setSavedCard({ slug: cardSlug, title: cardTitle });
      setStatus("saved");
    });
  }

  function discard() {
    setConfirmArmed(false);
    setStatus("discarded");
  }

  const confColor =
    conf >= 80 ? "text-[var(--flag-ok)]" : conf >= 50 ? "text-[var(--sand-dark)]" : "text-[var(--flag-critical)]";

  return (
    <div className="max-w-[85%] rounded-md border border-[var(--sand)] bg-[var(--sand-tint)] p-3 text-xs">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 font-semibold text-foreground">
          {proposal.createNew && (status === "pending" || status === "error") ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--sand-dark)]">
                Kartu baru
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                aria-label="Judul kartu baru"
                className="w-full rounded border border-[var(--sand)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold text-foreground focus:border-[var(--sand-dark)] focus:outline-none"
              />
              <span className="text-[10px] font-normal text-[var(--text-muted)]">· {proposal.topicName}</span>
            </div>
          ) : (
            <>
              → {proposal.createNew ? savedCard.title : proposal.cardTitle}
              <span className="ml-1 font-normal text-[var(--text-muted)]">· {proposal.topicName}</span>
            </>
          )}
        </div>
        <span className={`shrink-0 text-[10px] font-semibold uppercase ${confColor}`}>{conf}% yakin</span>
      </div>
      <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">
        {KIND_LABELS[proposal.eventKind] ?? proposal.eventKind}
      </div>
      {areaHint ? (
        status === "pending" || status === "error" ? (
          <label className="mb-2 flex min-h-[40px] cursor-pointer items-center gap-2 rounded border border-[var(--sand)] bg-[var(--surface)] px-2 py-1.5">
            <input
              type="checkbox"
              checked={linkArea}
              onChange={(e) => setLinkArea(e.target.checked)}
              aria-label={`Tautkan kartu ke area ${areaHint.areaName}`}
              className="h-4 w-4 shrink-0 accent-[var(--foreground)]"
            />
            <span className="text-[10px] text-[var(--text-secondary)]">
              Tautkan ke area{" "}
              <span className="font-semibold text-[var(--foreground)]">{areaHint.areaName}</span>
              <span className="ml-1 font-mono text-[var(--sand-dark)]">{areaHint.areaCode}</span>
            </span>
          </label>
        ) : null
      ) : null}
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
      {lowConfidence && (status === "pending" || status === "error") ? (
        <div className="mb-2 flex items-center gap-1.5 rounded border border-[var(--flag-warning)]/50 bg-[var(--flag-warning-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--flag-warning)]">
          ⚠ Keyakinan AI rendah — periksa isian sebelum menyimpan
        </div>
      ) : null}
      {error ? <div className="mb-2 text-[10px] text-[var(--flag-critical)]">{error}</div> : null}
      {status === "pending" || status === "error" ? (
        <div className="sticky bottom-0 -mx-3 -mb-3 flex gap-2 border-t border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 backdrop-blur-sm">
          <button
            type="button"
            onClick={handleSave}
            aria-label={confirmArmed ? "Konfirmasi simpan proposal ke kartu" : "Simpan proposal ke kartu"}
            className={`inline-flex items-center gap-1.5 rounded px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-inverse)] shadow-[0_2px_6px_-1px_rgba(122,107,86,0.4)] ${
              confirmArmed
                ? "bg-[var(--flag-warning)] hover:opacity-90"
                : "bg-foreground hover:bg-[var(--sand-dark)]"
            }`}
          >
            <CheckIcon size={13} /> {confirmArmed ? "Yakin simpan?" : "Simpan ke kartu"}
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
            {isHighRisk
              ? "Tersimpan di kartu · principal dinotifikasi"
              : proposal.createNew
              ? "Kartu baru dibuat · catatan tersimpan"
              : "Tersimpan di kartu"}
          </span>
          {areaLinked && areaHint ? (
            <span className="inline-flex items-center gap-1 rounded bg-[var(--sand-tint)] px-2 py-1 text-[10px] font-semibold text-[var(--sand-dark)]">
              <CheckIcon size={11} /> Ditautkan ke {areaHint.areaName}
            </span>
          ) : null}
          <a
            href={`/project/${proposal.projectCode}/cards/${savedCard.slug}`}
            className="inline-flex items-center gap-1 rounded border border-[var(--sand)] bg-[var(--surface)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--sand-dark)] hover:border-[var(--sand-dark)] hover:bg-[var(--sand-tint)]"
            aria-label={`Buka kartu ${savedCard.title}`}
          >
            → Buka {savedCard.title}
          </a>
        </div>
      ) : (
        <div className="text-[10px] text-[var(--text-muted)]">Dibatalkan.</div>
      )}
    </div>
  );
}
