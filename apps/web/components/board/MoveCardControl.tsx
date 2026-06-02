"use client";
import { useState, useTransition } from "react";
import type { Topic } from "@datum/db";
import { moveCard } from "@/lib/cards/mutations";

export function MoveCardControl({
  cardId,
  projectId,
  projectCode,
  cardSlug,
  currentTopicId,
  topics,
}: {
  cardId: string;
  projectId: string;
  projectCode: string;
  cardSlug: string;
  currentTopicId: string;
  topics: Topic[];
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string>(currentTopicId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const currentName = topics.find((t) => t.id === currentTopicId)?.name ?? "—";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Pindahkan kartu (sekarang di: ${currentName})`}
        className="rounded border border-[#B5AFA8] px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[#524E49] hover:bg-[#FDFAF6]"
        title={`Sekarang di: ${currentName}`}
      >
        pindahkan
      </button>
    );
  }

  function submit() {
    if (targetId === currentTopicId) {
      setOpen(false);
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("cardId", cardId);
    fd.set("newTopicId", targetId);
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    startTransition(async () => {
      const res = await moveCard(fd);
      if (res.ok) setOpen(false);
      else setError(res.error);
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="move-card-column" className="sr-only">Kolom tujuan</label>
      <select
        id="move-card-column"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        disabled={pending}
        className="rounded border border-[var(--border)] px-2 py-0.5 text-xs"
      >
        {topics.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={pending || targetId === currentTopicId}
        aria-label="Pindah kartu ke kolom yang dipilih"
        className="rounded bg-[#141210] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-[var(--text-muted)]"
      >
        {pending ? "…" : "pindah"}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setTargetId(currentTopicId); setError(null); }}
        disabled={pending}
        aria-label="Batal pindahkan kartu"
        className="rounded px-2 py-1 text-xs font-medium text-[#524E49] hover:bg-[var(--surface-alt)]"
      >
        batal
      </button>
      {error ? <span className="text-[10px] text-red-700">{error}</span> : null}
    </div>
  );
}
