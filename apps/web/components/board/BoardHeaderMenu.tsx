"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MoreIcon, GearIcon } from "@/components/icons/Icon";

// Mobile overflow menu for the board header (hidden at md+, where the links sit
// inline). Collapsing the four page links into one ⋮ button reclaims a whole
// wrapped row on phones so the title bar stays a single tight line.
export function BoardHeaderMenu({
  projectCode,
  showSettings,
}: {
  projectCode: string;
  showSettings: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside tap / Escape — standard menu affordances.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "block rounded px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu proyek"
        className="inline-flex h-9 w-9 items-center justify-center rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--sand-dark)] hover:text-[var(--foreground)]"
      >
        <MoreIcon size={18} />
      </button>
      {open ? (
        <div
          role="menu"
          className="menu-pop absolute right-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)]"
        >
          <Link href={`/project/${projectCode}/print`} className={item} role="menuitem" onClick={() => setOpen(false)}>
            Cetak
          </Link>
          <Link href={`/project/${projectCode}/rooms`} className={item} role="menuitem" onClick={() => setOpen(false)}>
            Ruangan
          </Link>
          <Link href={`/project/${projectCode}/schedule`} className={item} role="menuitem" onClick={() => setOpen(false)}>
            Jadwal &amp; Readiness
          </Link>
          <Link href={`/project/${projectCode}/activity`} className={item} role="menuitem" onClick={() => setOpen(false)}>
            Aktivitas
          </Link>
          {showSettings ? (
            <Link
              href={`/project/${projectCode}/settings`}
              className={`${item} flex items-center gap-2`}
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <GearIcon size={14} /> Pengaturan
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
