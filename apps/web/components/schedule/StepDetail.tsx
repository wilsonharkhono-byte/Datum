"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitStepUpdate, submitCheckpointResult, removeStep } from "@/lib/steps/actions";
import type { AreaStepRow } from "@/lib/steps/queries";

const STATUS_LABEL: Record<string, string> = {
  not_started: "Belum mulai",
  in_progress: "Berjalan",
  blocked: "Terblokir",
  done: "Selesai",
};

export function StepDetail({ step }: { step: AreaStepRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) { setNote(""); router.refresh(); }
      else setError(res.error);
    });
  }

  function setStatus(status: "not_started" | "in_progress" | "blocked" | "done") {
    if (status === "blocked") {
      const reason = window.prompt("Alasan terblokir?") ?? "";
      if (!reason.trim()) return;
      run(() => submitStepUpdate({ areaStepId: step.id, status, note: reason.trim() }));
      return;
    }
    run(() => submitStepUpdate({ areaStepId: step.id, status }));
  }

  function remove() {
    if (!window.confirm("Hapus langkah ini dari kamar mandi? Bisa dipulihkan nanti.")) return;
    run(() => removeStep({ areaStepId: step.id }));
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-3">
      <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
        {step.planned_start ? <span>Rencana {step.planned_start} – {step.planned_end}</span> : null}
        {step.assigned_trade ? <span>· {step.assigned_trade}</span> : null}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["not_started", "in_progress", "blocked", "done"] as const).map((s) => (
          <button key={s} type="button" disabled={pending} onClick={() => setStatus(s)}
            className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)] hover:border-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-1.5">
        <input value={note} disabled={pending} onChange={(e) => setNote(e.target.value)}
          placeholder="Tambah update progres…"
          className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] focus:border-[var(--sand-dark)] focus:outline-none md:min-h-0" />
        <button type="button" disabled={pending || !note.trim()}
          onClick={() => run(() => submitStepUpdate({ areaStepId: step.id, note: note.trim() }))}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sand-dark)] hover:border-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
          Catat
        </button>
      </div>

      {step.checkpoints.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {step.checkpoints.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[12px] text-[var(--foreground)]">
              <input type="checkbox" checked={c.result === "pass"} disabled={pending}
                onChange={(e) => run(() => submitCheckpointResult({ checkpointId: c.id, result: e.target.checked ? "pass" : "pending" }))} />
              <span>{c.item_text}</span>
              {c.severity === "kritis" ? <span className="ml-auto rounded-sm bg-red-100 px-1 text-[9px] font-bold uppercase text-red-700">kritis</span> : null}
            </label>
          ))}
        </div>
      ) : null}

      <div className="mt-3 border-t border-[var(--border)] pt-2">
        <button type="button" disabled={pending} onClick={remove}
          className="min-h-11 text-[11px] font-semibold text-[var(--text-muted)] hover:text-red-700 disabled:opacity-50 md:min-h-0">
          Hapus langkah
        </button>
      </div>

      {error ? <p className="mt-2 text-[11px] text-red-700">{error}</p> : null}
    </div>
  );
}
