import Link from "next/link";
import type { ProjectSlipRow } from "@/lib/steps/slip-risk-queries";

// Same level → label/class mapping as /risiko (apps/web/app/(app)/risiko/page.tsx)
// — the brief's forecast row is a summary sibling of that deep view, so the
// visual language must match exactly, not diverge.
const LEVEL: Record<string, { label: string; cls: string }> = {
  behind: { label: "Terlambat", cls: "bg-red-100 text-red-800" },
  at_risk: { label: "Berisiko", cls: "bg-amber-100 text-amber-800" },
  on_track: { label: "Aman", cls: "bg-green-100 text-green-800" },
};

/**
 * Forecast fold-in — per-project row (projected handover + slip-days +
 * bottleneck), reusing /risiko's own `getProjectsSlipRisk` query untouched.
 * Only the worst 5 projects are shown; /risiko remains the full deep view.
 */
export function ForecastSection({ rows }: { rows: ProjectSlipRow[] }) {
  const top = rows.slice(0, 5);

  return (
    <section className="rounded border border-[#B5AFA8] bg-[#FDFAF6] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#141210]">
          📅 Perkiraan serah terima
        </h2>
        {rows.length > top.length ? (
          <Link href="/risiko" className="text-[10px] uppercase tracking-wide text-[#7A6B56] hover:underline">
            lihat semua →
          </Link>
        ) : null}
      </div>
      {top.length === 0 ? (
        <p className="text-xs italic text-[#524E49]">Tidak ada proyek aktif.</p>
      ) : (
        <ol className="space-y-2">
          {top.map((r) => {
            const lv = LEVEL[r.risk.level] ?? LEVEL.on_track!;
            return (
              <li key={r.project.id} className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${lv.cls}`}>{lv.label}</span>
                  <Link
                    href={`/project/${r.project.code}/schedule`}
                    className="text-[13px] font-semibold text-[var(--foreground)] hover:underline"
                  >
                    {r.project.code} · {r.project.name}
                  </Link>
                </div>
                {r.risk.bottleneck ? (
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                    Penyebab utama: {r.risk.bottleneck.areaName} · {r.risk.bottleneck.stepName} — {r.risk.bottleneck.message}
                  </p>
                ) : null}
                {r.forecast.slipDays != null ? (
                  <p className={`mt-0.5 text-[11px] ${r.forecast.slipDays > 0 ? "text-red-700" : "text-[var(--text-muted)]"}`}>
                    Perkiraan handover {r.forecast.projectedHandover ?? "—"}
                    {r.forecast.slipDays > 0
                      ? ` · +${r.forecast.slipDays} hari dari target${r.forecast.worstArea ? ` (${r.forecast.worstArea.areaName})` : ""}`
                      : " · sesuai/di depan target"}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
