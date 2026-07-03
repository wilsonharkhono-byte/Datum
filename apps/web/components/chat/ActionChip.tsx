"use client";
import { useState, useTransition } from "react";
import { confirmAssistantAction } from "@/lib/assistant/confirm-action";
import type { ActionProposalType } from "@/lib/assistant/types";
import { CheckIcon, XIcon, BellIcon } from "@/components/icons/Icon";

/**
 * Renders a confirm-gated action proposal (Task 3) as a chip under an
 * assistant message. Nothing executes until the user taps "Konfirmasi" —
 * that tap is what calls the confirmAssistantAction server action, which
 * re-validates and executes using the CALLER's own session (see
 * apps/web/lib/assistant/confirm-action.ts + actions.ts).
 *
 * Visual/interaction language mirrors ProposalCard.tsx (Catat flow): a
 * bordered chip, primary Konfirmasi + ghost Batal buttons, and
 * pending/saving/done/error/discarded states.
 */

function summarize(action: ActionProposalType): { icon: string; label: string } {
  switch (action.type) {
    case "remind": {
      const who = action.staffName ?? (action.recipientRole ? `peran ${action.recipientRole}` : "penerima");
      return { icon: "🔔", label: `Ingatkan ${who}: ${action.message}` };
    }
    case "update_step":
      return {
        icon: "🛠",
        label: `Ubah langkah "${action.stepName}" (${action.areaName}) → ${statusLabel(action.status)}`,
      };
    case "record_decision":
      return {
        icon: "📝",
        label: `Catat keputusan: ${action.outcome}`,
      };
  }
}

function statusLabel(status: "in_progress" | "blocked" | "done"): string {
  if (status === "in_progress") return "sedang berjalan";
  if (status === "blocked") return "terblokir";
  return "selesai";
}

export function ActionChip({
  action,
  projectId,
}: {
  action: ActionProposalType;
  projectId: string;
}) {
  type Status = "pending" | "saving" | "done" | "error" | "discarded";
  const [status, setStatus] = useState<Status>("pending");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const { icon, label } = summarize(action);

  function confirm() {
    setError(null);
    setStatus("saving");
    startTransition(async () => {
      const res = await confirmAssistantAction({ projectId, action });
      if (res.ok) {
        setStatus("done");
      } else {
        setStatus("error");
        setError(res.error);
      }
    });
  }

  function cancel() {
    setStatus("discarded");
  }

  return (
    <div
      className="max-w-[85%] rounded-md border border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 text-xs"
      data-testid="action-chip"
    >
      <div className="mb-1.5 flex items-start gap-1.5">
        <BellIcon size={13} />
        <span className="text-[11px] text-[var(--text-secondary)]">
          <span aria-hidden="true">{icon} </span>
          {label}
        </span>
      </div>

      {error ? <div className="mb-1.5 text-[10px] text-[var(--flag-critical)]">{error}</div> : null}

      {status === "pending" || status === "error" ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={confirm}
            aria-label="Konfirmasi aksi"
            className="inline-flex items-center gap-1.5 rounded bg-foreground px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-[var(--sand-dark)]"
          >
            <CheckIcon size={12} /> Konfirmasi
          </button>
          <button
            type="button"
            onClick={cancel}
            aria-label="Batalkan aksi"
            className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--text-secondary)]"
          >
            <XIcon size={11} /> Batal
          </button>
        </div>
      ) : status === "saving" ? (
        <div className="text-[10px] text-[var(--text-secondary)]">Mengirim…</div>
      ) : status === "done" ? (
        <span className="inline-flex items-center gap-1.5 rounded bg-[var(--flag-ok-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--flag-ok)]">
          <CheckIcon size={11} /> Terkirim
        </span>
      ) : (
        <div className="text-[10px] text-[var(--text-muted)]">Dibatalkan.</div>
      )}
    </div>
  );
}
