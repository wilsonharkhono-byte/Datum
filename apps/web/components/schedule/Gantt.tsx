"use client";
import { useState } from "react";
import type { ScheduledCell } from "@/lib/gates/schedule-overlay";
import { gateShortName } from "@/lib/gates/labels";
import { STATUS_STYLE, STATUS_LABELS } from "./status-style";

type Area = { id: string; area_name: string; area_code: string };
type Gate = { code: string; name: string };

const ROW_HEIGHT = 22;

export function Gantt({
  areas,
  gates,
  cells,
  todayIso,
}: {
  areas: Area[];
  gates: Gate[];
  cells: ScheduledCell[];
  /** Server-provided WIB date (YYYY-MM-DD) so SSR and hydration agree. */
  todayIso: string;
}) {
  // Bar details used to live only in `title` tooltips — unreachable on touch.
  // Tapping/clicking a bar now selects it and shows the detail strip below.
  const [selected, setSelected] = useState<ScheduledCell | null>(null);

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

  const today = new Date(todayIso);
  const todayPct = ((today.getTime() - minDate.getTime()) / totalMs) * 100;
  const todayInRange = todayPct >= 0 && todayPct <= 100;

  const orderedGates = gates.length > 0 ? gates : inferGates(cells);
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const selectedArea = selected ? areaById.get(selected.area_id) : null;

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
                            areaName={area.area_name}
                            left={pctOf(cell.target_start_date)}
                            right={pctOf(cell.target_end_date)}
                            isSelected={selected === cell}
                            onSelect={() =>
                              setSelected((prev) => (prev === cell ? null : cell))
                            }
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

        {/* Selected bar detail — tap a bar to fill this (title tooltips don't
            exist on touch). */}
        {selected && selectedArea ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--foreground)]">
              {selectedArea.area_name} · Gate {selected.gate_code}
            </span>
            <span>{gateShortName(selected.gate_code)}</span>
            <span
              className="rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                background: (STATUS_STYLE[selected.status] ?? STATUS_STYLE.not_started!).bg,
                borderColor: (STATUS_STYLE[selected.status] ?? STATUS_STYLE.not_started!).border,
                color: (STATUS_STYLE[selected.status] ?? STATUS_STYLE.not_started!).fg,
              }}
            >
              {STATUS_LABELS[selected.status] ?? selected.status}
            </span>
            <span>
              {selected.target_start_date} → {selected.target_end_date}
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="ml-auto min-h-11 px-2 text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--foreground)] md:min-h-0"
            >
              tutup
            </button>
          </div>
        ) : null}

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
  areaName,
  left,
  right,
  isSelected,
  onSelect,
}: {
  cell: ScheduledCell;
  areaName: string;
  left: number;
  right: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const style = STATUS_STYLE[cell.status] ?? STATUS_STYLE.not_started!;
  const width = Math.max(0.4, right - left);
  const label = `${areaName} · Gate ${cell.gate_code} · ${gateShortName(cell.gate_code)} · ${STATUS_LABELS[cell.status] ?? cell.status} · ${cell.target_start_date} → ${cell.target_end_date}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={isSelected}
      className="absolute rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sand-dark)]"
      style={{
        left: `${left}%`,
        width: `${width}%`,
        top: "3px",
        bottom: "3px",
        background: style.bg,
        border: isSelected ? `2px solid ${style.border}` : `1px solid ${style.border}`,
      }}
      title={label}
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
