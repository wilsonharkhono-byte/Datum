"use client";
import { useState } from "react";
import { SearchIcon, FilterIcon, XIcon } from "@/components/icons/Icon";

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

  // Mobile (< md): the search field and the ~7 tall (44px) chips together ate a
  // third of the screen, so on phones they collapse behind two icon buttons in a
  // single thin bar — tap 🔍 to reveal the field, tap Filter to reveal the chip
  // groups. At md+ the toggles disappear, the field is always inline, and the
  // groups dissolve back into the bar (md:contents) — desktop is unchanged.
  const [showFilters, setShowFilters] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const activeFilters = labelFilter.size + (statuses.size < 3 ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs md:py-2">
      {/* Mobile-only triggers (hidden at md+). */}
      <button
        type="button"
        onClick={() => setShowSearch((v) => !v)}
        aria-expanded={showSearch}
        aria-label="Cari kartu"
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border text-[var(--text-secondary)] hover:text-[var(--foreground)] md:hidden ${
          showSearch || query
            ? "border-[var(--sand-dark)] text-[var(--foreground)]"
            : "border-[var(--border)]"
        }`}
      >
        <SearchIcon size={16} />
      </button>
      <button
        type="button"
        onClick={() => setShowFilters((v) => !v)}
        aria-expanded={showFilters}
        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded border px-2.5 text-[10px] font-semibold uppercase tracking-wide hover:text-[var(--foreground)] md:hidden ${
          activeFilters
            ? "border-[var(--sand-dark)] text-[var(--foreground)]"
            : "border-[var(--border)] text-[var(--text-secondary)]"
        }`}
      >
        <FilterIcon size={15} />
        Filter
        {activeFilters ? (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--foreground)] px-1 text-[10px] text-[var(--text-inverse)]">
            {activeFilters}
          </span>
        ) : null}
      </button>

      <span className="ml-auto text-[10px] text-[#7A6B56] md:hidden">
        {matched === total ? `${total}` : `${matched}/${total}`}
      </span>

      {/* Search field: collapsible on mobile (showSearch); always inline at md+. */}
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Cari judul atau ringkasan kartu…"
        className={`min-h-0 w-full rounded border border-[var(--border)] px-3 py-1.5 text-xs focus:border-[var(--sand-dark)] focus:outline-none md:block md:w-56 md:flex-none md:px-2 md:py-1 ${
          showSearch ? "block" : "hidden"
        }`}
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQueryChange("")}
          className="hidden items-center px-3 py-1 text-[10px] text-[var(--text-muted)] hover:underline md:inline-flex"
        >
          × bersihkan
        </button>
      ) : null}

      {/* Filter groups: own collapsible row on mobile; inline at md+. */}
      <div className={`w-full flex-wrap items-center gap-2 md:contents ${showFilters ? "flex" : "hidden"}`}>
        <div className="flex w-full items-center justify-between md:contents">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7A6B56] md:ml-2">status</span>
          {showFilters ? (
            <button
              type="button"
              onClick={() => setShowFilters(false)}
              aria-label="Tutup filter"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--foreground)] md:hidden"
            >
              <XIcon size={14} />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
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
        <div className="flex flex-wrap gap-1.5">
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
