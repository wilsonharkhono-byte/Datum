"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProject } from "@/lib/projects/mutations";

export function ProjectCreateForm() {
  const id = useId();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<"design"|"construction"|"finishing"|"handover"|"closed">("design");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string,string>>({});
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const fd = new FormData();
    fd.set("projectCode", code);
    fd.set("projectName", name);
    if (client) fd.set("clientName", client);
    if (location) fd.set("location", location);
    fd.set("status", status);
    if (target) fd.set("targetHandover", target);
    startTransition(async () => {
      const res = await createProject(fd);
      if (res.ok) {
        router.push(`/project/${res.projectCode}`);
      } else {
        setError(res.error);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      }
    });
  }

  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]";
  const inputCls = "w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--sand-dark)] focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor={`${id}-code`} className={labelCls}>Kode proyek *</label>
        <input
          id={`${id}-code`}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          required
          disabled={pending}
          placeholder="mis. BDG-H2"
          maxLength={40}
          className={inputCls}
        />
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">Huruf besar, angka, dan tanda hubung saja. Akan jadi URL: /project/[code]</p>
        {fieldErrors.projectCode ? <p className="mt-1 text-[10px] text-[var(--flag-critical)]">{fieldErrors.projectCode}</p> : null}
      </div>
      <div>
        <label htmlFor={`${id}-name`} className={labelCls}>Nama proyek *</label>
        <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} required disabled={pending} maxLength={120} placeholder="mis. Bukit Darmo Golf H-2" className={inputCls} />
        {fieldErrors.projectName ? <p className="mt-1 text-[10px] text-[var(--flag-critical)]">{fieldErrors.projectName}</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-client`} className={labelCls}>Klien</label>
          <input id={`${id}-client`} value={client} onChange={(e) => setClient(e.target.value)} disabled={pending} maxLength={120} placeholder="mis. Pak Sugiarto" className={inputCls} />
        </div>
        <div>
          <label htmlFor={`${id}-location`} className={labelCls}>Lokasi</label>
          <input id={`${id}-location`} value={location} onChange={(e) => setLocation(e.target.value)} disabled={pending} maxLength={200} placeholder="mis. Citraland Surabaya" className={inputCls} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-status`} className={labelCls}>Status awal</label>
          <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} disabled={pending} className="select-brand w-full">
            <option value="design">Desain</option>
            <option value="construction">Konstruksi</option>
            <option value="finishing">Finishing</option>
            <option value="handover">Serah terima</option>
            <option value="closed">Selesai</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-target`} className={labelCls}>Target serah terima</label>
          <input id={`${id}-target`} type="date" value={target} onChange={(e) => setTarget(e.target.value)} disabled={pending} className={inputCls} />
        </div>
      </div>
      {error ? <div className="rounded border border-[var(--flag-critical)] bg-[var(--flag-critical-bg)] px-3 py-2 text-sm text-[var(--flag-critical)]">{error}</div> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending || !code.trim() || !name.trim()} className="rounded bg-[var(--foreground)] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)] disabled:bg-[var(--text-muted)]">
          {pending ? "Menyimpan…" : "Buat proyek"}
        </button>
        <button type="button" onClick={() => router.push("/")} disabled={pending} className="rounded px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]">
          Batal
        </button>
      </div>
    </form>
  );
}
