"use client";
import { useEffect, useState } from "react";
import type { CardAttachment } from "@datum/db";
import { signAttachment } from "@/lib/cards/mutations";

type ResolvedAttachment = CardAttachment & { signedUrl: string | null };

export function EventAttachments({ attachments }: { attachments: CardAttachment[] }) {
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
    return () => { cancelled = true; };
  }, [attachments]);

  if (attachments.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {resolved.length === 0
        ? attachments.map((a) => (
            <span
              key={a.id}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]"
            >
              {a.storage_path.split("/").pop() ?? "lampiran"} (memuat…)
            </span>
          ))
        : resolved.map((a) => {
            const isImage = a.mime_type.startsWith("image/");
            const fileName = a.storage_path.split("/").pop() ?? "lampiran";
            if (!a.signedUrl) {
              return (
                <span
                  key={a.id}
                  className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]"
                >
                  {fileName} (memuat…)
                </span>
              );
            }
            return isImage ? (
              <a
                key={a.id}
                href={a.signedUrl}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded border border-[var(--border)] hover:border-[var(--sand-dark)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.signedUrl} alt={fileName} className="h-16 w-16 object-cover" />
              </a>
            ) : (
              <a
                key={a.id}
                href={a.signedUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] font-medium text-[var(--sand-dark)] hover:border-[var(--sand-dark)] hover:text-[var(--sand-dark)]"
              >
                📎 {fileName}
              </a>
            );
          })}
    </div>
  );
}
