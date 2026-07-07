"use client";

import { useState, type ReactNode } from "react";

/**
 * Client island for the "beyond the first 8" signal rows. The parent
 * (SignalSummaryPanel, a server component) renders the collapsed rows as
 * children; this only owns the toggle so the server work stays server-side.
 */
export function SignalOverflow({
  hiddenCount,
  children,
}: {
  hiddenCount: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open ? <div className="flex flex-col gap-1.5">{children}</div> : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="min-h-11 self-start rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--sand-dark)] md:min-h-0"
      >
        {open ? "Sembunyikan" : `Lihat semua (${hiddenCount})`}
      </button>
    </>
  );
}
