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
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Link href="/" className="text-xs text-[var(--text-muted)] hover:underline">← Beranda</Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">Aktivitas Terbaru</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        50 aktivitas terbaru di semua proyek — kartu baru, aktivitas, dan komentar.
      </p>

      {groups.size === 0 ? (
        <div className="mt-6 rounded border border-dashed border-[var(--border)] p-6 text-center">
          <p className="text-sm italic text-[var(--text-secondary)]">Belum ada aktivitas.</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Buat kartu pertama atau tambah catatan di kartu yang sudah ada untuk mulai melihat aktivitas di sini.
          </p>
        </div>
      ) : null}

      {[...groups.entries()].map(([day, dayItems]) => (
        <section key={day} className="mt-6">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
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
