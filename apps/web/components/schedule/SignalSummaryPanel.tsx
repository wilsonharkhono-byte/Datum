/**
 * Pengingat / Perlu tindakan panel — server component.
 *
 * Renders a severity-sorted digest of readiness signals for the project.
 * Empty → renders nothing (no empty-state clutter on healthy projects).
 */

import type { ProjectStepSignalRow } from "@/lib/steps/queries";
import type { StepSignalSeverity } from "@/lib/steps/signals";

// ─── Severity styling tokens (SANO palette — no raw hex) ─────────────────────

const SEVERITY_DOT: Record<StepSignalSeverity, string> = {
  critical: "bg-[var(--flag-critical)]",
  high: "bg-[var(--flag-high)]",
  warning: "bg-[var(--flag-warning)]",
  info: "bg-[var(--flag-info)]",
};

const SEVERITY_CHIP: Record<StepSignalSeverity, string> = {
  critical: "bg-[var(--flag-critical-bg)] text-[var(--flag-critical)]",
  high: "bg-[var(--flag-high-bg)] text-[var(--flag-high)]",
  warning: "bg-[var(--flag-warning-bg)] text-[var(--flag-warning)]",
  info: "bg-[var(--flag-info-bg)] text-[var(--flag-info)]",
};

const SEVERITY_LABEL: Record<StepSignalSeverity, string> = {
  critical: "Kritis",
  high: "Tinggi",
  warning: "Peringatan",
  info: "Info",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SignalSummaryPanel({
  signals,
}: {
  signals: ProjectStepSignalRow[];
}) {
  if (signals.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
        Pengingat · Perlu tindakan
      </h2>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        Langkah-langkah yang membutuhkan perhatian segera, diurutkan berdasarkan tingkat urgensi.
      </p>
      <div className="flex flex-col gap-1.5">
        {signals.map((row, idx) => (
          <div
            key={`${row.areaId}:${row.stepCode}:${row.signal.kind}:${idx}`}
            className="flex items-start gap-3 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
          >
            {/* Severity dot */}
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[row.signal.severity]}`}
              aria-hidden="true"
            />

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* Severity chip */}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_CHIP[row.signal.severity]}`}
                >
                  {SEVERITY_LABEL[row.signal.severity]}
                </span>
                {/* Area · Step label */}
                <span className="text-[11px] font-medium text-[var(--text-muted)]">
                  {row.areaName}
                  <span className="mx-1 text-[var(--text-muted)] opacity-50">·</span>
                  {row.stepName}
                </span>
              </div>
              {/* Main message */}
              <p className="mt-1 text-[13px] text-[var(--foreground)]">
                {row.signal.message}
              </p>
              {/* Optional detail */}
              {row.signal.detail ? (
                <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                  {row.signal.detail}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
