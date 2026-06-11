"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProject } from "@/lib/projects/mutations";
import { CheckIcon } from "@/components/icons/Icon";

type Project = {
  id: string;
  project_code: string;
  project_name: string;
  client_name: string | null;
  location: string | null;
  status: string;
  target_handover: string | null;
  kickoff_date: string | null;
};

export function ProjectInfoForm({ project }: { project: Project }) {
  const formId = useId();
  const router = useRouter();
  const [name, setName] = useState(project.project_name);
  const [client, setClient] = useState(project.client_name ?? "");
  const [location, setLocation] = useState(project.location ?? "");
  const [status, setStatus] = useState(project.status);
  const [kickoff, setKickoff] = useState(project.kickoff_date ?? "");
  const [target, setTarget] = useState(project.target_handover ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("projectId", project.id);
    fd.set("projectName", name.trim());
    fd.set("clientName", client.trim());
    fd.set("location", location.trim());
    fd.set("status", status);
    fd.set("kickoffDate", kickoff);
    fd.set("targetHandover", target);
    startTransition(async () => {
      const res = await updateProject(fd);
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form id={formId} onSubmit={submit} className="grid gap-4 rounded border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs text-[var(--text-secondary)]">
        Setel <strong>tanggal kickoff</strong> agar mesin readiness bisa memproyeksikan target tiap gate ke kalender nyata.
        Perubahan kickoff_date otomatis memicu rekalkulasi jadwal.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sand-dark)]">Nama proyek</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            maxLength={120}
            required
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sand-dark)]">Klien</span>
          <input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            disabled={pending}
            maxLength={120}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sand-dark)]">Lokasi</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={pending}
            maxLength={200}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sand-dark)]">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={pending}
            className="select-brand"
          >
            <option value="design">Desain</option>
            <option value="construction">Konstruksi</option>
            <option value="finishing">Finishing</option>
            <option value="handover">Serah terima</option>
            <option value="closed">Selesai</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sand-dark)]">
            Tanggal kickoff
          </span>
          <input
            type="date"
            value={kickoff}
            onChange={(e) => setKickoff(e.target.value)}
            disabled={pending}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none"
          />
          <span className="text-[10px] text-[var(--text-muted)]">Mengubah ini akan otomatis menghitung ulang target tiap gate.</span>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--sand-dark)]">Target serah terima</span>
          <input
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={pending}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm focus:border-[var(--sand-dark)] focus:outline-none"
          />
        </label>
      </div>

      {error ? (
        <div className="rounded border border-[var(--flag-critical)] bg-[var(--flag-critical-bg)] px-3 py-2 text-xs text-[var(--flag-critical)]">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded bg-[var(--foreground)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)] disabled:bg-[var(--text-muted)]"
        >
          {pending ? "Menyimpan…" : "Simpan perubahan"}
        </button>
        {saved ? (
          <span className="inline-flex items-center gap-1.5 rounded bg-[var(--flag-ok-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--flag-ok)]">
            <CheckIcon size={12} /> Tersimpan
          </span>
        ) : null}
      </div>
    </form>
  );
}
