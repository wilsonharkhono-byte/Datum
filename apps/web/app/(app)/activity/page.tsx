import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRecentActivity } from "@/lib/activity/queries";
import { ActivityItem } from "@/components/activity/ActivityItem";

export default async function ActivityPage() {
  const supabase = await createSupabaseServerClient();
  const items = await getRecentActivity(supabase);

  // Group by date string
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const day = new Date(it.occurredAt).toLocaleDateString("id-ID", { year: "numeric", month: "long", day: "numeric" });
    const arr = groups.get(day) ?? [];
    arr.push(it);
    groups.set(day, arr);
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href="/" className="text-xs text-stone-500 hover:underline">← Beranda</Link>
      <h1 className="mt-2 text-2xl font-semibold text-[#141210]">Aktivitas Terbaru</h1>
      <p className="mt-1 text-sm text-[#524E49]">
        50 aktivitas terbaru di semua proyek — kartu baru, aktivitas, dan komentar.
      </p>

      {groups.size === 0 ? (
        <div className="mt-6 rounded border border-dashed border-[#B5AFA8] p-6 text-center text-sm italic text-[#847E78]">
          Belum ada aktivitas.
        </div>
      ) : null}

      {[...groups.entries()].map(([day, dayItems]) => (
        <section key={day} className="mt-6">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7A6B56]">
            {day} ({dayItems.length})
          </h2>
          <ol className="space-y-2">
            {dayItems.map((it) => <ActivityItem key={it.id} item={it} />)}
          </ol>
        </section>
      ))}
    </div>
  );
}
