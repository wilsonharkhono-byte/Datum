import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCardWithTimeline } from "@/lib/cards/queries";
import { CardHeader } from "@/components/board/CardHeader";
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

  return (
    <div className="mx-auto max-w-3xl p-4">
      <Link href={`/project/${slug}`} className="text-xs text-stone-500 hover:underline">
        ← {project.project_code}
      </Link>
      <CardHeader
        card={detail.card}
        projectId={project.id}
        projectCode={slug}
        cardSlug={cardSlug}
      />
      <AddEventForm
        cardId={detail.card.id}
        projectId={project.id}
        projectCode={slug}
        cardSlug={cardSlug}
      />
      <Timeline events={detail.events} />
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
