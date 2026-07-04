import { getProjectBySlug } from "@datum/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCardWithTimeline, getCardComments, getProjectTopics } from "@/lib/cards/queries";
import { PrintLayout } from "@/components/print/PrintLayout";
import { PrintCard } from "@/components/print/PrintCard";
import Link from "next/link";

export default async function CardPrintPage({
  params,
}: {
  params: Promise<{ slug: string; cardSlug: string }>;
}) {
  const { slug, cardSlug } = await params;
  const supabase = await createSupabaseServerClient();

  const project = await getProjectBySlug(supabase, slug);
  if (!project) {
    return <div className="p-6 text-red-700">Proyek tidak ditemukan: {slug}</div>;
  }

  let detail; let comments; let topics;
  try {
    // detail.card.id feeds the comments fetch — no separate cards lookup needed.
    detail = await getCardWithTimeline(supabase, project.id, cardSlug);
    [comments, topics] = await Promise.all([
      getCardComments(supabase, detail.card.id),
      getProjectTopics(supabase, project.id),
    ]);
  } catch {
    return <div className="p-6 text-red-700">Kartu tidak ditemukan: {cardSlug}</div>;
  }
  const topicName = topics.find((t) => t.id === detail.card.topic_id)?.name;

  return (
    <>
      <div className="print-hide mx-auto max-w-4xl px-6 pt-4">
        <Link href={`/project/${project.project_code}/cards/${cardSlug}`} className="text-xs text-stone-500 hover:underline">
          ← {detail.card.title}
        </Link>
        <p className="mt-2 rounded border border-stone-300 bg-stone-50 px-3 py-2 text-xs text-stone-600">
          Tekan <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">⌘P</kbd> /
          <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">Ctrl-P</kbd> lalu &ldquo;Save as PDF&rdquo;.
        </p>
      </div>

      <PrintLayout
        projectCode={project.project_code}
        projectName={project.project_name}
        title={detail.card.title}
        subtitle={topicName}
      >
        <PrintCard
          card={detail.card}
          events={detail.events}
          topicName={topicName}
        />

        {comments.length > 0 ? (
          <section className="mt-6">
            <h3 className="mb-2 text-[10pt] font-bold uppercase tracking-wide text-stone-700">Diskusi ({comments.length})</h3>
            <ul className="space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="border-l-2 border-stone-300 pl-3 text-sm print-break-avoid">
                  <div className="text-[9pt] text-stone-500">
                    {new Date(c.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                    {c.edited_at ? " (diedit)" : ""}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-stone-800">{c.body}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </PrintLayout>
    </>
  );
}
