import Link from "next/link";
import type { AdvisorItem } from "@/lib/advisor/types";

/**
 * Per-project advisor strip (server component): the project's top-3 next
 * actions as compact chips above the board. Severity tint via score:
 * ≥100 critical (red), ≥70 warning (amber), else neutral sand.
 */
export function ProjectAdvisorStrip({ items }: { items: AdvisorItem[] }) {
  if (items.length === 0) return null;

  return (
    <div
      className="flex gap-2 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1 sm:px-4 sm:py-2"
      aria-label="Prioritas proyek hari ini"
    >
      {items.map((it, i) => {
        const tone =
          it.score >= 100
            ? "border-[var(--flag-critical)] bg-[color-mix(in_oklch,var(--flag-critical)_9%,var(--surface))] text-[var(--flag-critical)]"
            : it.score >= 70
              ? "border-[var(--flag-warning)] bg-[color-mix(in_oklch,var(--flag-warning)_10%,var(--surface))] text-[var(--flag-warning)]"
              : "border-[var(--border)] bg-[var(--sand-tint)] text-[var(--sand-dark)]";
        return (
          <Link
            key={`${it.type}-${it.href}-${i}`}
            href={it.href}
            className={`flex min-h-0 shrink-0 max-w-[280px] flex-col justify-center rounded border px-3 py-1 sm:min-h-11 sm:py-1.5 ${tone}`}
          >
            <span className="truncate text-xs font-semibold">{it.title}</span>
            <span className="truncate text-[10px] text-[var(--text-secondary)]">
              {[it.dueLabel, it.detail].filter(Boolean).join(" · ") || it.projectCode}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
