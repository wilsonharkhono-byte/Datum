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
      {g.rows.map((r) => (
        <div key={r.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-4 py-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{r.name}</span>
          <span className="text-[11px] text-[var(--text-muted)]">
            Estimasi {r.estimate}h {r.metric === "lead_time" ? "lead time" : "durasi"}
          </span>
          {r.stats ? (
            <span className="text-[11px] text-[var(--text-muted)]">
              Aktual median {r.stats.median}h (n={r.stats.n}) · {r.stats.min}–{r.stats.max}h
            </span>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">Belum cukup data</span>
          )}
          {r.suggest !== null ? (
            <button type="button" disabled={pending} onClick={() => apply(r.code, r.suggest!, r.metric)}
              className="min-h-11 rounded border border-[var(--sand-dark)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
              Terapkan {r.suggest}h
            </button>
          ) : r.stats && r.stats.n < 5 ? (
            <span className="text-[10px] text-[var(--text-muted)]">Belum cukup data untuk saran</span>
          ) : null}
        </div>
      ))}
      {error ? <p className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--flag-critical)]">{error}</p> : null}
    </details>
  );
}

export function DurationLearningView({ groups }: { groups: Groups }) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => <GateSection key={g.gate} g={g} />)}
    </div>
  );
}
