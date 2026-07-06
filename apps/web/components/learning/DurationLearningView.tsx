"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyLearnedDuration, applyLearnedLeadTime } from "@/lib/learning/actions";
import type { getDurationLearning } from "@/lib/learning/queries";

type Groups = Awaited<ReturnType<typeof getDurationLearning>>;

function GateSection({ g }: { g: Groups[number] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function apply(code: string, days: number, metric: "duration" | "lead_time") {
    setError(null);
    startTransition(async () => {
      const r = metric === "lead_time"
        ? await applyLearnedLeadTime({ code, days })
        : await applyLearnedDuration({ code, days });
      if (r.ok) router.refresh(); else setError(r.error);
    });
  }

  return (
    <details className="rounded border border-[var(--border)] bg-[var(--surface)]" open>
      <summary className="min-h-11 cursor-pointer px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--foreground)] md:min-h-0">
        {g.gate} · {g.gateName}
      </summary>
      {g.rows.map((r) => {
        const metricLabel = r.metric === "lead_time" ? "lead time" : "durasi";
        // Accent the row when the learned median diverges from the current
        // estimate by more than 50% — the cases actually worth acting on.
        const diverges =
          r.stats != null && r.estimate > 0 &&
          Math.abs(r.stats.median - r.estimate) / r.estimate > 0.5;
        return (
          <div
            key={r.code}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-4 py-2 text-[13px] ${
              diverges ? "bg-[var(--sand-tint)]" : ""
            }`}
          >
            <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{r.name}</span>
            {/* Stats group — shrinks/wraps, keeps the apply button in its own trailing cell */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-[11px] text-[var(--text-muted)]">
                <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Estimasi</span>{" "}
                <span className="font-semibold text-[var(--foreground)]">{r.estimate}h</span> {metricLabel}
              </span>
              {r.stats ? (
                <span className="text-[11px] text-[var(--text-muted)]">
                  <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Aktual</span>{" "}
                  <span className="font-semibold text-[var(--foreground)]">{r.stats.median}h</span>{" "}
                  median (n={r.stats.n}) · {r.stats.min}–{r.stats.max}h
                </span>
              ) : (
                <span className="text-[11px] italic text-[var(--text-muted)]">Belum cukup data</span>
              )}
            </div>
            {/* Trailing action cell — never shrinks */}
            <div className="shrink-0">
              {r.suggest !== null ? (
                <button type="button" disabled={pending} onClick={() => apply(r.code, r.suggest!, r.metric)}
                  className="min-h-11 rounded border border-[var(--sand-dark)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
                  Terapkan {r.suggest}h
                </button>
              ) : r.stats && r.stats.n < 5 ? (
                <span className="text-[10px] italic text-[var(--text-muted)]">Belum cukup untuk saran</span>
              ) : null}
            </div>
          </div>
        );
      })}
      {error ? <p className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--flag-critical)]">{error}</p> : null}
    </details>
  );
}

export function DurationLearningView({ groups }: { groups: Groups }) {
  if (groups.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--border)] p-6 text-center text-sm italic text-[var(--text-secondary)]">
        Belum ada langkah untuk dianalisa. Data muncul setelah langkah selesai dan durasinya tercatat.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => <GateSection key={g.gate} g={g} />)}
    </div>
  );
}
