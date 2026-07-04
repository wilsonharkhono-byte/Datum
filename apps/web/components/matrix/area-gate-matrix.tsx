import type { MatrixData } from "@/lib/matrix/fetch-matrix";
import Link from "next/link";
import { Fragment } from "react";
import { Cell, CellChip } from "./cell";
import { StatusLegend } from "./status-legend";
import { gateShortName } from "@/lib/gates/labels";

export function AreaGateMatrix({ data }: { data: MatrixData }) {
  const byFloor = new Map<string, typeof data.areas>();
  for (const a of data.areas) {
    const floor = a.floor ?? "-";
    if (!byFloor.has(floor)) byFloor.set(floor, []);
    byFloor.get(floor)!.push(a);
  }

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
            Matrix area x gate
          </p>
          <h2 className="text-xl font-semibold text-[var(--foreground)]">
            {data.project_code} · {data.project_name}
          </h2>
        </div>
        <div className="rounded-[5px] bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          {data.areas.length} area · {data.gates.length} gate
        </div>
      </div>

      {/* Zero areas: without this the header rendered over an empty void and a
          new project looked broken instead of pointing at settings. */}
      {data.areas.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-secondary)]">
          <p className="font-medium text-[var(--foreground)]">Proyek ini belum punya area.</p>
          <p className="mt-2">
            Matrix readiness dihitung per area (ruangan). Tambahkan area dulu di
            pengaturan proyek, lalu klik &quot;Hitung ulang readiness&quot;.
          </p>
          <Link
            href={`/project/${data.project_code}/settings?tab=areas`}
            className="mt-3 inline-flex min-h-11 items-center rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--sand-dark)] hover:text-[var(--foreground)]"
          >
            Buka Pengaturan → Areas
          </Link>
        </div>
      ) : null}

      {/* Mobile: stacked area cards (below md) */}
      <div className="md:hidden">
        {Array.from(byFloor.entries()).map(([floor, areas]) => (
          <div key={floor}>
            <div className="mb-2 mt-3 px-1 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
              {floor}
            </div>
            {areas.map((area) => (
              <div
                key={area.id}
                className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-[var(--foreground)]">{area.area_name}</span>
                  <span className="text-xs text-[var(--sand-dark)]">{area.area_code}</span>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {data.gates.map((gate) => {
                    const cell = data.cells.get(`${area.id}|${gate}`);
                    return (
                      <li key={gate}>
                        <CellChip cell={cell ?? null} gate={gate} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Desktop: matrix table (md+) */}
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-[760px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-[var(--foreground)] bg-[var(--foreground)] px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[var(--surface)]">
                Area
              </th>
              {data.gates.map((g) => (
                <th
                  key={g}
                  className="border border-[var(--foreground)] bg-[var(--foreground)] px-3 py-3 text-center text-xs font-semibold uppercase tracking-[0.08em] text-[var(--surface)]"
                >
                  <span className="block text-[10px] tracking-[0.1em] text-[var(--surface)]/70">Gate {g}</span>
                  <span className="block normal-case tracking-normal">{gateShortName(g)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(byFloor.entries()).map(([floor, areas]) => (
              <Fragment key={floor}>
                <tr>
                  <td
                    colSpan={data.gates.length + 1}
                    className="border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]"
                  >
                    {floor}
                  </td>
                </tr>
                {areas.map((a) => (
                  <tr key={a.id}>
                    <td className="border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-sm font-medium text-[var(--foreground)]">
                      {a.area_name}
                    </td>
                    {data.gates.map((g) => (
                      <Cell key={`${a.id}-${g}`} cell={data.cells.get(`${a.id}|${g}`)} />
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <StatusLegend />
    </div>
  );
}
