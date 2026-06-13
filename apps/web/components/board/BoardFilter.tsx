"use client";

export type StatusFilter = Set<"active" | "dormant" | "closed">;

export type LabelFilterKind = "needs_decision" | "blocked" | "awaiting" | "overdue";
export type LabelFilter = Set<LabelFilterKind>;

const LABEL_FILTER_LABELS: Record<LabelFilterKind, string> = {
  needs_decision: "Butuh keputusan",
  blocked:        "Terblokir",
  awaiting:       "Menunggu",
  overdue:        "Lewat target",
};

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
  labelFilter,
  onLabelFilterChange,
  matched,
  total,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  statuses: StatusFilter;
  onStatusesChange: (s: StatusFilter) => void;
  labelFilter: LabelFilter;
  onLabelFilterChange: (s: LabelFilter) => void;
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

  function toggleLabel(k: LabelFilterKind) {
    const next = new Set(labelFilter);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onLabelFilterChange(next); // empty = "no label filtering"
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Cari judul atau ringkasan kartu…"
        className="min-h-11 w-full rounded border border-[var(--border)] px-3 py-1 text-xs focus:border-[var(--sand-dark)] focus:outline-none sm:w-56 md:min-h-0 md:px-2"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQueryChange("")}
          className="inline-flex min-h-11 items-center px-3 py-2.5 text-[10px] text-[var(--text-muted)] hover:underline md:min-h-0 md:py-1"
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
      <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7A6B56]">perlu</span>
      <div className="flex gap-1.5">
        {(Object.keys(LABEL_FILTER_LABELS) as LabelFilterKind[]).map((k) => {
          const on = labelFilter.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleLabel(k)}
              aria-pressed={on}
              className={`chip${on ? " chip-on" : ""}`}
            >
              {LABEL_FILTER_LABELS[k]}
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
