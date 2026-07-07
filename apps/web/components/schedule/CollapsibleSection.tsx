"use client";

import { useState, type ReactNode } from "react";

/**
 * Progressive-disclosure section wrapper for the Jadwal & Readiness page.
 * Header mirrors the existing section h2 idiom (text-sm font-semibold uppercase
 * tracking-wide) plus a muted badge chip and a chevron. Children only mount when
 * open. Touch target min-h-11 on mobile, collapses on md (AreaTargetEditor idiom).
 */
export function CollapsibleSection({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 text-left md:min-h-0"
      >
        <span aria-hidden className="text-xs text-[var(--sand-dark)]">
          {open ? "▾" : "▸"}
        </span>
        <span className="text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
          {title}
        </span>
        {badge ? (
          <span className="rounded-sm bg-[var(--sand-tint)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]">
            {badge}
          </span>
        ) : null}
        {subtitle ? (
          <span className="truncate text-xs text-[var(--text-muted)]">
            {subtitle}
          </span>
        ) : null}
      </button>

      {open ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}
