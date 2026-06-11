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
        className="w-full rounded border border-[var(--border)] px-2 py-1 text-xs focus:border-[var(--sand-dark)] focus:outline-none sm:w-56"
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
      <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7A6B56]">status</span>
      <div className="flex gap-1.5">
        {(["active", "dormant", "closed"] as const).map((s) => {
          const on = statuses.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              aria-pressed={on}
              className={`chip${on ? " chip-on" : ""}`}
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
