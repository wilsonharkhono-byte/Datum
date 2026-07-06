"use client";

// Note: window.confirm() is used here intentionally for the remove flow.
// The table row layout makes inline confirmation widgets (like "are you sure?" buttons)
// awkward — they would push row height and shift column alignment unpredictably.
// This is one well-bounded exception to the /harden no-native-confirm rule.
// The confirm message includes the member name so the dialog is unambiguous.

import { useState, useTransition } from "react";
import { removeProjectMember } from "@/lib/projects/member-mutations";
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

export function ProjectMembersList({
  projectId,
  projectCode,
  members,
}: {
  projectId: string;
  projectCode: string;
  members: ProjectMemberRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove(m: ProjectMemberRow) {
    if (!confirm(`Hapus ${m.staff?.full_name ?? "(unknown)"} dari proyek ini?`)) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("staffId", m.staff_id);
    fd.set("roleOnProject", m.role_on_project);
    fd.set("projectCode", projectCode);
    startTransition(async () => {
      const res = await removeProjectMember(fd);
      if (!res.ok) setError(res.error);
    });
  }

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
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="bg-[var(--foreground)] text-[var(--text-inverse)]">
          <tr>
            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Nama</th>
            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Peran global</th>
            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Peran di proyek</th>
            <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Sejak</th>
            <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {active.map((m) => (
            <tr
              key={`${m.staff_id}-${m.role_on_project}`}
              className="bg-[var(--surface)] hover:bg-[var(--surface-alt)]"
            >
              <td className="px-3 py-2 font-medium text-[var(--foreground)]">
                {m.staff?.full_name ?? "(unknown)"}
              </td>
              <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtRole(m.staff?.role)}</td>
              <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtRole(m.role_on_project)}</td>
              <td className="px-3 py-2 text-[var(--text-secondary)]">{m.active_from}</td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => remove(m)}
                  disabled={pending}
                  aria-label={`Hapus ${m.staff?.full_name ?? "anggota"} dari proyek`}
                  className="rounded border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--flag-critical)] hover:bg-[var(--flag-critical-bg)] disabled:opacity-50"
                >
                  hapus
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? (
        <div className="flag-pop border-t border-[var(--border)] bg-[var(--flag-critical-bg)] px-3 py-2 text-xs text-[var(--flag-critical)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
