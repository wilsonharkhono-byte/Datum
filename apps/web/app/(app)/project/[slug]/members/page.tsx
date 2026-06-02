import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectMembers, getAvailableStaff } from "@/lib/projects/member-queries";
import { ProjectMembersList } from "@/components/projects/ProjectMembersList";
import { AddProjectMemberForm } from "@/components/projects/AddProjectMemberForm";

export default async function ProjectMembersPage({
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
      <div className="p-6 text-[var(--flag-critical)]">
        Proyek tidak ditemukan: {slug}
      </div>
    );
  }
  const [members, staff] = await Promise.all([
    getProjectMembers(supabase, project.id),
    getAvailableStaff(supabase),
  ]);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link
        href={`/project/${project.project_code}`}
        className="text-xs text-[var(--text-secondary)] hover:underline"
      >
        ← {project.project_code} Board
      </Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sand-dark)]">
          Anggota proyek
        </p>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">
          {project.project_code} · {project.project_name}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Staf yang punya akses ke proyek ini. RLS memakai daftar ini untuk membatasi siapa yang bisa lihat
          dan menulis ke kartu, aktivitas, komentar, dan draft.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
          Anggota aktif
        </h2>
        <ProjectMembersList
          projectId={project.id}
          projectCode={project.project_code}
          members={members}
        />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--sand-dark)]">
          Tambah anggota
        </h2>
        <AddProjectMemberForm
          projectId={project.id}
          projectCode={project.project_code}
          existingActiveStaffIds={members.filter((m) => !m.active_until).map((m) => m.staff_id)}
          candidates={staff}
        />
      </section>
    </div>
  );
}
