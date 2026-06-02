"use client";
import { useState, useTransition } from "react";
import { createCard } from "@/lib/cards/mutations";

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
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("topicId", topicId);
    fd.set("projectCode", projectCode);
    fd.set("title", title.trim());
    startTransition(async () => {
      const res = await createCard(fd);
      if (res.ok) {
        setTitle("");
        setOpen(false);
      } else {
        setError(res.error);
      }
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
        disabled={pending}
        maxLength={120}
        className="w-full rounded border border-[var(--border)] px-2 py-1 text-xs focus:border-[var(--sand-dark)] focus:outline-none"
      />
      {error ? <div className="mt-1 text-[10px] text-red-700">{error}</div> : null}
      <div className="mt-1.5 flex gap-1">
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="rounded bg-[#141210] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-[var(--text-muted)]"
        >
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTitle("");
            setError(null);
          }}
          disabled={pending}
          className="rounded px-3 py-1 text-[10px] font-medium text-[#524E49] hover:bg-[var(--surface-alt)]"
        >
          Batal
        </button>
      </div>
    </form>
  );
}
