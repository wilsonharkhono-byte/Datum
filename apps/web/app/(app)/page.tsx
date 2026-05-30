import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, project_code, project_name, client_name, status")
    .order("project_code");

  if (error) {
    return <p className="text-red-600">Gagal memuat proyek: {error.message}</p>;
  }
  if (!projects || projects.length === 0) {
    return <p className="text-stone-600">Belum ada proyek yang ditugaskan.</p>;
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-stone-900">Proyek Aktif</h1>
      <ul className="space-y-2">
        {projects.map((p) => (
          <li
            key={p.id}
            className="rounded border border-stone-200 bg-white px-4 py-3"
          >
            <div className="font-medium text-stone-900">
              {p.project_code} · {p.project_name}
            </div>
            <div className="text-sm text-stone-600">
              Client: {p.client_name ?? "—"} · Status: {p.status}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
