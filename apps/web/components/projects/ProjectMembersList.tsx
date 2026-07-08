"use client";

// Note: window.confirm() is used here intentionally for the remove flow.
// The table row layout makes inline confirmation widgets (like "are you sure?" buttons)
// awkward — they would push row height and shift column alignment unpredictably.
// This is one well-bounded exception to the /harden no-native-confirm rule.
// The confirm message includes the member name so the dialog is unambiguous.

import { Fragment, useState, useTransition } from "react";
import { removeProjectMember, updateProjectMember } from "@/lib/projects/member-mutations";
import type { ProjectMemberRow } from "@/lib/projects/member-queries";

const ROLE_LABELS: Record<string, string> = {
  principal:      "Principal",
  admin:          "Admin",
  estimator:      "Estimator",
  designer:       "Designer",
  pic:            "PIC",
  site_supervisor: "Site Supervisor",
};

function fmtRole(r: string | null | undefined): string {
  if (!r) return "—";
  return ROLE_LABELS[r] ?? r;
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function ProjectMembersList({
  projectId,
  projectCode,
  members,
}: {
  projectId: string;
  projectCode: string;
  members: ProjectMemberRow[];
}) {
  const active = members.filter((m) => !m.active_until);

  if (active.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--border)] p-6 text-center text-sm italic text-[var(--text-secondary)]">
        Belum ada anggota aktif. Tambah anggota di bawah agar mereka punya akses.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-[var(--border)]">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-[var(--foreground)] text-[var(--text-inverse)]">
          <tr>
            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Nama</th>
            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Peran global</th>
            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Peran di proyek</th>
            <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide">Cost-visible</th>
            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Sejak</th>
            <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {active.map((m) => (
            <MemberRow key={m.staff_id} projectId={projectId} projectCode={projectCode} member={m} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberRow({
  projectId,
  projectCode,
  member,
}: {
  projectId: string;
  projectCode: string;
  member: ProjectMemberRow;
}) {
  const [role, setRole] = useState(member.role_on_project);
  const [costVisible, setCostVisible] = useState(member.cost_visible);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = role.trim() !== member.role_on_project || costVisible !== member.cost_visible;

  function save() {
    if (!role.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("staffId", member.staff_id);
    fd.set("roleOnProject", role.trim());
    fd.set("costVisible", costVisible ? "true" : "false");
    fd.set("projectCode", projectCode);
    startTransition(async () => {
      const res = await updateProjectMember(fd);
      if (!res.ok) setError(res.error);
    });
  }

  function remove() {
    if (!confirm(
      `Hapus ${member.staff?.full_name ?? "(unknown)"} dari proyek ini? ` +
      `Proyek ini akan hilang dari tampilan mereka, tapi riwayatnya tetap tersimpan.`,
    )) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("staffId", member.staff_id);
    fd.set("roleOnProject", member.role_on_project);
    fd.set("projectCode", projectCode);
    startTransition(async () => {
      const res = await removeProjectMember(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <Fragment>
      <tr className="bg-[var(--surface)] hover:bg-[var(--surface-alt)]">
        <td className="px-3 py-2 font-medium text-[var(--foreground)]">
          <span className="inline-flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--sand)]/30 text-[9px] font-bold text-[var(--text-secondary)]">
              {initials(member.staff?.full_name)}
            </span>
            {member.staff?.full_name ?? "(unknown)"}
          </span>
        </td>
        <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtRole(member.staff?.role)}</td>
        <td className="px-3 py-2">
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={pending}
            maxLength={40}
            aria-label={`Peran di proyek untuk ${member.staff?.full_name ?? "anggota"}`}
            className="w-full min-w-[8rem] rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs focus:border-[var(--sand-dark)] focus:outline-none"
          />
        </td>
        <td className="px-3 py-2 text-center">
          <input
            type="checkbox"
            checked={costVisible}
            onChange={(e) => setCostVisible(e.target.checked)}
            disabled={pending}
            aria-label={`Cost-visible untuk ${member.staff?.full_name ?? "anggota"}`}
            className="h-3.5 w-3.5 accent-[var(--sand-dark)]"
          />
        </td>
        <td className="px-3 py-2 text-[var(--text-secondary)]">{member.active_from}</td>
        <td className="px-3 py-2 text-right">
          <div className="inline-flex items-center gap-1.5">
            {dirty ? (
              <button
                type="button"
                onClick={save}
                disabled={pending || !role.trim()}
                className="rounded border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--flag-ok)] hover:bg-[var(--flag-ok-bg)] disabled:opacity-50"
              >
                simpan
              </button>
            ) : null}
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              aria-label={`Hapus ${member.staff?.full_name ?? "anggota"} dari proyek`}
              className="rounded border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--flag-critical)] hover:bg-[var(--flag-critical-bg)] disabled:opacity-50"
            >
              hapus
            </button>
          </div>
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={6} className="p-0">
            <div className="flag-pop border-t border-[var(--border)] bg-[var(--flag-critical-bg)] px-3 py-2 text-xs text-[var(--flag-critical)]">
              {error}
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
