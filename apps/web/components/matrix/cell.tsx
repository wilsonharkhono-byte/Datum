import type { MatrixCell } from "@/lib/matrix/fetch-matrix";

const colorByStatus: Record<MatrixCell["status"], string> = {
  not_started: "bg-[#F2EFE9] text-[#847E78]",
  in_progress: "bg-[rgba(230,81,0,0.10)] text-[#E65100]",
  ready_for_handoff: "bg-[rgba(21,101,192,0.08)] text-[#1565C0]",
  blocked: "bg-[rgba(198,40,40,0.08)] text-[#C62828]",
  passed: "bg-[rgba(61,139,64,0.08)] text-[#3D8B40]",
  not_applicable: "bg-[#C6C1B6]/45 text-[#847E78]",
};

const symbolByStatus: Record<MatrixCell["status"], string> = {
  not_started: "·",
  in_progress: "▶",
  ready_for_handoff: "►",
  blocked: "■",
  passed: "✓",
  not_applicable: "—",
};

export function Cell({ cell }: { cell: MatrixCell | undefined }) {
  if (!cell) return <td className="border border-[#B5AFA8] bg-[#F2EFE9] px-2 py-2 text-center text-[#847E78]">.</td>;
  const cls = colorByStatus[cell.status];
  const sym = symbolByStatus[cell.status];
  const title = cell.blocking_reason ? `${cell.status}: ${cell.blocking_reason}` : cell.status;
  return (
    <td
      title={title}
      className={`border border-[#B5AFA8] px-2 py-2 text-center text-sm font-semibold ${cls}`}
    >
      {sym}
    </td>
  );
}
