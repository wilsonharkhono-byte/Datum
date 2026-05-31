"use client";
import { useState, useTransition } from "react";
import { createCardNote } from "@/lib/cards/mutations";

export function AddNoteForm({
  cardId,
  projectId,
  projectCode,
  cardSlug,
}: {
  cardId: string;
  projectId: string;
  projectCode: string;
  cardSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("cardId", cardId);
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    fd.set("body", body.trim());
    if (occurredAt) fd.set("occurredAt", occurredAt);
    startTransition(async () => {
      const res = await createCardNote(fd);
      if (res.ok) {
        setBody("");
        setOccurredAt("");
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
        className="mt-4 w-full rounded border border-dashed border-[#B5AFA8] px-3 py-2 text-left text-xs font-medium text-[#7A6B56] hover:border-[#7A6B56] hover:bg-[#FDFAF6]"
      >
        + tambah catatan
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded border border-[#B5AFA8] bg-[#FDFAF6] p-3">
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Tulis catatan… (mis. ringkasan diskusi, observasi lapangan)"
        disabled={pending}
        rows={3}
        maxLength={4000}
        className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-amber-700 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wide text-[#7A6B56]">
          tanggal:
        </label>
        <input
          type="date"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          disabled={pending}
          className="rounded border border-stone-300 px-2 py-0.5 text-xs"
        />
        <span className="text-[10px] text-[#847E78]">kosongkan untuk hari ini</span>
      </div>
      {error ? <div className="mt-2 text-[11px] text-red-700">{error}</div> : null}
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="rounded bg-[#141210] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-stone-400"
        >
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setBody(""); setOccurredAt(""); setError(null); }}
          disabled={pending}
          className="rounded px-3 py-1.5 text-[11px] font-medium text-[#524E49] hover:bg-stone-100"
        >
          Batal
        </button>
      </div>
    </form>
  );
}
