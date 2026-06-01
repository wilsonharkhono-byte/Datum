import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCardWithTimeline, getCardAttachments, getCardMembers, getProjectStaff, getProjectTopics } from "@/lib/cards/queries";
import { CardHeader } from "@/components/board/CardHeader";
import { CardMembers } from "@/components/board/CardMembers";
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

  const { data: project } = await supabase
    .from("projects").select("id, project_code, project_name")
    .eq("project_code", slug.toUpperCase()).maybeSingle();
  if (!project) {
    return <div className="p-6 text-red-700">Proyek tidak ditemukan: {slug}</div>;
  }

  let detail;
  try {
    detail = await getCardWithTimeline(supabase, project.id, cardSlug);
  } catch {
    return (
      <div className="p-6 text-red-700">
        Kartu tidak ditemukan: <code>{cardSlug}</code>
        <div className="mt-3"><Link href={`/project/${slug}`} className="underline">← kembali ke board</Link></div>
      </div>
    );
  }

  const [attachmentsByEvent, memberRows, candidates, topics] = await Promise.all([
    getCardAttachments(supabase, detail.card.id),
    getCardMembers(supabase, detail.card.id),
    getProjectStaff(supabase, project.id),
    getProjectTopics(supabase, project.id),
  ]);
  const members = memberRows.map((m) => ({ staff_id: m.staff_id, role: m.role, staff: m.staff }));

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="flex items-center justify-between">
        <Link href={`/project/${slug}`} className="text-xs text-stone-500 hover:underline">
          ← {project.project_code}
        </Link>
        <MoveCardControl
          cardId={detail.card.id}
          projectId={project.id}
          projectCode={slug}
          cardSlug={cardSlug}
          currentTopicId={detail.card.topic_id}
          topics={topics}
        />
      </div>
      <CardHeader
        card={detail.card}
        projectId={project.id}
        projectCode={slug}
        cardSlug={cardSlug}
      />
      <CardMembers
        cardId={detail.card.id}
        projectCode={slug}
        cardSlug={cardSlug}
        members={members}
        candidates={candidates}
      />
      <AddEventForm
        cardId={detail.card.id}
        projectId={project.id}
        projectCode={slug}
        cardSlug={cardSlug}
      />
      <Timeline events={detail.events} attachmentsByEvent={attachmentsByEvent} />
      <CommentsSection
        cardId={detail.card.id}
        projectId={project.id}
        projectCode={slug}
        cardSlug={cardSlug}
        currentStaffId={currentStaffId}
      />
    </div>
  );
}
