"use client";
import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createTopic } from "@/lib/cards/mutations";
import { keys } from "@/lib/query/keys";

// Sits at the right edge of the board's column row. The board renders from the
// TanStack Query cache, so on success we invalidate the board query to pull the
// new column in. Other open boards pick it up via the topics realtime channel
// (see subscribeToProjectChanges).
export function AddColumnForm({
  projectId,
  projectCode,
}: {
  projectId: string;
  projectCode: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    fd.set("name", name.trim());
    startTransition(async () => {
      const res = await createTopic(fd);
      if (res.ok) {
        setName("");
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: keys.board(projectCode) });
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex flex-shrink-0 md:w-56">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-full w-full rounded border border-dashed border-[#B5AFA8] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#7A6B56] hover:border-[#7A6B56] hover:bg-white"
        >
          + tambah kolom
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-shrink-0 flex-col rounded bg-[var(--oat-deep)]/40 p-2 md:w-56">
      <form onSubmit={submit} className="rounded border border-[#B5AFA8] bg-white p-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nama kolom — contoh: Plumbing"
          disabled={pending}
          maxLength={120}
          className="w-full rounded border border-[var(--border)] px-2 py-1 text-xs focus:border-[var(--sand-dark)] focus:outline-none"
        />
        {error ? <div className="mt-1 text-[10px] text-red-700">{error}</div> : null}
        <div className="mt-1.5 flex gap-1">
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="rounded bg-[#141210] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-[var(--text-muted)]"
          >
            {pending ? "Menyimpan…" : "Simpan"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setName("");
              setError(null);
            }}
            disabled={pending}
            className="rounded px-3 py-1 text-[10px] font-medium text-[#524E49] hover:bg-[var(--surface-alt)]"
          >
            Batal
          </button>
        </div>
      </form>
    </div>
  );
}
