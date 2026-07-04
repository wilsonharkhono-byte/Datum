import Link from "next/link";
import { getProjectBySlug, must } from "@datum/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchMatrix } from "@/lib/matrix/fetch-matrix";
import { AreaGateMatrix } from "@/components/matrix/area-gate-matrix";
import { RecomputeButton } from "@/components/schedule/RecomputeButton";
import { RecomputeScheduleButton } from "@/components/schedule/RecomputeScheduleButton";
import { RULE_VERSION } from "@/lib/gates/readiness-rules";
import { Gantt } from "@/components/schedule/Gantt";
import { RulesViewer } from "@/components/schedule/RulesViewer";
import { getProjectScheduleCells, getAreaTargetDates } from "@/lib/gates/schedule";
import { AreaTargetEditor } from "@/components/schedule/AreaTargetEditor";
import { getProjectStepSignals } from "@/lib/steps/queries";
import { SignalSummaryPanel } from "@/components/schedule/SignalSummaryPanel";
import { AreaGatesRefresher } from "@/components/realtime/AreaGatesRefresher";

export default async function ProjectSchedulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();

  const project = await getProjectBySlug(supabase, slug);
  if (!project) {
    return (
      <div className="p-6 text-[var(--flag-critical)]">
        Proyek tidak ditemukan: <code>{slug}</code>
        <div className="mt-3"><Link href="/" className="underline">← kembali</Link></div>
      </div>
    );
  }

  // WIB (Asia/Jakarta) today — same pattern as Board + MiniCard.
  const jakartaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const nowIso = new Date().toISOString();

  // These six fetches are independent — run them in one round-trip batch
  // instead of paying ~6 sequential RTTs on the heaviest page.
  const [matrix, scheduleCells, areaTargets, projectSignals, staleRes, latestRes] =
    await Promise.all([
      fetchMatrix(project.id),
      getProjectScheduleCells(project.id),
      getAreaTargetDates(project.id),
      getProjectStepSignals(supabase, project.id, jakartaToday, nowIso),
      // Count stale cells
      supabase
        .from("area_gate_status")
        .select("*", { count: "exact", head: true })
        .eq("project_id", project.id)
        .eq("stale", true),
      // Latest recompute time across all cells
      supabase
        .from("area_gate_status")
        .select("last_recomputed_at")
        .eq("project_id", project.id)
        .order("last_recomputed_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);
  const { count: staleCount } = must(staleRes, "schedule.staleCount");
  const { data: latest } = must(latestRes, "schedule.lastRecompute");

  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <AreaGatesRefresher projectId={project.id} projectEvents />
      <div className="mb-3 flex items-center justify-between">
        <Link href={`/project/${project.project_code}`} className="text-xs text-[var(--text-muted)] hover:underline">
          ← {project.project_code} Board
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <RecomputeScheduleButton projectId={project.id} projectCode={project.project_code} />
          <RecomputeButton projectId={project.id} projectCode={project.project_code} />
        </div>
      </div>

      {staleCount && staleCount > 0 ? (
        <div className="mb-3 rounded border border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 text-xs text-[var(--sand-dark)]">
          🔄 {staleCount} sel butuh recompute — klik tombol di atas untuk update.
        </div>
      ) : null}

      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sand-dark)]">
          Jadwal & Readiness
        </p>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">
          {project.project_code} · {project.project_name}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Status per area × gate, dihitung dari card_events oleh rule engine v{RULE_VERSION}.
          {latest?.last_recomputed_at ? (
            <> Terakhir dihitung: <span className="font-medium">{new Date(latest.last_recomputed_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</span>.</>
          ) : (
            <> Belum pernah dihitung — klik &quot;hitung ulang readiness&quot; di kanan atas.</>
          )}
        </p>
      </header>

      <section className="mb-4">
        <RulesViewer />
      </section>

      {matrix && matrix.areas.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
            Target handover per area
          </h2>
          <p className="mb-3 text-xs text-[var(--text-secondary)]">
            Set tanggal target nyata per area. Jika diisi, window gate area itu
            dihitung mundur dari target (gate H berakhir di tanggal target),
            menggantikan jadwal default dari kickoff. Kosongkan untuk kembali ke
            jadwal default.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {matrix.areas.map((area) => {
              const target = areaTargets.get(area.id) ?? null;
              return (
                <div
                  key={area.id}
                  className={`rounded border bg-[var(--surface)] px-3 py-2 ${
                    target ? "border-[var(--sand-dark)]" : "border-[var(--border)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[var(--foreground)]">
                        {area.area_name}
                      </div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]">
                        {area.area_code}
                      </div>
                    </div>
                    {target ? (
                      <span
                        className="shrink-0 rounded-sm border border-[var(--sand-dark)] bg-[var(--sand-tint)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--sand-dark)]"
                        title="Area ini punya target nyata — window gate dihitung mundur dari target."
                      >
                        Baseline ulang
                      </span>
                    ) : null}
                  </div>
                  <AreaTargetEditor
                    areaId={area.id}
                    projectId={project.id}
                    initialTarget={target}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <SignalSummaryPanel signals={projectSignals} />

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
          Gantt rencana
        </h2>
        <Gantt
          areas={matrix?.areas ?? []}
          gates={(matrix?.gates ?? []).map((c) => ({ code: c, name: c }))}
          cells={scheduleCells}
          todayIso={jakartaToday}
        />
      </section>

      {matrix ? (
        <AreaGateMatrix data={matrix} />
      ) : (
        <div className="rounded border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-secondary)]">
          Matrix belum tersedia.
        </div>
      )}
    </div>
  );
}
