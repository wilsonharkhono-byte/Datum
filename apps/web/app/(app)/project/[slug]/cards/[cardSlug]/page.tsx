import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCardWithTimelineByProjectCode, getCardAttachments, getCardMembers, getCardComments, getProjectStaff, getProjectTopics } from "@/lib/cards/queries";
import { getCardAreas } from "@/lib/cards/area-link-queries";
import { getCardLinks } from "@/lib/cards/link-queries";
import { getProjectAreas } from "@/lib/projects/area-queries";
import { CardHeader } from "@/components/board/CardHeader";
import { CardAreas } from "@/components/board/CardAreas";
import { CardLinks } from "@/components/board/CardLinks";
import { MoveCardControl } from "@/components/board/MoveCardControl";
import { AddEventForm } from "@/components/board/AddEventForm";
import { CardDetailClient } from "@/components/board/CardDetailClient";
import type { CardPayload } from "@/app/api/card/[code]/[slug]/route";

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

  const [attachmentsByEvent, memberRows, comments, candidates, topics, cardAreas, projectAreas, cardLinks] = await Promise.all([
    getCardAttachments(supabase, detail.card.id),
    getCardMembers(supabase, detail.card.id),
    getCardComments(supabase, detail.card.id),
    getProjectStaff(supabase, project.id),
    getProjectTopics(supabase, project.id),
    getCardAreas(supabase, detail.card.id),
    getProjectAreas(supabase, project.id),
    getCardLinks(supabase, detail.card.id),
  ]);
  const topicName = topics.find((t) => t.id === detail.card.topic_id)?.name ?? "—";

  // Seed the cached card query with the same payload the JSON API returns, so
  // CardDetailClient's dynamic sections (timeline/comments/members) render from
  // RSC on first paint and from IndexedDB on revisit.
  const initialCard: CardPayload = { ...detail, comments, members: memberRows };

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

          <CardDetailClient
            code={project.project_code}
            slug={cardSlug}
            urlSlug={slug}
            initialCard={initialCard}
            projectId={project.id}
            projectCode={project.project_code}
            currentStaffId={currentStaffId}
            attachmentsByEvent={attachmentsByEvent}
            candidates={candidates}
            header={
              <CardHeader
                card={detail.card}
                projectId={project.id}
                projectCode={slug}
                cardSlug={cardSlug}
              />
            }
            addEvent={
              <AddEventForm
                cardId={detail.card.id}
                projectId={project.id}
                projectCode={slug}
                cardSlug={cardSlug}
              />
            }
            moveControl={
              <MoveCardControl
                cardId={detail.card.id}
                projectId={project.id}
                projectCode={project.project_code}
                cardSlug={cardSlug}
                currentTopicId={detail.card.topic_id}
                topics={topics}
              />
            }
            areas={
              <CardAreas
                cardId={detail.card.id}
                projectCode={slug}
                cardSlug={cardSlug}
                currentAreas={cardAreas}
                allProjectAreas={projectAreas}
              />
            }
            links={
              <CardLinks
                cardId={detail.card.id}
                projectId={project.id}
                projectCode={slug}
                cardSlug={cardSlug}
                links={cardLinks}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
