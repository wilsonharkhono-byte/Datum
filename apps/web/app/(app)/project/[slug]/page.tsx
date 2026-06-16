import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBoardForProject } from "@/lib/cards/queries";
import { getAdvisorItems } from "@/lib/advisor/queries";
import { getCurrentStaff } from "@/lib/auth/require-role";
import { Board } from "@/components/board/Board";
import { ProjectAdvisorStrip } from "@/components/board/ProjectAdvisorStrip";
import { ChatDock } from "@/components/chat/ChatDock";
import { GearIcon } from "@/components/icons/Icon";

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
  } catch {
    return (
      <div className="p-6 text-red-700">
        Proyek tidak ditemukan: <code>{slug}</code>
        <div className="mt-3"><Link href="/" className="underline">← kembali</Link></div>
      </div>
    );
  }

  // Staff lookup and the advisor strip's top-3 are independent — fetch them
  // together (the advisor runs its own internal Promise.all).
  const [caller, advisorItems] = await Promise.all([
    getCurrentStaff(),
    getAdvisorItems(supabase, { projectId: board.project.id, now: new Date(), limit: 3 })
      .catch(() => []),
  ]);
  // Any signed-in staff can open settings (non-admins land on the Areas tab to
  // add/edit areas). Tab-level gating lives in the settings page itself.
  const showSettings = caller != null;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 sm:px-4 sm:py-2">
        {/* Mobile: title + back live on one tight row; nav links sit below.
            sm+ keeps the original two-row layout (back/nav row, then title). */}
        <div className="flex items-center gap-2 sm:justify-between">
          <Link href="/" className="shrink-0 text-xs text-[var(--text-muted)] hover:underline">
            ←<span className="hidden sm:inline"> Proyek</span>
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground sm:hidden">
            {board.project.project_code} · {board.project.project_name}
          </h1>
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto">
            <Link
              href={`/project/${board.project.project_code}/print`}
              className="text-[11px] font-semibold uppercase tracking-wide text-[var(--sand-dark)] hover:text-[var(--foreground)] sm:text-xs"
            >
              Cetak →
            </Link>
            <Link
              href={`/project/${board.project.project_code}/rooms`}
              className="text-[11px] font-semibold uppercase tracking-wide text-[#7A6B56] hover:text-[#3a3527] sm:text-xs"
            >
              Ruangan →
            </Link>
            <Link
              href={`/project/${board.project.project_code}/schedule`}
              className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-[#7A6B56] hover:text-[#3a3527] sm:text-xs"
            >
              Jadwal<span className="hidden sm:inline"> & Readiness</span> →
            </Link>
            {showSettings ? (
              <Link
                href={`/project/${board.project.project_code}/settings`}
                aria-label="Pengaturan proyek"
                className="inline-flex shrink-0 items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--sand-dark)] hover:text-[var(--foreground)] sm:px-2.5"
              >
                <GearIcon size={13} /> <span className="hidden sm:inline">Pengaturan</span>
              </Link>
            ) : null}
          </div>
        </div>
        <h1 className="hidden text-lg font-semibold text-foreground sm:block">
          {board.project.project_code} · {board.project.project_name}
        </h1>
      </header>
      <ProjectAdvisorStrip items={advisorItems} />
      <div className="flex-1 overflow-hidden">
        <Board initialBoard={board} />
      </div>
      <ChatDock projectId={board.project.id} projectCode={board.project.project_code} />
    </div>
  );
}
