import Link from "next/link";
import type { BriefItem } from "@/lib/brief/queries";
import type React from "react";

export function BriefSection({
  title,
  emoji,
  count,
  items,
  emptyMessage,
  showAllHref,
}: {
  title: string;
  emoji: string;
  count: number;
  items: BriefItem[];
  emptyMessage: React.ReactNode;
  showAllHref?: string;
}) {
  return (
    <section className="rounded border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
          {emoji} {title} <span className="text-[var(--sand-dark)]">({count})</span>
        </h2>
        {showAllHref && count > items.length ? (
          <Link href={showAllHref} className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)] hover:underline">
            lihat semua →
          </Link>
        ) : null}
      </div>
      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--border)] p-6">
          {emptyMessage}
        </div>
      ) : (
        <ol className="space-y-1.5">
          {items.map((it) => (
            <li key={it.id} className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
              <div className="mb-0.5 flex items-center justify-between text-[10px]">
                <span className="font-semibold uppercase tracking-wide text-[var(--sand-dark)]">{it.projectCode}</span>
                <span className="text-[var(--text-muted)]">{it.meta}</span>
              </div>
              <Link href={it.cardHref} className="block font-medium text-[var(--foreground)] hover:underline">
                {it.cardTitle}
              </Link>
              {it.detail ? <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{it.detail}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
