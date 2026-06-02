import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBoardForProject, getCardWithTimeline } from "@/lib/cards/queries";
import { PrintLayout } from "@/components/print/PrintLayout";
import { PrintCard } from "@/components/print/PrintCard";
import Link from "next/link";

export default async function ProjectPrintPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  let board;
  try {
    board = await getBoardForProject(supabase, slug);
  } catch {
    return <div className="p-6 text-red-700">Proyek tidak ditemukan: {slug}</div>;
  }

  // Build a flat list: every card (active or dormant), grouped under its topic, with its full timeline.
  // For a print export we want the full picture, not a sample.
  const cardsByTopic = board.columns
    .filter((c) => c.cards.length > 0)
    .map((col) => ({ topicName: col.topic.name, cards: col.cards }));

  // Fetch each card's events serially (small N for a single project)
  const cardDetails = await Promise.all(
    cardsByTopic.flatMap((g) =>
      g.cards.map(async (c) => ({
        topicName: g.topicName,
        detail: await getCardWithTimeline(supabase, board.project.id, c.slug),
      }))
    )
  );

  const totalCards = cardDetails.length;
  const totalEvents = cardDetails.reduce((n, c) => n + c.detail.events.length, 0);

  return (
    <>
      {/* Screen-only header with Print button — hidden on actual print */}
      <div className="print-hide mx-auto max-w-4xl px-6 pt-4">
        <Link href={`/project/${board.project.project_code}`} className="text-xs text-stone-500 hover:underline">
          ← {board.project.project_code} Board
        </Link>
        <p className="mt-2 rounded border border-stone-300 bg-stone-50 px-3 py-2 text-xs text-stone-600">
          Tekan <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">⌘P</kbd> /
          <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] shadow-sm">Ctrl-P</kbd> lalu pilih &ldquo;Save as PDF&rdquo; untuk mengekspor laporan ini.
        </p>
      </div>

      <PrintLayout
        projectCode={board.project.project_code}
        projectName={board.project.project_name}
        title="Laporan Proyek"
        subtitle={`${totalCards} kartu · ${totalEvents} aktivitas tercatat`}
      >
        {cardDetails.map((c) => (
          <PrintCard
            key={c.detail.card.id}
            card={c.detail.card}
            events={c.detail.events}
            topicName={c.topicName}
          />
        ))}
      </PrintLayout>
    </>
  );
}
