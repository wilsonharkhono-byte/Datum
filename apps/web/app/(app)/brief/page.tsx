import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBriefData } from "@/lib/brief/queries";
import { BriefSection } from "@/components/brief/BriefSection";

export default async function BriefPage() {
  const supabase = await createSupabaseServerClient();
  const brief = await getBriefData(supabase);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link href="/" className="text-xs text-[var(--text-muted)] hover:underline">← Beranda</Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">Morning brief</p>
        <h1 className="text-3xl font-semibold text-[#141210]">Apa yang butuh perhatian hari ini</h1>
        <p className="mt-1 text-sm text-[#524E49]">
          Ringkasan lintas-proyek: draft menunggu, pending, defect, permintaan klien, dan readiness yang perlu di-recompute.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <BriefSection
          title="Draft menunggu approval"
          emoji="📝"
          count={brief.pendingDrafts.count}
          items={brief.pendingDrafts.items}
          emptyMessage="Tidak ada draft yang menunggu."
          showAllHref="/review"
        />
        <BriefSection
          title="Pending unresolved"
          emoji="⏳"
          count={brief.openPendings.count}
          items={brief.openPendings.items}
          emptyMessage="Tidak ada item pending."
        />
        <BriefSection
          title="Defect aktif (30 hari)"
          emoji="🚧"
          count={brief.defects.count}
          items={brief.defects.items}
          emptyMessage="Tidak ada defect terbaru."
        />
        <BriefSection
          title="Permintaan klien"
          emoji="📨"
          count={brief.awaitingClient.count}
          items={brief.awaitingClient.items}
          emptyMessage="Tidak ada permintaan klien aktif."
        />
      </div>

      <section className="mt-6 rounded border border-[#B5AFA8] bg-[#FDFAF6] p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#141210]">
          🔄 Readiness perlu di-recompute
        </h2>
        {brief.staleByProject.length === 0 ? (
          <p className="text-xs italic text-[#847E78]">Semua readiness up-to-date.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {brief.staleByProject.map((p) => (
              <li key={p.projectCode}>
                <Link
                  href={`/project/${p.projectCode}/schedule`}
                  className="block rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs hover:border-[var(--sand-dark)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#141210]">{p.projectCode}</span>
                    <span className="rounded bg-[var(--sand-tint)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--sand-dark)]">
                      {p.staleCount} stale
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#524E49]">{p.projectName}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
