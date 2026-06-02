import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBoardForProject } from "@/lib/cards/queries";
import { Board } from "@/components/board/Board";
import { ChatDock } from "@/components/chat/ChatDock";

export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();

  let board;
  try {
    board = await getBoardForProject(supabase, slug);
  } catch (e) {
    return (
      <div className="p-6 text-red-700">
        Proyek tidak ditemukan: <code>{slug}</code>
        <div className="mt-3"><Link href="/" className="underline">← kembali</Link></div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xs text-[var(--text-muted)] hover:underline">← Proyek</Link>
          <div className="flex items-center gap-3">
            <Link
              href={`/project/${board.project.project_code}/members`}
              className="text-xs font-semibold uppercase tracking-wide text-[#7A6B56] hover:text-[#3a3527]"
            >
              Anggota →
            </Link>
            <Link
              href={`/project/${board.project.project_code}/schedule`}
              className="text-xs font-semibold uppercase tracking-wide text-[#7A6B56] hover:text-[#3a3527]"
            >
              Jadwal & Readiness →
            </Link>
          </div>
        </div>
        <h1 className="text-lg font-semibold text-foreground">
          {board.project.project_code} · {board.project.project_name}
        </h1>
      </header>
      <div className="flex-1 overflow-hidden">
        <Board board={board} />
      </div>
      <ChatDock projectId={board.project.id} projectCode={board.project.project_code} />
    </div>
  );
}
