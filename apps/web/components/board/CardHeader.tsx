"use client";
import { useState, useTransition } from "react";
import type { Card } from "@datum/db";
import { updateCard } from "@/lib/cards/mutations";

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
}: {
  card: Card;
  projectId: string;
  projectCode: string;
  cardSlug: string;
}) {
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
      if (res.ok) setEditing(false);
      else setError(res.error);
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
      <header className="mt-2 border-b border-stone-200 pb-3">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-stone-900">{card.title}</h1>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-[#B5AFA8] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#524E49] hover:bg-[#FDFAF6]"
          >
            edit
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-stone-600">
          <span className="rounded bg-stone-200 px-2 py-0.5 uppercase tracking-wide">
            {STATUS_LABEL[card.status as "active" | "dormant" | "closed"] ?? card.status}
          </span>
          {card.last_event_at ? (
            <span>terakhir: {new Date(card.last_event_at).toLocaleDateString("id-ID")}</span>
          ) : null}
        </div>
        {card.current_summary ? (
          <p className="mt-2 text-sm text-stone-700">{card.current_summary}</p>
        ) : null}
      </header>
    );
  }

  return (
    <form onSubmit={save} className="mt-2 border-b border-stone-200 pb-3">
      <div className="flex items-start justify-between gap-3">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          maxLength={120}
          className="flex-1 rounded border border-[#B5AFA8] bg-[#FDFAF6] px-2 py-1 text-xl font-semibold text-[#141210] focus:border-amber-700 focus:outline-none"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-[10px] uppercase tracking-wide text-[#7A6B56]">Status:</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "active" | "dormant" | "closed")}
          disabled={pending}
          className="rounded border border-stone-300 px-2 py-0.5 text-xs"
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
        className="mt-2 w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-amber-700 focus:outline-none"
      />
      {error ? <div className="mt-1 text-[11px] text-red-700">{error}</div> : null}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="rounded bg-[#141210] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-stone-400"
        >
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="rounded px-3 py-1.5 text-[11px] font-medium text-[#524E49] hover:bg-stone-100"
        >
          Batal
        </button>
      </div>
    </form>
  );
}
