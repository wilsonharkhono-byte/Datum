import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchMatrix } from "@/lib/matrix/fetch-matrix";
import { AreaGateMatrix } from "@/components/matrix/area-gate-matrix";
import { RecomputeButton } from "@/components/schedule/RecomputeButton";
import { RULE_VERSION } from "@/lib/gates/readiness-rules";
import { Gantt } from "@/components/schedule/Gantt";
import { RulesViewer } from "@/components/schedule/RulesViewer";
import { getProjectScheduleCells, getAreaTargetDates } from "@/lib/gates/schedule";
import { AreaTargetEditor } from "@/components/schedule/AreaTargetEditor";
import { getAreaStepView, getRemovedAreaSteps, getAddableCatalogSteps, getAreaStepEvents, getProjectStepSignals } from "@/lib/steps/queries";
import { AreaStepsPanel } from "@/components/schedule/AreaStepsPanel";
import { SignalSummaryPanel } from "@/components/schedule/SignalSummaryPanel";

export default async function ProjectSchedulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_code, project_name")
    .eq("project_code", slug.toUpperCase())
    .maybeSingle();
  if (!project) {
    return (
      <div className="p-6 text-red-700">
        Proyek tidak ditemukan: <code>{slug}</code>
        <div className="mt-3"><Link href="/" className="underline">← kembali</Link></div>
      </div>
    );
  }

  const matrix = await fetchMatrix(project.id);
  const scheduleCells = await getProjectScheduleCells(project.id);
  const areaTargets = await getAreaTargetDates(project.id);

  // WIB (Asia/Jakarta) today — same pattern as Board + MiniCard.
  const jakartaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const nowIso = new Date().toISOString();

  // Fetch project-wide signals (one round-trip for steps, one for deps, one for area names).
  const projectSignals = await getProjectStepSignals(supabase, project.id, jakartaToday, nowIso);

  const bathroomAreas = (matrix?.areas ?? []).filter((a) => a.area_type === "bathroom");
  const stepViews = await Promise.all(
    bathroomAreas.map(async (a) => {
      const [view, removedSteps, addableCatalog] = await Promise.all([
        getAreaStepView(supabase, a.id),
        getRemovedAreaSteps(supabase, a.id),
        getAddableCatalogSteps(supabase, a.id),
      ]);
      return { area: a, view, removedSteps, addableCatalog };
    }),
  );

  // Fetch all step events for all bathroom areas in one query (keyed by step id).
  const allStepIds = stepViews.flatMap(({ view }) => view.steps.map((s) => s.id));
  const stepEventsMap = await getAreaStepEvents(supabase, allStepIds);

  // Count stale cells
  const { count: staleCount } = await supabase
    .from("area_gate_status")
    .select("*", { count: "exact", head: true })
    .eq("project_id", project.id)
    .eq("stale", true);

  // Latest recompute time across all cells
  const { data: latest } = await supabase
    .from("area_gate_status")
    .select("last_recomputed_at")
    .eq("project_id", project.id)
    .order("last_recomputed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <Link href={`/project/${project.project_code}`} className="text-xs text-[var(--text-muted)] hover:underline">
          ← {project.project_code} Board
        </Link>
        <RecomputeButton projectId={project.id} projectCode={project.project_code} />
      </div>

      {staleCount && staleCount > 0 ? (
        <div className="mb-3 rounded border border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 text-xs text-[var(--sand-dark)]">
          🔄 {staleCount} sel butuh recompute — klik tombol di atas untuk update.
        </div>
      ) : null}

      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">
          Jadwal & Readiness
        </p>
        <h1 className="text-2xl font-semibold text-[#141210]">
          {project.project_code} · {project.project_name}
        </h1>
        <p className="mt-1 text-sm text-[#524E49]">
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

      {stepViews.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
            Langkah pekerjaan — kamar mandi
          </h2>
          <div className="flex flex-col gap-2">
            {stepViews.map(({ area, view, removedSteps, addableCatalog }) => (
              <AreaStepsPanel
                key={area.id}
                areaId={area.id}
                areaName={area.area_name}
                steps={view.steps}
                flags={view.flags}
                addableCatalog={addableCatalog}
                removedSteps={removedSteps}
                stepEventsMap={stepEventsMap}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
          Gantt rencana
        </h2>
        <Gantt
          areas={matrix?.areas ?? []}
          gates={(matrix?.gates ?? []).map((c) => ({ code: c, name: c }))}
          cells={scheduleCells}
        />
      </section>

      {matrix ? (
        <AreaGateMatrix data={matrix} />
      ) : (
        <div className="rounded border border-[#B5AFA8] bg-[#FDFAF6] p-6 text-sm text-[#524E49]">
          Matrix belum tersedia.
        </div>
      )}
    </div>
  );
}
