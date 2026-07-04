import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectsSlipRisk } from "@/lib/steps/slip-risk-queries";

const LEVEL: Record<string, { label: string; cls: string }> = {
  behind: { label: "Terlambat", cls: "bg-[var(--flag-critical-bg)] text-[var(--flag-critical)]" },
  at_risk: { label: "Berisiko", cls: "bg-[var(--flag-high-bg)] text-[var(--flag-high)]" },
  on_track: { label: "Aman", cls: "bg-[var(--flag-ok-bg)] text-[var(--flag-ok)]" },
};

export default async function SlipRiskPage() {
  const supabase = await createSupabaseServerClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const now = new Date().toISOString();
  const rows = await getProjectsSlipRisk(supabase, today, now);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-[var(--foreground)]">Risiko Keterlambatan</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Proyek aktif diurutkan dari yang paling berisiko terlambat, beserta penyebab utamanya.</p>

      {rows.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-[var(--border)] p-6 text-center text-sm italic text-[var(--text-secondary)]">
          Tidak ada proyek aktif.
        </div>
      ) : null}

      <ol className="mt-6 space-y-2">
        {rows.map((r) => {
          const lv = LEVEL[r.risk.level] ?? LEVEL.on_track!;
          return (
            <li key={r.project.id} className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${lv.cls}`}>{lv.label}</span>
                <Link href={`/project/${r.project.code}/schedule`} className="text-[13px] font-semibold text-[var(--foreground)] hover:underline">
                  {r.project.code} · {r.project.name}
                </Link>
                <span className="flex-1" />
                {r.risk.behindCount > 0 ? <span className="text-[10px] text-[var(--flag-critical)]">{r.risk.behindCount} terlambat</span> : null}
                {r.risk.atRiskCount > 0 ? <span className="text-[10px] text-[var(--sand-dark)]">{r.risk.atRiskCount} berisiko</span> : null}
              </div>
              {r.risk.bottleneck ? (
                <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                  Penyebab utama: {r.risk.bottleneck.areaName} · {r.risk.bottleneck.stepName} — {r.risk.bottleneck.message}
                </p>
              ) : null}
              {r.forecast.slipDays != null ? (
                <p className={`mt-0.5 text-[11px] ${r.forecast.slipDays > 0 ? "text-[var(--flag-critical)]" : "text-[var(--text-muted)]"}`}>
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
    </div>
  );
}
