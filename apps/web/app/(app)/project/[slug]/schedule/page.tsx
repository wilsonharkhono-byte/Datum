import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchMatrix } from "@/lib/matrix/fetch-matrix";
import { AreaGateMatrix } from "@/components/matrix/area-gate-matrix";
import { RecomputeButton } from "@/components/schedule/RecomputeButton";
import { RULE_VERSION } from "@/lib/gates/readiness-rules";

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
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <Link href={`/project/${project.project_code}`} className="text-xs text-stone-500 hover:underline">
          ← {project.project_code} Board
        </Link>
        <RecomputeButton projectId={project.id} projectCode={project.project_code} />
      </div>

      {staleCount && staleCount > 0 ? (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
