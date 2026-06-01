import Link from "next/link";
import type { ActivityItem as Item } from "@/lib/activity/queries";

const KIND_LABEL: Record<string, string> = {
  event: "aktivitas",
  comment: "komentar",
  card: "kartu baru",
};

const KIND_COLOR: Record<string, string> = {
  event: "bg-amber-100 text-amber-900",
  comment: "bg-stone-200 text-stone-700",
  card: "bg-green-100 text-green-900",
};

export function ActivityItem({ item }: { item: Item }) {
  const cardHref = `/project/${item.projectCode}/cards/${item.cardSlug}`;
  return (
    <li className="rounded border border-[#B5AFA8] bg-white p-3 text-xs">
      <div className="mb-1 flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${KIND_COLOR[item.kind] ?? ""}`}>
            {item.eventKind ?? KIND_LABEL[item.kind] ?? item.kind}
          </span>
          <Link href={`/project/${item.projectCode}`}
            className="font-semibold uppercase tracking-wide text-[#7A6B56] hover:underline">
            {item.projectCode}
          </Link>
        </div>
        <span className="text-[#847E78]">
          {new Date(item.occurredAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
          {item.actor ? <> · <span className="italic">{item.actor}</span></> : null}
        </span>
      </div>
      <div className="text-sm text-[#141210]">
        <Link href={cardHref} className="font-medium hover:underline">{item.cardTitle}</Link>
        <span className="ml-1 text-[#524E49]">— {item.detail || "(tidak ada detail)"}</span>
      </div>
    </li>
  );
}
