"use client";
import { useState } from "react";
import { useAddCard } from "@/lib/query/mutations";

export function AddCardForm({
  projectId,
  topicId,
  projectCode,
}: {
  projectId: string;
  topicId: string;
  projectCode: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const addCard = useAddCard(projectCode);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("topicId", topicId);
    fd.set("projectCode", projectCode);
    fd.set("title", trimmed);
    // Paint the ghost card now (via the mutation's onMutate) and close the form —
    // no blocking "Menyimpan…".
    setTitle("");
    setOpen(false);
    addCard.mutate(fd, {
      onError: (err) => {
        // The cache rollback is automatic (mutation onError); surface the error
        // and let the user retry by re-opening the form with their text restored.
        setTitle(trimmed);
        setOpen(true);
        setError((err as Error).message);
      },
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 w-full rounded border border-dashed border-[#B5AFA8] px-2 py-1.5 text-left text-[11px] font-medium text-[#7A6B56] hover:border-[#7A6B56] hover:bg-white"
      >
        + tambah kartu
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-1 rounded border border-[#B5AFA8] bg-white p-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Judul kartu — contoh: Master bathroom"
        disabled={addCard.isPending}
        maxLength={120}
        className="w-full rounded border border-[var(--border)] px-2 py-1 text-xs focus:border-[var(--sand-dark)] focus:outline-none"
      />
      {error ? <div className="mt-1 text-[10px] text-red-700">{error}</div> : null}
      <div className="mt-1.5 flex gap-1">
        <button
          type="submit"
          disabled={addCard.isPending || !title.trim()}
          className="rounded bg-[#141210] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-[var(--text-muted)]"
        >
          {addCard.isPending ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTitle("");
            setError(null);
          }}
          disabled={addCard.isPending}
          className="rounded px-3 py-1 text-[10px] font-medium text-[#524E49] hover:bg-[var(--surface-alt)]"
        >
          Batal
        </button>
      </div>
    </form>
  );
}
