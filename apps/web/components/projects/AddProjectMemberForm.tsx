"use client";

import { useId, useState, useTransition } from "react";
import { addProjectMember } from "@/lib/projects/member-mutations";

type StaffOption = {
  id: string;
  full_name: string | null;
  role: string | null;
  email: string | null;
};

const ROLE_OPTIONS = [
  { value: "principal",       label: "Principal" },
  { value: "admin",           label: "Admin" },
  { value: "estimator",       label: "Estimator" },
  { value: "designer",        label: "Designer" },
  { value: "pic",             label: "PIC" },
  { value: "site_supervisor", label: "Site Supervisor" },
];

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
  const [role, setRole] = useState<string>("designer");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("staffId", staffId);
    fd.set("roleOnProject", role);
    fd.set("projectCode", projectCode);
    startTransition(async () => {
      const res = await addProjectMember(fd);
      if (res.ok) {
        const name = candidates.find((s) => s.id === staffId)?.full_name ?? "anggota";
        setSuccess(`${name} ditambahkan sebagai ${role}.`);
        // Pick next available staff for convenience
        const remaining = addable.filter((s) => s.id !== staffId);
        const next = remaining[0];
        if (next) setStaffId(next.id);
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
          onChange={(e) => setStaffId(e.target.value)}
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
        <select
          id={`${formId}-role`}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={pending}
          className="select-brand w-full"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <button
          type="submit"
          disabled={pending || !staffId}
          className="rounded bg-[var(--foreground)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)] disabled:bg-[var(--text-muted)]"
        >
          {pending ? "Menambah…" : "Tambah anggota"}
        </button>
      </div>
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
