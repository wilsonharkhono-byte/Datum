"use client";
import { useState } from "react";

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

  // Mobile-only: the chip rows are tall (44px tap targets × ~7 chips that wrap
  // to several rows), so on phones they collapse behind a Filter toggle and the
  // top row stays a single compact line. At md+ the groups dissolve back inline
  // (md:contents) and everything renders exactly as before.
  const [showFilters, setShowFilters] = useState(false);
  const activeFilters = labelFilter.size + (statuses.size < 3 ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs md:py-2">
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Cari judul atau ringkasan kartu…"
        className="min-h-0 flex-1 rounded border border-[var(--border)] px-3 py-1.5 text-xs focus:border-[var(--sand-dark)] focus:outline-none sm:w-56 sm:flex-none md:px-2 md:py-1"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQueryChange("")}
          className="inline-flex min-h-0 items-center px-2 py-1.5 text-[10px] text-[var(--text-muted)] hover:underline md:px-3 md:py-1"
        >
          × <span className="hidden sm:inline">bersihkan</span>
        </button>
      ) : null}

      {/* Mobile filter toggle — reveals the status/perlu chip groups below. */}
      <button
        type="button"
        onClick={() => setShowFilters((v) => !v)}
        aria-expanded={showFilters}
        className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--sand-dark)] hover:text-[var(--foreground)] md:hidden"
      >
        Filter{activeFilters ? ` · ${activeFilters}` : ""}
      </button>
      <span className="ml-auto text-[10px] text-[#7A6B56] md:hidden">
        {matched === total ? `${total}` : `${matched}/${total}`}
      </span>

      {/* Filter groups: own collapsible row on mobile; inline at md+. */}
      <div className={`w-full flex-wrap items-center gap-2 md:contents ${showFilters ? "flex" : "hidden"}`}>
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7A6B56] md:ml-2">status</span>
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
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7A6B56] md:ml-2">perlu</span>
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
      </div>

      <span className="ml-auto hidden text-[10px] text-[#7A6B56] md:inline">
        {matched === total ? `${total} kartu` : `${matched} dari ${total} kartu cocok`}
      </span>
    </div>
  );
}
