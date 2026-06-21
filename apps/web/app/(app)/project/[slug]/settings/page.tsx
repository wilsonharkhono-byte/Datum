import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectMembers, getAvailableStaff, getProjectBySlug } from "@datum/core";
import { getProjectAreas } from "@/lib/projects/area-queries";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import { ProjectMembersList } from "@/components/projects/ProjectMembersList";
import { AddProjectMemberForm } from "@/components/projects/AddProjectMemberForm";
import { CreateStaffForm } from "@/components/projects/CreateStaffForm";
import { AreasManager } from "@/components/projects/AreasManager";
import { ProjectInfoForm } from "@/components/projects/ProjectInfoForm";
import { SettingsTabs, type SettingsTabKey } from "@/components/projects/SettingsTabs";

export default async function ProjectSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; mode?: string }>;
}) {
  const { slug } = await params;
  const { tab, mode } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const caller = await getCurrentStaff();
  // Any signed-in staff may reach this page; principal/admin see all tabs,
  // everyone else is limited to the Areas tab (they can add/edit areas).
  if (!caller) {
    redirect(`/project/${slug}`);
  }
  const canManage = canManageAccess(caller);

  const project = await getProjectBySlug(supabase, slug);
  if (!project) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 text-[var(--flag-critical)] sm:p-6">
        Proyek tidak ditemukan: {slug}
      </div>
    );
  }

  const requestedTab: SettingsTabKey =
    tab === "areas" ? "areas" : tab === "proyek" ? "proyek" : "akses";
  // Staff (non-admin) only have the Areas tab.
  const activeTab: SettingsTabKey = canManage ? requestedTab : "areas";
  const activeMode = mode === "baru" ? "baru" : "existing";

  // Members + staff lists are only needed (and only readable) for the access
  // tab, which is principal/admin-only. Areas load for everyone.
  const areas = await getProjectAreas(supabase, project.id);
  let members: Awaited<ReturnType<typeof getProjectMembers>> = [];
  let staff: Awaited<ReturnType<typeof getAvailableStaff>> = [];
  if (canManage) {
    [members, staff] = await Promise.all([
      getProjectMembers(supabase, project.id),
      getAvailableStaff(supabase),
    ]);
  }

  return (
    <div className="bg-[var(--background)] py-4 md:py-6">
      <div className="mx-auto w-full max-w-5xl px-3 md:px-4">
        <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_24px_-12px_rgba(122,107,86,0.35)]">
          {/* Modal-style header */}
          <div className="flex items-center justify-between gap-3 border-b border-[var(--foreground)] bg-[var(--foreground)] px-4 py-2.5 text-[var(--text-inverse)] md:px-6">
            <Link
              href={`/project/${slug}`}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-inverse-secondary)] hover:text-[var(--text-inverse)]"
            >
              ← {project.project_code}
            </Link>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-inverse-secondary)]">
              Pengaturan Proyek
            </span>
          </div>

          {/* Title row + tabs */}
          <div className="border-b border-[var(--border)] px-4 py-4 md:px-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sand-dark)]">
              {project.project_code} · {project.project_name}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
              Pengaturan
            </h1>
            <div className="mt-3">
              <SettingsTabs activeTab={activeTab} slug={slug} canManage={canManage} />
            </div>
          </div>

          <div className="px-4 py-5 md:px-6 md:py-6">
            {activeTab === "akses" ? (
              <AksesTab
                projectId={project.id}
                projectCode={project.project_code}
                members={members}
                staff={staff}
                activeMode={activeMode}
                slug={slug}
                callerRole={caller!.role}
              />
            ) : activeTab === "areas" ? (
              <AreasTab
                projectId={project.id}
                projectCode={project.project_code}
                areas={areas}
                canDelete={canManage}
              />
            ) : (
              <ProyekTab project={project} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AksesTab({
  projectId,
  projectCode,
  members,
  staff,
  activeMode,
  slug,
  callerRole,
}: {
  projectId: string;
  projectCode: string;
  members: Awaited<ReturnType<typeof getProjectMembers>>;
  staff: Awaited<ReturnType<typeof getAvailableStaff>>;
  activeMode: "existing" | "baru";
  slug: string;
  callerRole: "principal" | "admin" | "designer" | "pic" | "site_supervisor" | "estimator";
}) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="min-w-0">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
            Anggota aktif
          </h2>
          <span className="text-[10px] text-[var(--text-muted)]">
            {members.filter((m) => !m.active_until).length} orang
          </span>
        </div>
        <p className="mb-3 mt-1 text-xs text-[var(--text-secondary)]">
          Hanya anggota di daftar ini yang bisa membaca dan menulis ke kartu, aktivitas, dan komentar proyek ini.
          Principal, admin, dan estimator selalu bisa membaca semua proyek.
        </p>
        <ProjectMembersList
          projectId={projectId}
          projectCode={projectCode}
          members={members}
        />
      </section>

      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
          Tambah anggota
        </h2>
        <div className="mt-3 inline-flex">
          <div className="seg" role="tablist" aria-label="Mode tambah anggota">
            <Link
              href={`/project/${slug}/settings?tab=akses&mode=existing`}
              role="tab"
              aria-selected={activeMode === "existing"}
              className={`seg-btn${activeMode === "existing" ? " seg-active" : ""}`}
            >
              Staf yang ada
            </Link>
            <Link
              href={`/project/${slug}/settings?tab=akses&mode=baru`}
              role="tab"
              aria-selected={activeMode === "baru"}
              className={`seg-btn${activeMode === "baru" ? " seg-active" : ""}`}
            >
              Buat staf baru
            </Link>
          </div>
        </div>
        <div className="mt-3">
          {activeMode === "existing" ? (
            <AddProjectMemberForm
              projectId={projectId}
              projectCode={projectCode}
              existingActiveStaffIds={members.filter((m) => !m.active_until).map((m) => m.staff_id)}
              candidates={staff}
            />
          ) : (
            <CreateStaffForm
              projectId={projectId}
              projectCode={projectCode}
              callerRole={callerRole}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function AreasTab({
  projectId,
  projectCode,
  areas,
  canDelete,
}: {
  projectId: string;
  projectCode: string;
  areas: Awaited<ReturnType<typeof getProjectAreas>>;
  canDelete: boolean;
}) {
  return (
    <div className="grid gap-4">
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
          Areas (ruangan / zona)
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-[var(--text-secondary)]">
          Areas adalah ruangan atau zona fisik proyek. Mesin readiness menghitung status gate per area —
          kartu yang terkait ke sebuah area akan menggerakkan kolom area itu di matrix Gate × Area.
        </p>
      </section>
      <AreasManager
        projectId={projectId}
        projectCode={projectCode}
        areas={areas}
        canDelete={canDelete}
      />
    </div>
  );
}

function ProyekTab({
  project,
}: {
  project: {
    id: string;
    project_code: string;
    project_name: string;
    client_name: string | null;
    location: string | null;
    status: string;
    target_handover: string | null;
    kickoff_date: string | null;
  };
}) {
  return (
    <div className="grid gap-4">
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
          Info proyek
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-[var(--text-secondary)]">
          Detail dasar proyek dan tanggal kickoff yang menjadi titik anchor jadwal.
        </p>
      </section>
      <ProjectInfoForm project={project} />
    </div>
  );
}
