import type { ScheduledCell } from "@/lib/gates/schedule-overlay";
import { gateShortName } from "@/lib/gates/labels";

type Area = { id: string; area_name: string; area_code: string };
type Gate = { code: string; name: string };

/** Brand-aligned status palette. Soft tints on warm surfaces, never the
 *  generic stone/amber/blue/green/red — those got swept earlier and no
 *  longer exist as Tailwind utilities. Values used inline so they can't
 *  silently disappear if the JIT misses them. */
const STATUS_STYLE: Record<string, { bg: string; fg: string; border: string }> = {
  not_started:       { bg: "#e9e5dd", fg: "#524e49", border: "#cfc8bc" },
  in_progress:       { bg: "rgba(230, 81, 0, 0.18)",  fg: "#9a3c00", border: "#e65100" },
  ready_for_handoff: { bg: "rgba(21, 101, 192, 0.18)", fg: "#0d3d77", border: "#1565c0" },
  blocked:           { bg: "rgba(191, 54, 12, 0.18)",  fg: "#7a2208", border: "#bf360c" },
  passed:            { bg: "rgba(61, 139, 64, 0.18)",  fg: "#235425", border: "#3d8b40" },
  not_applicable:    { bg: "#f2efe9", fg: "#847e78", border: "#d8d3ca" },
};

const STATUS_LABELS: Record<string, string> = {
  not_started:       "Belum mulai",
  in_progress:       "Dikerjakan",
  ready_for_handoff: "Siap handoff",
  blocked:           "Terblokir",
  passed:            "Lulus",
  not_applicable:    "Tidak relevan",
};

const ROW_HEIGHT = 22;

