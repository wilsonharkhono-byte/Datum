import Link from "next/link";
import type { BriefItem } from "@/lib/brief/queries";

export function BriefSection({
  title,
  emoji,
  count,
  items,
  emptyMessage,
  showAllHref,
}: {
  title: string;
  emoji: string;
  count: number;
  items: BriefItem[];
  emptyMessage: string;
  showAllHref?: string;
}) {
  return (
    <section className="rounded border border-[#B5AFA8] bg-[#FDFAF6] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#141210]">
          {emoji} {title} <span className="text-[#7A6B56]">({count})</span>
        </h2>
        {showAllHref && count > items.length ? (
          <Link href={showAllHref} className="text-[10px] uppercase tracking-wide text-[#7A6B56] hover:underline">
            lihat semua →
          </Link>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-xs italic text-[#847E78]">{emptyMessage}</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((it) => (
            <li key={it.id} className="rounded border border-stone-200 bg-white px-3 py-2 text-xs">
              <div className="mb-0.5 flex items-center justify-between text-[10px]">
                <span className="font-semibold uppercase tracking-wide text-[#7A6B56]">{it.projectCode}</span>
                <span className="text-[#847E78]">{it.meta}</span>
              </div>
              <Link href={it.cardHref} className="block font-medium text-[#141210] hover:underline">
                {it.cardTitle}
              </Link>
              {it.detail ? <p className="mt-0.5 text-[11px] text-[#524E49]">{it.detail}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
