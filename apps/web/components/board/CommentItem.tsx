"use client";
import { useState, useTransition } from "react";
import type { CardComment } from "@datum/db";
import { editComment, deleteComment } from "@/lib/cards/mutations";

function renderBody(body: string): React.ReactNode[] {
  // Split on @mention tokens and decorate them
  const parts: React.ReactNode[] = [];
  const re = /@([a-zA-Z][a-zA-Z0-9_-]{1,30})/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) parts.push(body.slice(last, match.index));
    parts.push(
      <span key={`m${key++}`} className="rounded bg-[var(--sand-tint)] px-1 text-[var(--sand-dark)]">
        @{match[1]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

export function CommentItem({
  comment,
  projectCode,
  cardSlug,
  canEdit,
}: {
  comment: CardComment;
  projectCode: string;
  cardSlug: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function saveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("commentId", comment.id);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    fd.set("body", body.trim());
    startTransition(async () => {
      const res = await editComment(fd);
      if (res.ok) setEditing(false);
      else setError(res.error);
    });
  }

  function softDelete() {
    setError(null);
    const fd = new FormData();
    fd.set("commentId", comment.id);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    startTransition(async () => {
      const res = await deleteComment(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <li className="rounded border border-[var(--border)] bg-white px-3 py-2 text-sm">
      <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
        <span>
          {new Date(comment.created_at).toLocaleString("id-ID", {
            year: "2-digit", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
          })}
          {comment.edited_at ? <span className="ml-1 italic">(diedit)</span> : null}
        </span>
        {canEdit && !editing && !confirmingDelete ? (
          <span className="flex gap-2">
            <button type="button" onClick={() => setEditing(true)}
              aria-label="Edit komentar"
              className="px-2 py-1 text-xs text-[var(--sand-dark)] hover:underline">edit</button>
            <button type="button" onClick={() => setConfirmingDelete(true)} disabled={pending}
              aria-label="Hapus komentar"
              className="px-2 py-1 text-xs text-[var(--flag-critical)] hover:underline">hapus</button>
          </span>
        ) : null}
      </div>
      {confirmingDelete ? (
        <div className="mt-1 flex items-center gap-2 rounded border border-[var(--flag-critical)]/25 bg-[var(--flag-critical-bg)] px-3 py-2 text-xs">
          <span className="text-[var(--flag-critical)]">Yakin hapus?</span>
          <button
            type="button"
            onClick={softDelete}
            disabled={pending}
            aria-label="Ya, hapus komentar ini"
            className="rounded bg-[var(--flag-critical)] px-2 py-1 text-xs font-semibold text-white hover:bg-[var(--flag-critical)]/90 disabled:opacity-50"
          >
            {pending ? "Menghapus…" : "Ya, hapus"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            disabled={pending}
            aria-label="Batal hapus komentar"
            className="rounded px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
          >
            Batal
          </button>
        </div>
      ) : null}
      {editing ? (
        <form onSubmit={saveEdit}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
            rows={3}
            maxLength={4000}
            className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none"
          />
          {error ? <div className="mt-1 text-[10px] text-[var(--flag-critical)]">{error}</div> : null}
          <div className="mt-1.5 flex gap-2">
            <button type="submit" disabled={pending || !body.trim()}
              aria-label="Simpan perubahan komentar"
              className="rounded bg-[var(--foreground)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--surface)] disabled:bg-[var(--text-muted)]">
              {pending ? "Menyimpan…" : "Simpan"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setBody(comment.body); }}
              disabled={pending}
              aria-label="Batal edit komentar"
              className="rounded px-3 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]">
              Batal
            </button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap text-[var(--foreground)]">{renderBody(comment.body)}</p>
      )}
      {error && !editing ? <div className="mt-1 text-[10px] text-[var(--flag-critical)]">{error}</div> : null}
    </li>
  );
}
