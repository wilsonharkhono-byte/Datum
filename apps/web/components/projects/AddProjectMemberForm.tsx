"use client";

import { useId, useState, useTransition } from "react";
import { addProjectMember } from "@/lib/projects/member-mutations";

type StaffOption = {
  id: string;
  full_name: string | null;
  role: string | null;
  email: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  principal:       "Principal",
  admin:           "Admin",
  estimator:       "Estimator",
  designer:        "Designer",
  pic:             "PIC",
  site_supervisor: "Site Supervisor",
};

function defaultRoleFor(s: StaffOption | undefined): string {
  if (!s?.role) return "";
  return ROLE_LABELS[s.role] ?? s.role;
}

export function AddProjectMemberForm({
  projectId,
  projectCode,
  existingActiveStaffIds,
  candidates,
}: {
  projectId: string;
  projectCode: string;
  existingActiveStaffIds: string[];
  candidates: StaffOption[];
}) {
  const formId = useId();
  const existing = new Set(existingActiveStaffIds);
  const addable = candidates.filter((s) => !existing.has(s.id));

  const [staffId, setStaffId] = useState<string>(addable[0] ? addable[0].id : "");
  const [role, setRole] = useState<string>(defaultRoleFor(addable[0]));
  const [costVisible, setCostVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-seed the role text field with a sensible default whenever the admin
  // picks a different staff member — driven directly from the <select>'s
  // onChange rather than an effect, so there's no cascading-render setState.
  function pickStaff(id: string) {
    setStaffId(id);
    setRole(defaultRoleFor(addable.find((s) => s.id === id)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("staffId", staffId);
    fd.set("roleOnProject", role.trim());
    fd.set("costVisible", costVisible ? "true" : "false");
    fd.set("projectCode", projectCode);
    startTransition(async () => {
      const res = await addProjectMember(fd);
      if (res.ok) {
        const name = candidates.find((s) => s.id === staffId)?.full_name ?? "anggota";
        setSuccess(`${name} ditambahkan sebagai ${role.trim()}.`);
        // Pick next available staff for convenience
        const remaining = addable.filter((s) => s.id !== staffId);
        const next = remaining[0];
        if (next) {
          pickStaff(next.id);
          setCostVisible(false);
        }
      } else {
        setError(res.error);
      }
    });
  }

  if (addable.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--border)] p-4 text-sm italic text-[var(--text-secondary)]">
        Semua staf aktif sudah jadi anggota proyek ini.
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-[1.5fr_1fr_auto] sm:items-end"
    >
      <div>
        <label
          htmlFor={`${formId}-staff`}
          className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]"
        >
          Staf
        </label>
        <select
          id={`${formId}-staff`}
          value={staffId}
          onChange={(e) => pickStaff(e.target.value)}
          disabled={pending}
          className="select-brand w-full"
        >
          {addable.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name ?? "(no name)"} {s.role ? `· ${s.role}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label
          htmlFor={`${formId}-role`}
          className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]"
        >
          Peran di proyek
        </label>
        <input
          id={`${formId}-role`}
          type="text"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={pending}
          required
          maxLength={40}
          placeholder="mis. site supervisor"
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none w-full"
        />
      </div>
      <div>
        <button
          type="submit"
          disabled={pending || !staffId || !role.trim()}
          className="rounded bg-[var(--foreground)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)] disabled:bg-[var(--text-muted)]"
        >
          {pending ? "Menambah…" : "Tambah anggota"}
        </button>
      </div>
      <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] sm:col-span-3">
        <input
          type="checkbox"
          checked={costVisible}
          onChange={(e) => setCostVisible(e.target.checked)}
          disabled={pending}
          className="h-3.5 w-3.5 accent-[var(--sand-dark)]"
        />
        Boleh lihat data biaya (cost-visible) untuk proyek ini
      </label>
      {error ? (
        <div className="rounded border border-[var(--flag-critical)] bg-[var(--flag-critical-bg)] px-3 py-2 text-xs text-[var(--flag-critical)] sm:col-span-3">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded border border-[var(--flag-ok)] bg-[var(--flag-ok-bg)] px-3 py-2 text-xs text-[var(--flag-ok)] sm:col-span-3">
          {success}
        </div>
      ) : null}
    </form>
  );
}
