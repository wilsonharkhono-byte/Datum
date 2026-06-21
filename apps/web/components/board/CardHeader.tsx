"use client";
import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Card } from "@datum/db";
import { updateCard } from "@/lib/cards/mutations";
import { keys } from "@/lib/query/keys";
import { TrelloIcon } from "@/components/icons/Icon";
import { NextDeadlineBadge } from "@/components/schedule/NextDeadlineBadge";

const STATUS_LABEL: Record<"active" | "dormant" | "closed", string> = {
  active:  "Aktif",
  dormant: "Tertunda",
  closed:  "Selesai",
};

export function CardHeader({
  card,
  projectId,
  projectCode,
  cardSlug,
  cardCode,
  cardQuerySlug,
}: {
  card: Card;
  projectId: string;
  projectCode: string;
  cardSlug: string;
  /** Canonical uppercase project_code — identity for the useCard/useBoard query keys. */
  cardCode: string;
  /** Canonical card slug — identity for the useCard query key. */
  cardQuerySlug: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [summary, setSummary] = useState(card.current_summary ?? "");
  const [status, setStatus] = useState<"active" | "dormant" | "closed">(
    (card.status as "active" | "dormant" | "closed") ?? "active",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("cardId", card.id);
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    fd.set("title", title.trim());
    fd.set("currentSummary", summary.trim());
    fd.set("status", status);
    startTransition(async () => {
      const res = await updateCard(fd);
      if (res.ok) {
        setEditing(false);
        queryClient.invalidateQueries({ queryKey: keys.board(cardCode) });
        queryClient.invalidateQueries({ queryKey: keys.card(cardCode, cardQuerySlug) });
      } else setError(res.error);
    });
  }

  function cancel() {
    setTitle(card.title);
    setSummary(card.current_summary ?? "");
    setStatus((card.status as "active" | "dormant" | "closed") ?? "active");
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <header className="mt-2 border-b border-[var(--border)] pb-3">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <h1 className="min-w-0 break-words text-base font-semibold text-foreground sm:text-xl">{card.title}</h1>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit kartu"
            className="shrink-0 rounded border border-[#B5AFA8] px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[#524E49] hover:bg-[#FDFAF6]"
          >
            edit
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--text-secondary)]">
          <span className="rounded bg-[var(--surface-alt)] px-2 py-0.5 uppercase tracking-wide">
            {STATUS_LABEL[card.status as "active" | "dormant" | "closed"] ?? card.status}
          </span>
          {card.last_event_at ? (
            <span>terakhir: {new Date(card.last_event_at).toLocaleDateString("id-ID")}</span>
          ) : null}
          <NextDeadlineBadge cardId={card.id} />
        </div>
        {(() => {
          const props = (card.properties as { trello_card_id?: string; trello_url?: string } | null);
          if (!props?.trello_card_id) return null;
          return (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 rounded bg-[var(--surface-alt)] px-2 py-0.5 font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                <TrelloIcon size={11} /> Diimpor dari Trello
              </span>
              {props.trello_url ? (
                <a
                  href={props.trello_url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Buka kartu asli di Trello"
                  className="text-[var(--sand-dark)] hover:underline"
                >
                  Lihat di Trello ↗
                </a>
              ) : null}
            </div>
          );
        })()}
        {card.current_summary ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{card.current_summary}</p>
        ) : null}
      </header>
    );
  }

  return (
    <form onSubmit={save} className="mt-2 border-b border-[var(--border)] pb-3">
      <div className="flex items-start justify-between gap-3">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          maxLength={120}
          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-base font-semibold text-foreground focus:border-[var(--sand-dark)] focus:outline-none sm:text-xl"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor="card-status" className="text-[10px] uppercase tracking-wide text-[#7A6B56]">Status:</label>
        <select
          id="card-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as "active" | "dormant" | "closed")}
          disabled={pending}
          className="select-brand-sm"
        >
          <option value="active">Aktif</option>
          <option value="dormant">Tertunda</option>
          <option value="closed">Selesai</option>
        </select>
      </div>
      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        disabled={pending}
        rows={2}
        maxLength={2000}
        placeholder="Ringkasan singkat — mis. 'Marmer Statuario disetujui klien'"
        className="mt-2 w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none"
      />
      {error ? <div className="mt-1 text-[11px] text-red-700">{error}</div> : null}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={pending || !title.trim()}
          aria-label="Simpan perubahan kartu"
          className="rounded bg-[#141210] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-[var(--text-muted)]"
        >
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          aria-label="Batal edit kartu"
          className="rounded px-3 py-1.5 text-[11px] font-medium text-[#524E49] hover:bg-[var(--surface-alt)]"
        >
          Batal
        </button>
      </div>
    </form>
  );
}
