"use client";
import { useState, useTransition } from "react";
import { recomputeProjectSchedule } from "@/lib/gates/schedule";

/**
 * Part B backfill trigger: re-derives kickoff-based gate windows
 * (area_gate_status.target_start_date/target_end_date) and cascades them onto
 * area_steps.planned_start/planned_end for every area in the project. Distinct
 * from RecomputeButton (readiness status from card_events) — this recomputes
 * *schedule* windows, the input signals need to fire lead-time warnings.
 */
export function RecomputeScheduleButton({
  projectId,
  projectCode,
}: {
  projectId: string;
  projectCode: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function recompute() {
    setMessage(null);
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    startTransition(async () => {
      const res = await recomputeProjectSchedule(fd);
      if (res.ok) setMessage(`✓ ${res.cellsUpdated} jadwal sel diperbarui`);
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {message ? <span className="text-[11px] text-green-700">{message}</span> : null}
      {error ? <span className="text-[11px] text-red-700">{error}</span> : null}
      <button
        type="button"
        onClick={recompute}
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded border border-[#141210] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#141210] hover:bg-[var(--sand-tint)] disabled:opacity-50 md:min-h-0"
        title="Hitung ulang jadwal dari kickoff_date + cascade ke planned_start/end tiap step"
      >
        {pending ? "Menghitung…" : "Hitung ulang jadwal"}
      </button>
    </div>
  );
}
