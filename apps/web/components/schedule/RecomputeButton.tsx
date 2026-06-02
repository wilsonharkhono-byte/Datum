"use client";
import { useState, useTransition } from "react";
import { recomputeAreaGateStatus } from "@/lib/gates/recompute";

export function RecomputeButton({
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
      const res = await recomputeAreaGateStatus(fd);
      if (res.ok) setMessage(`✓ ${res.cellsUpdated} sel diperbarui (rule v${res.ruleVersion})`);
      else setError(res.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {message ? <span className="text-[11px] text-green-700">{message}</span> : null}
      {error ? <span className="text-[11px] text-red-700">{error}</span> : null}
      <button
        type="button"
        onClick={recompute}
        disabled={pending}
        className="rounded bg-[#141210] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#FDFAF6] hover:bg-[#3a3527] disabled:bg-[var(--text-muted)]"
      >
        {pending ? "Menghitung…" : "Hitung ulang readiness"}
      </button>
    </div>
  );
}
