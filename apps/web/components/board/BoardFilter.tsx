"use client";

export type StatusFilter = Set<"active" | "dormant" | "closed">;

const STATUS_LABELS: Record<"active" | "dormant" | "closed", string> = {
  active:  "Aktif",
  dormant: "Tertunda",
  closed:  "Selesai",
};

export function BoardFilter({
  query,
  onQueryChange,
  statuses,
  onStatusesChange,
  matched,
  total,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  statuses: StatusFilter;
  onStatusesChange: (s: StatusFilter) => void;
  matched: number;
  total: number;
}) {
  function toggle(s: "active" | "dormant" | "closed") {
    const next = new Set(statuses);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    if (next.size === 0) next.add(s); // never empty
    onStatusesChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Cari judul atau ringkasan kartu…"
        className="w-56 rounded border border-[var(--border)] px-2 py-1 text-xs focus:border-[var(--sand-dark)] focus:outline-none"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQueryChange("")}
          className="text-[10px] text-[var(--text-muted)] hover:underline"
        >
          × bersihkan
        </button>
      ) : null}
      <span className="ml-2 text-[10px] uppercase tracking-wide text-[#7A6B56]">status:</span>
      <div className="flex gap-1">
        {(["active", "dormant", "closed"] as const).map((s) => {
          const on = statuses.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={
                "rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                (on
                  ? "border-[#141210] bg-[#141210] text-white"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--text-secondary)]")
              }
            >
              {STATUS_LABELS[s]}
            </button>
          );
        })}
      </div>
      <span className="ml-auto text-[10px] text-[#7A6B56]">
        {matched === total ? `${total} kartu` : `${matched} dari ${total} kartu cocok`}
      </span>
    </div>
  );
}
