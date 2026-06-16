"use client";
import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import type { CardAttachment } from "@datum/db";
import { signAttachment, reanalyzeAttachment } from "@/lib/cards/mutations";
import { PaperclipIcon } from "@/components/icons/Icon";

type ResolvedAttachment = CardAttachment & { signedUrl: string | null };

export function EventAttachments({
  attachments,
  projectCode,
  cardSlug,
}: {
  attachments: CardAttachment[];
  projectCode: string;
  cardSlug: string;
}) {
  const [resolved, setResolved] = useState<ResolvedAttachment[]>([]);

  useEffect(() => {
    if (attachments.length === 0) return;
    let cancelled = false;
    (async () => {
      const out: ResolvedAttachment[] = [];
      for (const a of attachments) {
        const fd = new FormData();
        fd.set("storagePath", a.storage_path);
        const r = await signAttachment(fd);
        out.push({ ...a, signedUrl: r.ok ? r.url : null });
      }
      if (!cancelled) setResolved(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [attachments]);

  if (attachments.length === 0) return null;

  // Show AI state even before signed URLs resolve, by falling back to the raw
  // attachments (signedUrl null → the tile renders a "memuat…" placeholder).
  const list: ResolvedAttachment[] =
    resolved.length === attachments.length
      ? resolved
      : attachments.map((a) => ({ ...a, signedUrl: null }));

  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {list.map((a) => (
        <AttachmentTile key={a.id} a={a} projectCode={projectCode} cardSlug={cardSlug} />
      ))}
    </div>
  );
}

function AttachmentTile({
  a,
  projectCode,
  cardSlug,
}: {
  a: ResolvedAttachment;
  projectCode: string;
  cardSlug: string;
}) {
  const fileName = a.storage_path.split("/").pop() ?? "lampiran";
  const isImage = a.mime_type.startsWith("image/");
  const [pending, startTransition] = useTransition();
  const [requeued, setRequeued] = useState(false);

  const tile = !a.signedUrl ? (
    <span className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
      {fileName} (memuat…)
    </span>
  ) : isImage ? (
    <a
      href={a.signedUrl}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded border border-[var(--border)] hover:border-[var(--sand-dark)]"
    >
      <Image
        src={a.signedUrl}
        alt={fileName}
        width={64}
        height={64}
        sizes="64px"
        className="h-16 w-16 object-cover"
        loading="lazy"
        unoptimized={true}
      />
    </a>
  ) : (
    <a
      href={a.signedUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] font-medium text-[var(--sand-dark)] hover:border-[var(--sand-dark)]"
    >
      <PaperclipIcon size={11} /> {fileName}
    </a>
  );

  const requeue = () => {
    const fd = new FormData();
    fd.set("attachmentId", a.id);
    fd.set("projectCode", projectCode);
    fd.set("cardSlug", cardSlug);
    startTransition(async () => {
      const r = await reanalyzeAttachment(fd);
      if (r.ok) setRequeued(true);
    });
  };

  const analyzing = requeued || a.ai_status === "pending" || a.ai_status === "processing";

  return (
    <div className="flex max-w-[12rem] flex-col gap-0.5">
      {tile}
      {analyzing ? (
        <span className="text-[10px] italic text-[var(--text-muted)]">Menganalisis…</span>
      ) : a.ai_status === "done" && a.ai_caption ? (
        <p className="text-[10px] leading-snug text-[var(--text-muted)]">{a.ai_caption}</p>
      ) : a.ai_status === "failed" || a.ai_status === "skipped" ? (
        <button
          type="button"
          onClick={requeue}
          disabled={pending}
          className="self-start text-[10px] text-[var(--sand-dark)] underline hover:no-underline disabled:opacity-50"
          title={a.ai_error ? `Gagal: ${a.ai_error}` : undefined}
        >
          {pending ? "…" : "Analisis ulang"}
        </button>
      ) : null}
    </div>
  );
}
