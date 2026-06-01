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
      <span key={`m${key++}`} className="rounded bg-amber-100 px-1 text-amber-900">
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
    if (!confirm("Hapus komentar ini?")) return;
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
    <li className="rounded border border-[#B5AFA8] bg-white px-3 py-2 text-sm">
      <div className="mb-1 flex items-center justify-between text-[10px] text-[#847E78]">
        <span>
          {new Date(comment.created_at).toLocaleString("id-ID", {
            year: "2-digit", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
          })}
          {comment.edited_at ? <span className="ml-1 italic">(diedit)</span> : null}
        </span>
        {canEdit && !editing ? (
          <span className="flex gap-2">
            <button type="button" onClick={() => setEditing(true)}
              className="text-[#7A6B56] hover:underline">edit</button>
            <button type="button" onClick={softDelete} disabled={pending}
              className="text-red-700 hover:underline">hapus</button>
          </span>
        ) : null}
      </div>
      {editing ? (
        <form onSubmit={saveEdit}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
            rows={3}
            maxLength={4000}
            className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-amber-700 focus:outline-none"
          />
          {error ? <div className="mt-1 text-[10px] text-red-700">{error}</div> : null}
          <div className="mt-1.5 flex gap-2">
            <button type="submit" disabled={pending || !body.trim()}
              className="rounded bg-[#141210] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#FDFAF6] disabled:bg-stone-400">
              {pending ? "Menyimpan…" : "Simpan"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setBody(comment.body); }}
              disabled={pending}
              className="rounded px-3 py-1 text-[10px] font-medium text-[#524E49] hover:bg-stone-100">
              Batal
            </button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap text-[#141210]">{renderBody(comment.body)}</p>
      )}
    </li>
  );
}
