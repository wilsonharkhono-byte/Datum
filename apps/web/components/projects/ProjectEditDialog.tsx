"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { updateProject } from "@/lib/projects/mutations";
import { keys } from "@/lib/query/keys";
import type { DevelopmentOption, ProjectListItem } from "@/lib/projects/queries";
import { uploadProjectCover } from "@/lib/projects/cover-upload";

export function ProjectEditDialog({
  project, developments,
}: { project: ProjectListItem; developments: DevelopmentOption[] }) {
  const formId = useId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.project_name);
  const [client, setClient] = useState(project.client_name ?? "");
  const [location, setLocation] = useState(project.location ?? "");
  const [status, setStatus] = useState(project.status);
  const [target, setTarget] = useState(project.target_handover ?? "");
  const [development, setDevelopment] = useState(project.development_name ?? "");
  const [coverPath, setCoverPath] = useState<string | null>(project.cover_image_path);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("projectId", project.id);
    fd.set("projectName", name.trim());
    fd.set("clientName", client.trim());
    fd.set("location", location.trim());
    fd.set("status", status);
    fd.set("targetHandover", target);
    fd.set("developmentName", development.trim());
    fd.set("coverImagePath", coverPath ?? "");
    startTransition(async () => {
      const res = await updateProject(fd);
      if (res.ok) {
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: keys.projects() });
        router.refresh();
      } else setError(res.error);
    });
  }

  async function onPickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const res = await uploadProjectCover({ file, projectId: project.id });
    setUploading(false);
    if (res.ok) setCoverPath(res.storagePath);
    else setError(res.error);
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Edit proyek ${project.project_code}`}
        aria-expanded={open}
        className="rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
      >
        {open ? "tutup" : "edit"}
      </button>

      {open && (
        <form
          id={formId}
          onSubmit={submit}
          className="mt-3 grid gap-2 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-xs w-[min(420px,80vw)]"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Nama proyek</span>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={pending} maxLength={120} required className="rounded border border-[var(--border)] px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Klien</span>
              <input value={client} onChange={(e) => setClient(e.target.value)} disabled={pending} maxLength={120} className="rounded border border-[var(--border)] px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Lokasi</span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} disabled={pending} maxLength={200} className="rounded border border-[var(--border)] px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={pending} className="select-brand-sm">
                <option value="design">Desain</option>
                <option value="construction">Konstruksi</option>
                <option value="finishing">Finishing</option>
                <option value="handover">Serah terima</option>
                <option value="closed">Selesai</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Target serah terima</span>
              <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} disabled={pending} className="rounded border border-[var(--border)] px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Pengembangan</span>
              <input
                value={development}
                onChange={(e) => setDevelopment(e.target.value)}
                list="datum-developments"
                disabled={pending}
                maxLength={120}
                placeholder="mis. Bukit Darmo Golf"
                className="rounded border border-[var(--border)] px-2 py-1.5 text-sm"
              />
              <datalist id="datum-developments">
                {developments.map((d) => <option key={d.id} value={d.name} />)}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--sand-dark)]">Sampul (cover)</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onPickCover} disabled={pending || uploading} className="text-xs" />
              {uploading ? <span className="text-[10px] text-[var(--text-muted)]">Mengunggah…</span> : null}
              {coverPath ? (
                <button type="button" onClick={() => setCoverPath(null)} className="self-start text-[10px] font-medium text-[var(--flag-critical)] hover:underline">
                  Hapus sampul
                </button>
              ) : null}
            </label>
          </div>
          {error ? <div className="text-[11px] text-[var(--flag-critical)]">{error}</div> : null}
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !name.trim()} className="rounded bg-[var(--foreground)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-inverse)] disabled:bg-[var(--text-muted)]">
              {pending ? "Menyimpan…" : "Simpan"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={pending} className="rounded px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]">Batal</button>
          </div>
        </form>
      )}
    </div>
  );
}
