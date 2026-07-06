/**
 * At-a-glance health strip for the Jadwal & Readiness page — server component.
 *
 * Renders the summarizeSchedule() output as compact stat pills. The critical/high
 * pill picks up a flag tint so a red project reads at a glance; the rest stay on
 * the neutral surface.
 */

import type { ScheduleHealth } from "./health-summary";

function Pill({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <div
      className={`min-w-[8rem] flex-1 rounded border border-[var(--border)] px-3 py-2 ${
        tint ?? "bg-[var(--surface)]"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">
        {label}
      </div>
      <div className="text-sm font-semibold text-[var(--foreground)]">
        {value}
      </div>
    </div>
  );
}

export function HealthStrip({
  health,
  lastRecomputedAt,
}: {
  health: ScheduleHealth;
  lastRecomputedAt: string | null;
}) {
  const { critical, high, total, nextDeadline, gateProgressPct } = health;

  const kritisTint =
    critical > 0
      ? "bg-[var(--flag-critical-bg)]"
      : high > 0
        ? "bg-[var(--flag-high-bg)]"
        : "bg-[var(--surface)]";

  const deadlineValue = nextDeadline
    ? `${new Date(`${nextDeadline.date}T00:00:00`).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
      })} · Gate ${nextDeadline.gateCode}${
        nextDeadline.areaCount > 1 ? ` (${nextDeadline.areaCount} area)` : ""
      }`
    : "—";

  const lastValue = lastRecomputedAt
    ? new Date(lastRecomputedAt).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Belum pernah";

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <Pill label="Kritis / Tinggi" value={`${critical} / ${high}`} tint={kritisTint} />
      <Pill label="Perlu tindakan" value={String(total)} />
      <Pill label="Deadline terdekat" value={deadlineValue} />
      <Pill label="Progress gate" value={`${gateProgressPct}%`} />
      <Pill label="Terakhir dihitung" value={lastValue} />
    </div>
  );
}
