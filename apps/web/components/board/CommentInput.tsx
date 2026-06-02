"use client";
import { useState, useTransition } from "react";
import { createComment } from "@/lib/cards/mutations";

export function CommentInput({
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
  const [body, setBody] = useState("");
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
    startTransition(async () => {
      const res = await createComment(fd);
      if (res.ok) setBody("");
      else setError(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="mt-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={pending}
        rows={2}
        maxLength={4000}
        placeholder="Tambah komentar…"
        className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none"
      />
      {error ? <div className="mt-1 text-[11px] text-red-700">{error}</div> : null}
      <div className="mt-1.5">
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="rounded bg-[#141210] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-[var(--text-muted)]"
        >
          {pending ? "Mengirim…" : "Kirim komentar"}
        </button>
      </div>
    </form>
  );
}
