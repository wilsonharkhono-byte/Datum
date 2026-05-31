import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AreaGateMatrix } from "@/components/matrix/area-gate-matrix";
import { fetchMatrix } from "@/lib/matrix/fetch-matrix";

const statusLabel: Record<string, string> = {
  design: "Desain",
  construction: "Konstruksi",
  finishing: "Finishing",
  handover: "Serah terima",
  closed: "Selesai",
};

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, project_code, project_name, client_name, location, status, target_handover")
    .order("project_code");

  if (error) {
    return (
      <div className="rounded-[8px] border border-[#C62828]/25 bg-[rgba(198,40,40,0.08)] p-4 text-sm font-medium text-[#C62828]">
        Gagal memuat proyek: {error.message}
      </div>
    );
  }
  if (!projects || projects.length === 0) {
    return (
      <div className="rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] p-6 text-[#524E49]">
        Belum ada proyek yang ditugaskan.
      </div>
    );
  }

  const primaryProject = projects[0]!;
  const matrix = await fetchMatrix(primaryProject.id);

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">
            Dashboard proyek
          </p>
          <h1 className="max-w-3xl text-3xl font-semibold leading-tight text-[#141210]">
            Kontrol finishing harian untuk area, gate, dan prioritas lapangan.
          </h1>
        </div>
        <div className="rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7A6B56]">
            Fokus hari ini
          </div>
          <div className="mt-3 text-lg font-semibold text-[#141210]">
            {primaryProject.project_code}
          </div>
          <div className="mt-1 text-sm text-[#524E49]">
            {primaryProject.project_name}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7A6B56]">
            Proyek aktif
          </div>
          <div className="mt-3 text-3xl font-semibold text-[#141210]">{projects.length}</div>
        </div>
        <div className="rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7A6B56]">
            Area fokus
          </div>
          <div className="mt-3 text-3xl font-semibold text-[#141210]">
            {matrix?.areas.length ?? 0}
          </div>
        </div>
        <div className="rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7A6B56]">
            Gate aktif
          </div>
          <div className="mt-3 text-3xl font-semibold text-[#141210]">
            {matrix?.gates.length ?? 0}
          </div>
        </div>
        <div className="rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7A6B56]">
            Status utama
          </div>
          <div className="mt-3 text-lg font-semibold text-[#141210]">
            {statusLabel[primaryProject.status] ?? primaryProject.status}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6]">
          <div className="border-b border-[#B5AFA8] bg-[#141210] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#FDFAF6]">
            Proyek aktif
          </div>
          <ul className="divide-y divide-[#B5AFA8]/70">
        {projects.map((p) => (
          <li
            key={p.id}
                className="px-4 py-4"
          >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold text-[#141210]">
              {p.project_code} · {p.project_name}
            </div>
                    <div className="mt-1 text-sm leading-5 text-[#524E49]">
                      Client: {p.client_name ?? "-"}
                      {p.location && ` · ${p.location}`}
                    </div>
                  </div>
                  <span className="rounded-[5px] bg-[#B29F86]/15 px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#7A6B56]">
                    {statusLabel[p.status] ?? p.status}
                  </span>
                </div>
                {p.target_handover && (
                  <div className="mt-3 text-xs font-medium text-[#847E78]">
                    Target serah terima: {p.target_handover}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0 rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] p-4">
          {matrix ? (
            <AreaGateMatrix data={matrix} />
          ) : (
            <div className="text-sm text-[#524E49]">
              Matrix belum tersedia untuk proyek ini.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
