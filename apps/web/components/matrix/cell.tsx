import type { MatrixCell } from "@/lib/matrix/fetch-matrix";
import { gateShortName } from "@/lib/gates/labels";

const colorByStatus: Record<MatrixCell["status"], string> = {
  not_started: "bg-[var(--surface-alt)] text-[var(--text-muted)]",
  in_progress: "bg-[var(--flag-warning-bg)] text-[var(--flag-warning)]",
  ready_for_handoff: "bg-[var(--flag-info-bg)] text-[var(--flag-info)]",
  blocked: "bg-[var(--flag-critical-bg)] text-[var(--flag-critical)]",
  passed: "bg-[var(--flag-ok-bg)] text-[var(--flag-ok)]",
  not_applicable: "bg-[var(--oat-deep)]/45 text-[var(--text-muted)]",
};

const symbolByStatus: Record<MatrixCell["status"], string> = {
  not_started: "·",
  in_progress: "▶",
  ready_for_handoff: "►",
  blocked: "■",
  passed: "✓",
  not_applicable: "—",
};

const labelByStatus: Record<MatrixCell["status"], string> = {
  not_started: "Belum",
  in_progress: "Jalan",
  ready_for_handoff: "Siap",
  blocked: "Blokir",
  passed: "Lulus",
  not_applicable: "N/A",
};

/** Table-cell variant (used in the md+ matrix table) */
export function Cell({ cell }: { cell: MatrixCell | undefined }) {
  if (!cell) return <td className="border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-2 text-center text-[var(--text-muted)]">.</td>;
  const cls = colorByStatus[cell.status];
  const sym = symbolByStatus[cell.status];
  const title = cell.blocking_reason ? `${cell.status}: ${cell.blocking_reason}` : cell.status;
  return (
    <td
      title={title}
      className={`border border-[var(--border)] px-2 py-2 text-center text-sm font-semibold ${cls}`}
    >
      {sym}
    </td>
  );
}

/** Compact chip variant (used in mobile stacked cards) */
export function CellChip({
  cell,
  gate,
}: {
  cell: MatrixCell | undefined | null;
  gate: string;
}) {
  const status = cell?.status ?? "not_started";
  const cls = colorByStatus[status];
  const sym = symbolByStatus[status];
  const label = labelByStatus[status];
  const shortName = gateShortName(gate);
  const title = cell?.blocking_reason
    ? `Gate ${gate} · ${shortName} · ${status}: ${cell.blocking_reason}`
    : `Gate ${gate} · ${shortName} · ${status}`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold ${cls}`}
    >
      <span aria-hidden="true">{sym}</span>
      <span>{gate} · {shortName}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