export function Gantt({
  areas,
  gates,
  cells,
}: {
  areas: Area[];
  gates: Gate[];
  cells: ScheduledCell[];
}) {
  if (cells.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--border)] p-6 text-center text-sm italic text-[var(--text-secondary)]">
        Schedule belum dihitung. Klik &quot;Hitung ulang readiness&quot; di kanan atas.
      </div>
    );
  }

  const validDates = cells.flatMap((c) =>
    [c.target_start_date, c.target_end_date].filter((d): d is string => !!d),
  );
  if (validDates.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--border)] p-6 text-center text-sm italic text-[var(--text-secondary)]">
        Belum ada tanggal target. Set <code>kickoff_date</code> di proyek lalu hitung ulang.
      </div>
    );
  }

  const minDate = new Date(validDates.reduce((a, b) => (a < b ? a : b)));
  const maxDate = new Date(validDates.reduce((a, b) => (a > b ? a : b)));
  const totalMs = Math.max(1, maxDate.getTime() - minDate.getTime());
  const pctOf = (dateStr: string) =>
    Math.max(0, Math.min(100, ((new Date(dateStr).getTime() - minDate.getTime()) / totalMs) * 100));

  const monthTicks = monthsBetween(minDate, maxDate);

  const cellsByArea = new Map<string, ScheduledCell[]>();
  for (const c of cells) {
    const arr = cellsByArea.get(c.area_id) ?? [];
    arr.push(c);
    cellsByArea.set(c.area_id, arr);
  }

  const today = new Date();
  const todayPct = ((today.getTime() - minDate.getTime()) / totalMs) * 100;
  const todayInRange = todayPct >= 0 && todayPct <= 100;

  const orderedGates = gates.length > 0 ? gates : inferGates(cells);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[960px]">
        {/* Month axis */}
        <div className="ml-[19rem] mb-2 grid" style={{ gridTemplateColumns: `repeat(${monthTicks.length}, 1fr)` }}>
          {monthTicks.map((t, i) => (
            <div
              key={t.toISOString()}
              className="border-l border-[var(--border-sub)] pl-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
            >
              {i === 0 || t.getMonth() === 0
                ? t.toLocaleDateString("id-ID", { month: "short", year: "numeric" })
                : t.toLocaleDateString("id-ID", { month: "short" })}
            </div>
          ))}
        </div>

        <div className="rounded border border-[var(--border)] bg-[var(--surface)]">
          {areas.map((area, areaIdx) => {
            const areaCells = cellsByArea.get(area.id) ?? [];
            const cellByGate = new Map(areaCells.map((c) => [c.gate_code, c]));
            const totalHeight = orderedGates.length * ROW_HEIGHT;
            return (
              <div
                key={area.id}
                className={`flex items-stretch ${areaIdx > 0 ? "border-t border-[var(--border)]" : ""}`}
              >
                <div className="flex w-44 flex-shrink-0 flex-col justify-center border-r border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2">
                  <div className="text-xs font-semibold text-[var(--foreground)]">
                    {area.area_name}
                  </div>
                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]">
                    {area.area_code}
                  </div>
                </div>

                <div className="flex w-32 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface-alt)]">
                  {orderedGates.map((g) => (
                    <div
                      key={g.code}
                      className="flex items-center gap-1.5 px-2 text-[10px] text-[var(--text-secondary)]"
                      style={{ height: `${ROW_HEIGHT}px` }}
                      title={`Gate ${g.code} · ${gateShortName(g.code)}`}
                    >
                      <span className="inline-flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-sm bg-[var(--surface)] text-[9px] font-bold">
                        {g.code}
                      </span>
                      <span className="truncate font-medium">{gateShortName(g.code)}</span>
                    </div>
                  ))}
                </div>

                <div className="relative flex-1" style={{ height: `${totalHeight}px` }}>
                  {/* Month grid lines */}
                  <div className="absolute inset-0 grid pointer-events-none" style={{ gridTemplateColumns: `repeat(${monthTicks.length}, 1fr)` }}>
                    {monthTicks.map((t) => (
                      <div key={t.toISOString()} className="border-l border-[var(--border-sub)]" />
                    ))}
                  </div>

                  {/* Gate rows */}
                  {orderedGates.map((g, gateIdx) => {
                    const cell = cellByGate.get(g.code);
                    const rowTop = gateIdx * ROW_HEIGHT;
                    return (
                      <div
                        key={g.code}
                        className="absolute left-0 right-0 flex items-center"
                        style={{ top: `${rowTop}px`, height: `${ROW_HEIGHT}px` }}
                      >
                        {cell && cell.target_start_date && cell.target_end_date ? (
                          <GateBar
                            cell={cell}
                            left={pctOf(cell.target_start_date)}
                            right={pctOf(cell.target_end_date)}
                          />
                        ) : null}
                      </div>
                    );
                  })}

                  {/* Today line */}
                  {todayInRange ? (
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-[var(--flag-critical)]"
                      style={{ left: `${todayPct}%` }}
                      title={`Hari ini · ${today.toLocaleDateString("id-ID")}`}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-[var(--text-secondary)]">
          {Object.entries(STATUS_STYLE).map(([status, s]) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-5 rounded-sm border"
                style={{ background: s.bg, borderColor: s.border }}
              />
              {STATUS_LABELS[status] ?? status}
            </span>
          ))}
          {todayInRange ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-0.5 bg-[var(--flag-critical)]" /> Hari ini
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GateBar({
  cell,
  left,
  right,
}: {
  cell: ScheduledCell;
  left: number;
  right: number;
}) {
  const style = STATUS_STYLE[cell.status] ?? STATUS_STYLE.not_started!;
  const width = Math.max(0.4, right - left);
  return (
    <div
      className="absolute rounded-sm"
      style={{
        left: `${left}%`,
        width: `${width}%`,
        top: "3px",
        bottom: "3px",
        background: style.bg,
        border: `1px solid ${style.border}`,
      }}
      title={`Gate ${cell.gate_code} · ${gateShortName(cell.gate_code)} · ${STATUS_LABELS[cell.status] ?? cell.status} · ${cell.target_start_date} → ${cell.target_end_date}`}
    />
  );
}

function monthsBetween(min: Date, max: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(min.getFullYear(), min.getMonth(), 1);
  while (cursor <= max) {
    out.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (out.length === 0) out.push(new Date(min.getFullYear(), min.getMonth(), 1));
  return out;
}

function inferGates(cells: ScheduledCell[]): Gate[] {
  const seen = new Set<string>();
  const out: Gate[] = [];
  for (const c of cells) {
    if (seen.has(c.gate_code)) continue;
    seen.add(c.gate_code);
    out.push({ code: c.gate_code, name: c.gate_code });
  }
  out.sort((a, b) => a.code.localeCompare(b.code));
  return out;
}
