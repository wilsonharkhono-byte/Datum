"use client";
import { useState } from "react";
import { useAddComment } from "@/lib/query/mutations";

export function CommentInput({
  cardId,
  projectId,
  projectCode,
  cardSlug,
  cardCode,
  cardQuerySlug,
}: {
  cardId: string;
  projectId: string;
  /** projectCode/cardSlug go into the createComment FormData (revalidatePath). */
  projectCode: string;
  cardSlug: string;
  /** cardCode/cardQuerySlug are the card-query identity (= useCard's code/slug)
      so the optimistic ghost lands in the same cache entry the list reads. */
  cardCode: string;
  cardQuerySlug: string;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The mutation optimistically appends a ghost comment into the cached card and
  // rolls back on error, so the comment shows instantly like the board flows.
  const addComment = useAddComment(cardCode, cardQuerySlug);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    const fd = new FormData();
    fd.set("cardId", cardId);
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    fd.set("body", trimmed);
    setBody("");
    addComment.mutate(fd, {
      onError: (err) => {
        setBody(trimmed);
        setError((err as Error).message);
      },
    });
  }

  const pending = addComment.isPending;

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
      {error ? <div className="mt-1 text-[11px] text-[var(--flag-critical)]">{error}</div> : null}
      <div className="mt-1.5">
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="rounded bg-[var(--foreground)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--surface)] disabled:bg-[var(--text-muted)]"
        >
          {pending ? "Mengirim…" : "Kirim komentar"}
        </button>
      </div>
    </form>
  );
}
