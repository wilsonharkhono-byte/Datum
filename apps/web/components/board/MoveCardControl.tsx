"use client";
import { useState } from "react";
import type { Topic } from "@datum/db";
import { useMoveCard } from "@/lib/query/mutations";

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
  const move = useMoveCard(projectCode);

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
    // Close immediately — the optimistic move lands in the cache via onMutate;
    // on error the cache rolls back and we re-surface the message.
    setOpen(false);
    move.mutate(fd, {
      onError: (err) => {
        setOpen(true);
        setError((err as Error).message);
      },
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="move-card-column" className="sr-only">Kolom tujuan</label>
      <select
        id="move-card-column"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        disabled={move.isPending}
        className="select-brand-sm"
      >
        {topics.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={move.isPending || targetId === currentTopicId}
        aria-label="Pindah kartu ke kolom yang dipilih"
        className="rounded bg-[#141210] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-[var(--text-muted)]"
      >
        {move.isPending ? "…" : "pindah"}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setTargetId(currentTopicId); setError(null); }}
        disabled={move.isPending}
        aria-label="Batal pindahkan kartu"
        className="rounded px-2 py-1 text-xs font-medium text-[#524E49] hover:bg-[var(--surface-alt)]"
      >
        batal
      </button>
      {error ? <span className="text-[10px] text-red-700">{error}</span> : null}
    </div>
  );
}
