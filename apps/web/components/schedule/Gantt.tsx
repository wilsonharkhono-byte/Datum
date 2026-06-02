import type { ScheduledCell } from "@/lib/gates/schedule";

type Area = { id: string; area_name: string; area_code: string };
type Gate = { code: string; name: string };

const STATUS_BG: Record<string, string> = {
  not_started:        "bg-stone-200",
  in_progress:        "bg-amber-200",
  ready_for_handoff:  "bg-blue-200",
  blocked:            "bg-red-200",
  passed:             "bg-green-200",
  not_applicable:     "bg-stone-100",
};

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
        Schedule belum dihitung. Klik &quot;Hitung ulang schedule&quot; di atas.
      </div>
    );
  }

  // Compute the overall date range across all cells
  const allDates = cells.flatMap((c) => [c.target_start_date, c.target_end_date].filter((d): d is string => !!d));
  if (allDates.length === 0) return null;
  const minDate = new Date(allDates.reduce((a, b) => (a < b ? a : b)));
  const maxDate = new Date(allDates.reduce((a, b) => (a > b ? a : b)));
  const totalMs = maxDate.getTime() - minDate.getTime() || 1;

  function pctOf(dateStr: string): number {
    return ((new Date(dateStr).getTime() - minDate.getTime()) / totalMs) * 100;
  }

  // Group cells by area for row rendering
  const cellsByArea = new Map<string, ScheduledCell[]>();
  for (const c of cells) {
    const arr = cellsByArea.get(c.area_id) ?? [];
    arr.push(c);
    cellsByArea.set(c.area_id, arr);
  }

  const today = new Date();
  const todayPct = ((today.getTime() - minDate.getTime()) / totalMs) * 100;
  const todayInRange = todayPct >= 0 && todayPct <= 100;

  // Suppress unused variable warning — gates prop available for future axis labels
  void gates;

  return (
    <div className="overflow-x-auto">
      {/* Date axis */}
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
        <span>{minDate.toLocaleDateString("id-ID", { year: "numeric", month: "short" })}</span>
        <span>{maxDate.toLocaleDateString("id-ID", { year: "numeric", month: "short" })}</span>
      </div>

      <div className="min-w-[640px] space-y-2">
        {areas.map((area) => {
          const areaCells = cellsByArea.get(area.id) ?? [];
          return (
            <div key={area.id} className="flex items-center gap-3">
              <div className="w-40 flex-shrink-0 text-xs">
                <div className="font-semibold text-[var(--foreground)]">{area.area_name}</div>
                <div className="text-[10px] text-[var(--text-secondary)]">{area.area_code}</div>
              </div>
              <div className="relative h-6 flex-1 overflow-hidden rounded bg-[var(--surface-alt)]">
                {areaCells.map((c) => {
                  if (!c.target_start_date || !c.target_end_date) return null;
                  const left = pctOf(c.target_start_date);
                  const right = pctOf(c.target_end_date);
                  const width = Math.max(2, right - left);
                  return (
                    <div
                      key={c.gate_code}
                      className={`absolute top-0 h-full opacity-80 ${STATUS_BG[c.status] ?? "bg-stone-300"}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${c.gate_code} · ${c.status} · ${c.target_start_date} → ${c.target_end_date}`}
                    >
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[var(--foreground)]">
                        {c.gate_code}
                      </span>
                    </div>
                  );
                })}
                {todayInRange ? (
                  <div
                    className="absolute top-0 h-full w-px bg-red-600"
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
      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-[var(--text-secondary)]">
        {Object.entries(STATUS_BG).map(([status, bg]) => (
          <span key={status} className="flex items-center gap-1">
            <span className={`inline-block h-3 w-4 rounded ${bg}`} />
            {status}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-0.5 bg-red-600" /> hari ini
        </span>
      </div>
    </div>
  );
}
