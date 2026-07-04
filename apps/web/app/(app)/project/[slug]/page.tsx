import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBoardForProject } from "@/lib/cards/queries";
import { getAdvisorItems } from "@/lib/advisor/queries";
import { getCurrentStaff } from "@/lib/auth/require-role";
import { Board } from "@/components/board/Board";
import { ProjectAdvisorStrip } from "@/components/board/ProjectAdvisorStrip";
import { BoardHeaderMenu } from "@/components/board/BoardHeaderMenu";
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
      <div className="p-6 text-[var(--flag-critical)]">
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
      // Advisor is an optional garnish — fail open, but record it: a silently
      // vanished strip is indistinguishable from "no advice" for the user.
      .catch((e) => {
        Sentry.captureException(e, { extra: { where: "board/advisor-strip" } });
        return [];
      }),
  ]);
  // Any signed-in staff can open settings (non-admins land on the Areas tab to
  // add/edit areas). Tab-level gating lives in the settings page itself.
  const showSettings = caller != null;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 md:px-4 md:py-2">
        {/* Two header variants: a tight one-row Trello-style bar on mobile and
            the original two-row layout at md+ (see the hidden/md:block split). */}
        {/* Mobile: one tight Trello-style row — back, title, overflow menu. */}
        <div className="flex items-center gap-2 md:hidden">
          <Link href="/" aria-label="Kembali ke daftar proyek" className="shrink-0 text-base leading-none text-[var(--text-muted)] hover:text-[var(--foreground)]">
            ←
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {board.project.project_code} · {board.project.project_name}
          </h1>
          <BoardHeaderMenu projectCode={board.project.project_code} showSettings={showSettings} />
        </div>

        {/* md+: original two-row layout (back/nav row, then full title). */}
        <div className="hidden md:block">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xs text-[var(--text-muted)] hover:underline">← Proyek</Link>
            <div className="flex items-center gap-2">
              <Link
                href={`/project/${board.project.project_code}/print`}
                className="text-xs font-semibold uppercase tracking-wide text-[var(--sand-dark)] hover:text-[var(--foreground)]"
              >
                Cetak →
              </Link>
              <Link
                href={`/project/${board.project.project_code}/rooms`}
                className="text-xs font-semibold uppercase tracking-wide text-[var(--sand-dark)] hover:text-[var(--sand-darker)]"
              >
                Ruangan →
              </Link>
              <Link
                href={`/project/${board.project.project_code}/activity`}
                className="text-xs font-semibold uppercase tracking-wide text-[var(--sand-dark)] hover:text-[var(--sand-darker)]"
              >
                Aktivitas →
              </Link>
              <Link
                href={`/project/${board.project.project_code}/schedule`}
                className="text-xs font-semibold uppercase tracking-wide text-[var(--sand-dark)] hover:text-[var(--sand-darker)]"
              >
                Jadwal & Readiness →
              </Link>
              {showSettings ? (
                <Link
                  href={`/project/${board.project.project_code}/settings`}
                  aria-label="Pengaturan proyek"
                  className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--sand-dark)] hover:text-[var(--foreground)]"
                >
                  <GearIcon size={13} /> Pengaturan
                </Link>
              ) : null}
            </div>
          </div>
          <h1 className="text-lg font-semibold text-foreground">
            {board.project.project_code} · {board.project.project_name}
          </h1>
        </div>
      </header>
      <ProjectAdvisorStrip items={advisorItems} />
      <div className="flex-1 overflow-hidden">
        <Board initialBoard={board} />
      </div>
    </div>
  );
}
