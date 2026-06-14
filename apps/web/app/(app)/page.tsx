import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectsList } from "@/lib/projects/queries";
import { ProjectEditDialog } from "@/components/projects/ProjectEditDialog";
import { BellIcon, ClipboardIcon, BookIcon, SearchIcon } from "@/components/icons/Icon";

const statusLabel: Record<string, string> = {
  design: "Desain",
  construction: "Konstruksi",
  finishing: "Finishing",
  handover: "Serah terima",
  closed: "Selesai",
};

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  let projects: Awaited<ReturnType<typeof getProjectsList>> | null = null;
  let error: { message: string } | null = null;
  try {
    projects = await getProjectsList(supabase);
  } catch (e) {
    error = e as { message: string };
  }

  const { count: pendingDraftCount } = await supabase
    .from("data_drafts")
    .select("id", { count: "exact", head: true })
    .eq("status", "draft")
    .eq("draft_type", "card_event");

  if (error) {
    return (
      <div className="rounded-[8px] border border-[#C62828]/25 bg-[rgba(198,40,40,0.08)] p-4 text-sm font-medium text-[#C62828]">
        Gagal memuat proyek: {error.message}
      </div>
    );
  }
  if (!projects || projects.length === 0) {
    return (
      <div className="rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] p-6 text-[#524E49]">
        Belum ada proyek yang ditugaskan.
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <section>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">
          DATUM
        </p>
        <h1 className="max-w-2xl text-3xl font-semibold leading-tight text-[#141210]">
          Pilih proyek untuk membuka papan kartu dan asisten.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[#524E49]">
          {projects.length} proyek aktif. Klik salah satu untuk melihat semua kartu per topik, timeline keputusan, dan bertanya pada asisten.
        </p>
        {pendingDraftCount && pendingDraftCount > 0 ? (
          <Link href="/review" aria-label={`${pendingDraftCount} draft menunggu review`} className="mt-2 inline-flex items-center gap-1.5 rounded bg-[var(--sand-tint)] px-3 py-1 text-xs font-semibold text-[var(--sand-dark)] hover:bg-[var(--sand)]/20">
            <BellIcon size={12} /> {pendingDraftCount} draft menunggu review →
          </Link>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link href="/projects/new" aria-label="Buat proyek baru" className="rounded bg-[var(--foreground)] px-3 py-1 font-semibold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)]">
            + Buat proyek
          </Link>
          <Link href="/activity" aria-label="Aktivitas terbaru" className="inline-flex items-center gap-1.5 rounded border border-[#B5AFA8] bg-white px-3 py-1 font-semibold uppercase tracking-wide text-[#524E49] hover:border-[#7A6B56]">
            <ClipboardIcon size={13} /> Aktivitas terbaru
          </Link>
          <Link href="/brief" aria-label="Morning brief" className="inline-flex items-center gap-1.5 rounded border border-[#B5AFA8] bg-white px-3 py-1 font-semibold uppercase tracking-wide text-[#524E49] hover:border-[#7A6B56]">
            <BookIcon size={13} /> Morning brief
          </Link>
          <Link href="/search" aria-label="Cari" className="inline-flex items-center gap-1.5 rounded border border-[#B5AFA8] bg-white px-3 py-1 font-semibold uppercase tracking-wide text-[#524E49] hover:border-[#7A6B56]">
            <SearchIcon size={13} /> Cari
          </Link>
        </div>
      </section>

      <section>
        <div className="overflow-hidden rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6]">
          <div className="border-b border-[#B5AFA8] bg-[#141210] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#FDFAF6]">
            Proyek Aktif
          </div>
          <ul className="divide-y divide-[#B5AFA8]/70">
            {projects.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <Link
                    href={`/project/${p.project_code}`}
                    className="block flex-1 transition-colors hover:opacity-80"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold text-[#141210]">
                          {p.project_code} · {p.project_name}
                        </div>
                        <div className="mt-1 text-sm leading-5 text-[#524E49]">
                          Client: {p.client_name ?? "-"}
                          {p.location && ` · ${p.location}`}
                        </div>
                      </div>
                      <span className="rounded-[5px] bg-[#B29F86]/15 px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#7A6B56]">
                        {statusLabel[p.status] ?? p.status}
                      </span>
                    </div>
                    {p.target_handover && (
                      <div className="mt-2 text-xs font-medium text-[#847E78]">
                        Target serah terima: {p.target_handover}
                      </div>
                    )}
                  </Link>
                  <ProjectEditDialog project={p} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
