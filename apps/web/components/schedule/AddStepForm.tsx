"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCatalogStep, addCustomStep } from "@/lib/steps/actions";
import type { CatalogStep } from "@/lib/steps/queries";

type StepType = "decision" | "procurement" | "site_work" | "inspection";
const TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: "site_work", label: "Pekerjaan" },
  { value: "decision", label: "Keputusan" },
  { value: "procurement", label: "Pengadaan" },
  { value: "inspection", label: "Inspeksi" },
];

export function AddStepForm({ areaId, addableCatalog }: { areaId: string; addableCatalog: CatalogStep[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"catalog" | "custom">(addableCatalog.length > 0 ? "catalog" : "custom");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [stepType, setStepType] = useState<StepType>("site_work");
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) { setName(""); setCode(""); setOpen(false); router.refresh(); }
      else setError(res.error);
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => { setError(null); setOpen(true); }}
        className="min-h-11 w-full border-t border-[var(--border)] px-4 py-2.5 text-left text-[12px] font-semibold text-[var(--sand-dark)] hover:bg-[var(--sand-tint)] md:min-h-0">
        + Tambah langkah
      </button>
    );
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-3">
      <div className="mb-2 flex gap-1.5">
        {addableCatalog.length > 0 ? (
          <button type="button" disabled={pending} onClick={() => setMode("catalog")}
            className={`min-h-11 rounded border px-2.5 py-1 text-[11px] font-semibold md:min-h-0 ${mode === "catalog" ? "border-[var(--sand-dark)] bg-[var(--surface)] text-[var(--foreground)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
            Dari rekomendasi
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={() => setMode("custom")}
          className={`min-h-11 rounded border px-2.5 py-1 text-[11px] font-semibold md:min-h-0 ${mode === "custom" ? "border-[var(--sand-dark)] bg-[var(--surface)] text-[var(--foreground)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
          Baru
        </button>
      </div>

      {mode === "catalog" && addableCatalog.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <select value={code} disabled={pending} onChange={(e) => setCode(e.target.value)}
            className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] md:min-h-0">
            <option value="">Pilih langkah…</option>
            {addableCatalog.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <button type="button" disabled={pending || !code}
            onClick={() => run(() => addCatalogStep({ areaId, stepCode: code }))}
            className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
            Tambah
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <input value={name} disabled={pending} onChange={(e) => setName(e.target.value)}
            placeholder="Nama langkah baru…"
            className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] focus:border-[var(--sand-dark)] focus:outline-none md:min-h-0" />
          <select value={stepType} disabled={pending} onChange={(e) => setStepType(e.target.value as StepType)}
            className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] md:min-h-0">
            {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button type="button" disabled={pending || !name.trim()}
            onClick={() => run(() => addCustomStep({ areaId, name: name.trim(), stepType }))}
            className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
            Tambah
          </button>
        </div>
      )}

      <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null); setName(""); setCode(""); setMode(addableCatalog.length > 0 ? "catalog" : "custom"); }}
        className="mt-2 min-h-11 text-[11px] text-[var(--text-muted)] hover:text-[var(--foreground)] disabled:opacity-50 md:min-h-0">
        Batal
      </button>
      {error ? <p className="mt-2 text-[11px] text-red-700">{error}</p> : null}
    </div>
  );
}
