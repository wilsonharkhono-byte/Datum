"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAreaTargetDate } from "@/lib/gates/area-target";

function formatTanggal(iso: string): string {
  // iso is YYYY-MM-DD; parse as UTC so the displayed day never shifts.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * R4 — inline per-area handover target editor. Collapsed it shows the current
 * target ("Target: 12 Mar 2026") or "Set target"; tapping opens a date input
 * with Simpan / Hapus. Saving re-baselines the area's derived gate windows.
 * Mobile-first: 44px touch targets, collapses to compact on >=md.
 */
export function AreaTargetEditor({
  areaId,
  projectId,
  initialTarget,
}: {
  areaId: string;
  projectId: string;
  initialTarget: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(initialTarget);
  const [draft, setDraft] = useState<string>(initialTarget ?? "");
  const [error, setError] = useState<string | null>(null);

  function save(value: string | null) {
    setError(null);
    startTransition(async () => {
      const res = await setAreaTargetDate({ areaId, projectId, targetDate: value });
      if (res.ok) {
        setTarget(value);
        setOpen(false);
        router.refresh(); // re-pull overlaid schedule cells
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(target ?? "");
          setError(null);
          setOpen(true);
        }}
        className={`mt-1 inline-flex min-h-11 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] font-medium hover:bg-[var(--sand-tint)] md:min-h-0 ${
          target ? "text-[var(--sand-dark)]" : "text-[var(--text-muted)]"
        }`}
        aria-label={target ? "Ubah target handover area" : "Set target handover area"}
      >
        {target ? (
          <>
            <span aria-hidden>🎯</span>
            <span>Target: {formatTanggal(target)}</span>
          </>
        ) : (
          <>
            <span aria-hidden>＋</span>
            <span>Set target</span>
          </>
        )}
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-1">
      <input
        type="date"
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Tanggal target handover area"
        className="min-h-11 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] focus:border-[var(--sand-dark)] focus:outline-none md:min-h-0"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => draft && save(draft)}
          disabled={pending || !draft}
          className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] font-semibold text-[var(--sand-dark)] hover:border-[var(--sand-dark)] disabled:opacity-50 md:min-h-0"
        >
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
        {target ? (
          <button
            type="button"
            onClick={() => save(null)}
            disabled={pending}
            className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--flag-critical)] disabled:opacity-50 md:min-h-0"
            aria-label="Hapus target, kembali ke jadwal default"
          >
            Hapus
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="min-h-11 rounded px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--foreground)] disabled:opacity-50 md:min-h-0"
          aria-label="Batal"
        >
          Batal
        </button>
      </div>
      {error ? <span className="text-[10px] text-[var(--flag-critical)]">{error}</span> : null}
    </div>
  );
}
