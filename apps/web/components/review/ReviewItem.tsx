"use client";
import { useState, useTransition } from "react";
import { approveCardEventDraft, rejectCardEventDraft } from "@/lib/cards/mutations";
import { renderPayload, eventKindLabel } from "@/lib/cards/payload-render";
import { CheckIcon, XIcon } from "@/components/icons/Icon";

type Draft = {
  id: string;
  project_id: string;
  draft_type: string;
  proposed_payload: {
    kind: string;
    payload: Record<string, unknown>;
    card_id: string;
    occurred_at: string;
    rationale?: string;
  };
  risk_level: string;
  source_type: string;
  original_input_text: string | null;
  created_at: string;
  projects: { project_code: string; project_name: string } | null;
  created_by: { full_name: string | null } | null;
};

export function ReviewItem({ draft }: { draft: Draft }) {
  const [status, setStatus] = useState<"pending" | "saving" | "approved" | "rejected" | "error">("pending");
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();

  function approve() {
    setError(null);
    setStatus("saving");
    const fd = new FormData();
    fd.set("draftId", draft.id);
    startTransition(async () => {
      const res = await approveCardEventDraft(fd);
      if (res.ok) setStatus("approved");
      else { setStatus("error"); setError(res.error); }
    });
  }

  function reject() {
    setError(null);
    setStatus("saving");
    const fd = new FormData();
    fd.set("draftId", draft.id);
    if (reason.trim()) fd.set("reason", reason.trim());
    startTransition(async () => {
      const res = await rejectCardEventDraft(fd);
      if (res.ok) setStatus("rejected");
      else { setStatus("error"); setError(res.error); }
    });
  }

  const isHigh = draft.risk_level === "high";
  const fields = renderPayload(draft.proposed_payload.payload);
  const kindLabel = eventKindLabel(draft.proposed_payload.kind);
  const createdAt = new Date(draft.created_at).toLocaleString("id-ID", {
    dateStyle: "medium", timeStyle: "short",
  });

  return (
    <li className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_2px_8px_-4px_rgba(122,107,86,0.18)]">
      {/* Header band */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
            {draft.projects?.project_code ?? "(proyek)"}
          </span>
          <span className="text-[var(--text-muted)]">·</span>
          <span className="text-xs font-semibold text-[var(--foreground)]">
            {kindLabel}
          </span>
          {isHigh ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--flag-high-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--flag-high)]">
              Berisiko tinggi
            </span>
          ) : null}
        </div>
        <span className="text-[10px] text-[var(--text-muted)]">{createdAt}</span>
      </div>

      <div className="px-4 py-3">
        {/* Author line */}
        <div className="mb-3 text-[11px] text-[var(--text-secondary)]">
          Diusulkan oleh{" "}
          <span className="font-semibold text-[var(--foreground)]">
            {draft.created_by?.full_name ?? "(tidak diketahui)"}
          </span>
        </div>

        {/* AI rationale — the "why this card / why this kind" line */}
        {draft.proposed_payload.rationale ? (
          <blockquote className="mb-3 border-l-2 border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 text-[12px] italic text-[var(--text-secondary)]">
            {draft.proposed_payload.rationale}
          </blockquote>
        ) : null}

        {/* Original input text if available */}
        {draft.original_input_text ? (
          <div className="mb-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sand-dark)]">
              Tulisan asli
            </div>
            <div className="rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
              &ldquo;{draft.original_input_text}&rdquo;
            </div>
          </div>
        ) : null}

        {/* Pretty fields */}
        {fields.length > 0 ? (
          <dl className="mb-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5">
            {fields.map((f) => (
              <div key={f.key} className="contents">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sand-dark)]">
                  {f.label}
                </dt>
                <dd className={`text-[13px] text-[var(--foreground)] ${f.isLongText ? "leading-snug" : ""}`}>
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {error ? (
          <div className="mb-3 rounded border border-[var(--flag-critical)] bg-[var(--flag-critical-bg)] px-3 py-2 text-[11px] text-[var(--flag-critical)]">
            {error}
          </div>
        ) : null}

        {status === "pending" || status === "error" ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={approve}
              aria-label="Setujui dan tambahkan ke kartu"
              className="inline-flex items-center gap-1.5 rounded bg-[var(--flag-ok)] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white shadow-[0_2px_6px_-1px_rgba(61,139,64,0.4)] hover:opacity-90"
            >
              <CheckIcon size={13} /> Setujui & tambah ke kartu
            </button>
            {showReject ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="alasan (opsional)"
                  aria-label="Alasan penolakan (opsional)"
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs focus:border-[var(--sand-dark)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={reject}
                  aria-label="Konfirmasi tolak"
                  className="rounded bg-[var(--flag-critical)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white"
                >
                  Tolak
                </button>
                <button
                  type="button"
                  onClick={() => setShowReject(false)}
                  aria-label="Batal tolak"
                  className="text-xs text-[var(--text-muted)] hover:underline"
                >
                  batal
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowReject(true)}
                aria-label="Tolak"
                className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--text-secondary)]"
              >
                <XIcon size={12} /> Tolak
              </button>
            )}
          </div>
        ) : status === "saving" ? (
          <div className="text-[11px] text-[var(--text-secondary)]">Memproses…</div>
        ) : status === "approved" ? (
          <div className="inline-flex items-center gap-1.5 rounded bg-[var(--flag-ok-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--flag-ok)]">
            <CheckIcon size={12} /> Tersimpan di kartu
          </div>
        ) : (
          <div className="text-[11px] font-semibold text-[var(--text-muted)]">Ditolak.</div>
        )}
      </div>
    </li>
  );
}
