import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCardWithTimelineByProjectCode, getCardAttachments, getCardMembers, getProjectStaff, getProjectTopics } from "@/lib/cards/queries";
import { getCardAreas } from "@/lib/cards/area-link-queries";
import { getCardLinks } from "@/lib/cards/link-queries";
import { getProjectAreas } from "@/lib/projects/area-queries";
import { CardHeader } from "@/components/board/CardHeader";
import { CardMembers } from "@/components/board/CardMembers";
import { CardAreas } from "@/components/board/CardAreas";
import { CardLinks } from "@/components/board/CardLinks";
import { MoveCardControl } from "@/components/board/MoveCardControl";
import { Timeline } from "@/components/board/Timeline";
import { AddEventForm } from "@/components/board/AddEventForm";
import { CommentsSection } from "@/components/board/CommentsSection";

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ slug: string; cardSlug: string }>;
}) {
  const { slug, cardSlug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const currentStaffId = user?.id ?? null;

  const [projectRes, detailRes] = await Promise.allSettled([
    supabase
      .from("projects").select("id, project_code, project_name")
      .eq("project_code", slug.toUpperCase()).maybeSingle(),
    getCardWithTimelineByProjectCode(supabase, slug.toUpperCase(), cardSlug),
  ]);
  if (projectRes.status === "rejected") throw projectRes.reason;
  const project = projectRes.value.data;
  if (!project) {
    return <div className="p-6 text-red-700">Proyek tidak ditemukan: {slug}</div>;
  }

  if (detailRes.status === "rejected") {
    return (
      <div className="p-6 text-red-700">
        Kartu tidak ditemukan: <code>{cardSlug}</code>
        <div className="mt-3"><Link href={`/project/${slug}`} className="underline">← kembali ke board</Link></div>
      </div>
    );
  }
  const detail = detailRes.value;

  const [attachmentsByEvent, memberRows, candidates, topics, cardAreas, projectAreas, cardLinks] = await Promise.all([
    getCardAttachments(supabase, detail.card.id),
    getCardMembers(supabase, detail.card.id),
    getProjectStaff(supabase, project.id),
    getProjectTopics(supabase, project.id),
    getCardAreas(supabase, detail.card.id),
    getProjectAreas(supabase, project.id),
    getCardLinks(supabase, detail.card.id),
  ]);
  const members = memberRows.map((m) => ({ staff_id: m.staff_id, role: m.role, staff: m.staff }));
  const topicName = topics.find((t) => t.id === detail.card.topic_id)?.name ?? "—";

  return (
    <div className="bg-[var(--background)] py-4 md:py-6">
      <div className="mx-auto max-w-6xl px-3 md:px-4">
        {/* Trello-style modal shell — warm-white surface, dark signature header,
            focused 2-column body on desktop, stacks to one column on mobile. */}
        <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_24px_-12px_rgba(122,107,86,0.35)]">
          {/* Modal-style header — brand's signature dark bar, like the homepage Projek Aktif row */}
          <div className="flex items-center justify-between gap-3 border-b border-[var(--foreground)] bg-[var(--foreground)] px-4 py-2.5 text-[var(--text-inverse)] md:px-6">
            <Link
              href={`/project/${slug}`}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-inverse-secondary)] hover:text-[var(--text-inverse)]"
            >
              ← {project.project_code}
            </Link>
            <div className="flex items-center gap-3">
              <Link
                href={`/project/${slug}/cards/${cardSlug}/print`}
                className="text-xs font-semibold uppercase tracking-wide text-[var(--text-inverse-secondary)] hover:text-[var(--text-inverse)]"
              >
                Cetak →
              </Link>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-inverse-secondary)]">
                {topicName} · Detail Kartu
              </span>
            </div>
          </div>

          <div className="grid gap-0 md:grid-cols-[1fr_280px]">
            {/* Main column — the focused content */}
            <div className="border-b border-[var(--border)] px-4 py-4 md:border-b-0 md:border-r md:px-6 md:py-5">
              <CardHeader
                card={detail.card}
                projectId={project.id}
                projectCode={slug}
                cardSlug={cardSlug}
              />
              <div className="mt-5">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
                  Tambah aktivitas
                </h2>
                <AddEventForm
                  cardId={detail.card.id}
                  projectId={project.id}
                  projectCode={slug}
                  cardSlug={cardSlug}
                />
              </div>
              <div className="mt-6 border-t border-[var(--border)] pt-4">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
                  Timeline aktivitas
                </h2>
                <Timeline
                  events={detail.events}
                  attachmentsByEvent={attachmentsByEvent}
                  projectCode={project.project_code}
                  cardSlug={cardSlug}
                />
              </div>
              <div className="mt-6 border-t border-[var(--border)] pt-4">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
                  Diskusi
                </h2>
                <CommentsSection
                  cardId={detail.card.id}
                  projectId={project.id}
                  projectCode={slug}
                  cardSlug={cardSlug}
                  currentStaffId={currentStaffId}
                />
              </div>
            </div>

            {/* Sidebar — Trello-style actions/members panel */}
            <aside className="bg-[var(--surface-alt)] px-4 py-4 md:py-5">
              <div>
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
                  Pindah kolom
                </h2>
                <MoveCardControl
                  cardId={detail.card.id}
                  projectId={project.id}
                  projectCode={slug}
                  cardSlug={cardSlug}
                  currentTopicId={detail.card.topic_id}
                  topics={topics}
                />
              </div>
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
                  Anggota kartu
                </h2>
                <CardMembers
                  cardId={detail.card.id}
                  projectCode={slug}
                  cardSlug={cardSlug}
                  members={members}
                  candidates={candidates}
                />
              </div>
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
                  Areas terkait
                </h2>
                <CardAreas
                  cardId={detail.card.id}
                  projectCode={slug}
                  cardSlug={cardSlug}
                  currentAreas={cardAreas}
                  allProjectAreas={projectAreas}
                />
              </div>
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
                  Terkait
                </h2>
                <CardLinks
                  cardId={detail.card.id}
                  projectId={project.id}
                  projectCode={slug}
                  cardSlug={cardSlug}
                  links={cardLinks}
                />
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
