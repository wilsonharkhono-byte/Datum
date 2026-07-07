import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectsList, getDevelopments } from "@/lib/projects/queries";
import { ProjectsList } from "@/components/projects/ProjectsList";
import { BellIcon, ClipboardIcon, BookIcon, SearchIcon } from "@/components/icons/Icon";

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
      <div className="rounded-[8px] border border-[var(--flag-critical)]/25 bg-[var(--flag-critical-bg)] p-4 text-sm font-medium text-[var(--flag-critical)]">
        Gagal memuat proyek: {error.message}
      </div>
    );
  }
  if (!projects || projects.length === 0) {
    return (
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-secondary)]">
        Belum ada proyek yang ditugaskan.
      </div>
    );
  }

  const developments = await getDevelopments(supabase);

  return (
    <div className="grid gap-6">
      <section>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sand-dark)]">
          DATUM
        </p>
        <h1 className="max-w-2xl text-3xl font-semibold leading-tight text-[var(--foreground)]">
          Pilih proyek untuk membuka papan kartu dan asisten.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
          {projects.length} proyek aktif · {developments.length} pengembangan. Klik salah satu untuk melihat semua kartu per topik, timeline keputusan, dan bertanya pada asisten.
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
          <Link href="/activity" aria-label="Aktivitas terbaru" className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-bright)] px-3 py-1 font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--sand-dark)]">
            <ClipboardIcon size={13} /> Aktivitas terbaru
          </Link>
          <Link href="/brief" aria-label="Morning brief" className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-bright)] px-3 py-1 font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--sand-dark)]">
            <BookIcon size={13} /> Morning brief
          </Link>
          <Link href="/search" aria-label="Cari" className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-bright)] px-3 py-1 font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--sand-dark)]">
            <SearchIcon size={13} /> Cari
          </Link>
        </div>
      </section>

      <ProjectsList initialProjects={projects} developments={developments} />
    </div>
  );
}
