import type { RoomStage } from "@/lib/rooms/derive";
import { gateShortName } from "@/lib/gates/labels";

// Same palette/symbols as the matrix legend (components/matrix/cell.tsx +
// status-legend.tsx) so the Ruangan surface and the detail matrix read as one
// system. Keys map the room's single derived stage onto a cell status.
type ChipStyle = { cls: string; sym: string };

const STAGE_STYLE: Record<
  "blocked" | "in_progress" | "ready_for_handoff" | "passed" | "none",
  ChipStyle
> = {
  blocked: { cls: "bg-[rgba(198,40,40,0.08)] text-[#C62828]", sym: "■" },
  in_progress: { cls: "bg-[rgba(230,81,0,0.10)] text-[#E65100]", sym: "▶" },
  ready_for_handoff: { cls: "bg-[rgba(21,101,192,0.08)] text-[#1565C0]", sym: "►" },
  passed: { cls: "bg-[rgba(61,139,64,0.08)] text-[#3D8B40]", sym: "✓" },
  none: { cls: "bg-[#F2EFE9] text-[#847E78]", sym: "·" },
};

export function StageChip({ stage }: { stage: RoomStage }) {
  let style: ChipStyle = STAGE_STYLE.none;
  let label = "Belum mulai";

  if (stage.kind === "active") {
    style = stage.status === "blocked" ? STAGE_STYLE.blocked : STAGE_STYLE.in_progress;
    label = `Gate ${stage.gate} · ${gateShortName(stage.gate)}`;
  } else if (stage.kind === "passed") {
    style = STAGE_STYLE.passed;
    label = `Gate ${stage.gate} · ${gateShortName(stage.gate)} selesai`;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold ${style.cls}`}
    >
      <span aria-hidden="true">{style.sym}</span>
      <span>{label}</span>
    </span>
  );
}
