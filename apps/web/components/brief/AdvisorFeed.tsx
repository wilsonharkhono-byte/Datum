import Link from "next/link";
import type { AdvisorItem } from "@/lib/advisor/types";

/**
 * "Hari Ini" — ranked next-action feed (server component).
 * Numbered list: rank, title (link), project chip, dueLabel right-aligned.
 */
export function AdvisorFeed({ items }: { items: AdvisorItem[] }) {
  return (
    <section className="rounded border border-[#B5AFA8] bg-[#FDFAF6] p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">
        Hari ini — prioritas
      </h2>
      {items.length === 0 ? (
        <p className="text-xs italic text-[#524E49]">Tidak ada prioritas mendesak. 👍</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((it, i) => (
            <li
              key={`${it.type}-${it.href}-${i}`}
              className="flex min-h-11 items-center gap-3 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <span className="w-5 shrink-0 text-right text-sm font-semibold tabular-nums text-[#7A6B56]">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <Link href={it.href} className="block truncate text-xs font-medium text-[#141210] hover:underline">
                  {it.title}
                </Link>
                {it.detail ? (
                  <p className="mt-0.5 truncate text-[11px] text-[#524E49]">{it.detail}</p>
                ) : null}
              </div>
              <span className="shrink-0 rounded bg-[var(--sand-tint)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7A6B56]">
                {it.projectCode}
              </span>
              {it.dueLabel ? (
                <span className="shrink-0 text-right text-[10px] text-[#847E78]">{it.dueLabel}</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
