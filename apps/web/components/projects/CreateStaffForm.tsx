"use client";

import { useId, useState, useTransition } from "react";
import { createStaffWithPassword } from "@/lib/projects/staff-mutations";
import { CheckIcon } from "@/components/icons/Icon";

const ROLE_OPTIONS = [
  { value: "principal",       label: "Principal" },
  { value: "admin",           label: "Admin" },
  { value: "estimator",       label: "Estimator" },
  { value: "designer",        label: "Designer" },
  { value: "pic",             label: "PIC" },
  { value: "site_supervisor", label: "Site Supervisor" },
];

// Only principals can mint other principals/admins. Admins picking roles see
// the non-elevated subset; the server enforces the same gate.
const NON_ELEVATED_ROLES = ROLE_OPTIONS.filter(
  (r) => r.value !== "principal" && r.value !== "admin",
);

// Crypto-strong indices via Web Crypto getRandomValues — Math.random() is a
// predictable PRNG and the syllable list is in plain source, so guessing the
// password would only need the creation timestamp.
function randomInt(maxExclusive: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % maxExclusive;
}

function generateTempPassword(): string {
  const syllables = ["bata", "kayu", "pasir", "semen", "atap", "pintu", "kusen", "lampu", "marmer", "beton"];
  const pick = () => syllables[randomInt(syllables.length)];
  // Four syllables + 4 digits ≈ log2(10^4 · 10^4) ≈ 27 bits; small but the
  // password is meant to be one-time, surfaced to the principal, and changed
  // on first login. The principal should change the policy if they need more.
  return `${pick()}-${pick()}-${pick()}-${pick()}-${String(randomInt(10000)).padStart(4, "0")}`;
}

export function CreateStaffForm({
  projectId,
  projectCode,
  callerRole,
}: {
  projectId: string;
  projectCode: string;
  callerRole: "principal" | "admin" | "designer" | "pic" | "site_supervisor" | "estimator";
}) {
  const availableRoles = callerRole === "principal" ? ROLE_OPTIONS : NON_ELEVATED_ROLES;
  const formId = useId();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("designer");
  const [password, setPassword] = useState(() => generateTempPassword());
  const [roleOnProject, setRoleOnProject] = useState("designer");
  const [costVisible, setCostVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setCopied(false);
    const fd = new FormData();
    fd.set("email", email.trim());
    fd.set("fullName", fullName.trim());
    fd.set("role", role);
    fd.set("password", password);
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    fd.set("roleOnProject", roleOnProject);
    fd.set("costVisible", costVisible ? "true" : "false");
    // Snapshot the password we submitted — the server intentionally does not
    // echo it back to avoid leaking it through the action wire response.
    const submittedPassword = password;
    startTransition(async () => {
      const res = await createStaffWithPassword(fd);
      if (res.ok) {
        setSuccess({ email: res.email, password: submittedPassword });
        setEmail("");
        setFullName("");
        setPassword(generateTempPassword());
      } else {
        setError(res.error);
      }
    });
  }

  async function copyCredentials() {
    if (!success) return;
    const text = `Email: ${success.email}\nPassword: ${success.password}\n\nLogin di: ${typeof window !== "undefined" ? window.location.origin : ""}/login`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Gagal menyalin — silakan salin manual");
    }
  }

  if (success) {
    return (
      <div className="rounded border border-[var(--flag-ok)] bg-[var(--flag-ok-bg)] p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--flag-ok)]">
          <CheckIcon size={12} /> Staf baru berhasil dibuat
        </div>
        <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
          Salin kredensial di bawah dan kirim ke staf via WhatsApp. Mereka bisa ganti password setelah login pertama.
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs">
          <dt className="text-[var(--text-muted)]">Email</dt>
          <dd className="text-[var(--foreground)]">{success.email}</dd>
          <dt className="text-[var(--text-muted)]">Password</dt>
          <dd className="text-[var(--foreground)]">{success.password}</dd>
        </dl>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={copyCredentials}
            className="rounded bg-[var(--foreground)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)]"
          >
            {copied ? "Tersalin ✓" : "Salin kredensial"}
          </button>
          <button
            type="button"
            onClick={() => setSuccess(null)}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--text-secondary)]"
          >
            Buat staf lain
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <p className="text-xs text-[var(--text-secondary)]">
        Buat akun baru untuk staf yang belum ada di sistem. Kredensial bisa langsung dikirim via WhatsApp.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${formId}-email`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]">
            Email *
          </label>
          <input
            id={`${formId}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            required
            placeholder="nama@whastudio.id"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor={`${formId}-name`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]">
            Nama lengkap *
          </label>
          <input
            id={`${formId}-name`}
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={pending}
            required
            placeholder="mis. Wilson Harkhono"
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${formId}-role`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]">
            Peran global *
          </label>
          <select
            id={`${formId}-role`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={pending}
            className="select-brand w-full"
          >
            {availableRoles.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${formId}-prole`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]">
            Peran di proyek ini
          </label>
          <select
            id={`${formId}-prole`}
            value={roleOnProject}
            onChange={(e) => setRoleOnProject(e.target.value)}
            disabled={pending}
            className="select-brand w-full"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={`${formId}-pw`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]">
          Password sementara *
        </label>
        <div className="flex gap-2">
          <input
            id={`${formId}-pw`}
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            required
            minLength={8}
            className="flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 font-mono text-sm focus:border-[var(--sand-dark)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setPassword(generateTempPassword())}
            disabled={pending}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--text-secondary)]"
          >
            Acak ulang
          </button>
        </div>
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          Staf bisa ganti password sendiri setelah login pertama.
        </p>
      </div>

      <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={costVisible}
          onChange={(e) => setCostVisible(e.target.checked)}
          disabled={pending}
          className="h-3.5 w-3.5 accent-[var(--sand-dark)]"
        />
        Boleh lihat data biaya (cost-visible)
      </label>

      {error ? (
        <div className="rounded border border-[var(--flag-critical)] bg-[var(--flag-critical-bg)] px-3 py-2 text-xs text-[var(--flag-critical)]">
          {error}
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending || !email.trim() || !fullName.trim() || password.length < 8}
          className="rounded bg-[var(--foreground)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)] disabled:bg-[var(--text-muted)]"
        >
          {pending ? "Membuat…" : "Buat staf & undang ke proyek"}
        </button>
      </div>
    </form>
  );
}
