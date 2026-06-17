"use client";

// Note: window.confirm() is used here intentionally for the delete flow.
// The table row layout makes inline confirmation widgets awkward — they would
// push row height and shift column alignment unpredictably. Same precedent as
// ProjectMembersList. The confirm message includes the area code+name so the
// dialog is unambiguous.

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Area } from "@datum/db";
import {
  createArea,
  updateArea,
  deleteArea,
} from "@/lib/projects/area-mutations";
import { AreaSetup } from "@/components/area-setup/AreaSetup";
import { SparkIcon } from "@/components/icons/Icon";

const AREA_TYPE_OPTIONS = [
  { value: "bathroom",    label: "Kamar mandi" },
  { value: "kitchen",     label: "Dapur" },
  { value: "bedroom",     label: "Kamar tidur" },
  { value: "living",      label: "Ruang tamu" },
  { value: "dining",      label: "Ruang makan" },
  { value: "garden",      label: "Taman" },
  { value: "circulation", label: "Sirkulasi" },
  { value: "utility",     label: "Utility" },
  { value: "general",     label: "Umum" },
] as const;

type AreaTypeValue = (typeof AREA_TYPE_OPTIONS)[number]["value"];

const AREA_TYPE_LABELS: Record<string, string> = AREA_TYPE_OPTIONS.reduce(
  (acc, o) => {
    acc[o.value] = o.label;
    return acc;
  },
  {} as Record<string, string>,
);

function fmtAreaType(t: string | null | undefined): string {
  if (!t) return "—";
  return AREA_TYPE_LABELS[t] ?? t;
}

function fmtSqm(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function AreasManager({
  projectId,
  projectCode,
  areas,
  canDelete,
}: {
  projectId: string;
  projectCode: string;
  areas: Area[];
  // Only principal/admin may delete areas; staff can still add + edit.
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  function startEdit(id: string) {
    setError(null);
    setEditingId(id);
  }
  function cancelEdit() {
    setError(null);
    setEditingId(null);
  }

  function saveEdit(a: Area, draft: AreaDraft) {
    setError(null);
    const fd = new FormData();
    fd.set("areaId", a.id);
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    fd.set("areaCode", draft.areaCode);
    fd.set("areaName", draft.areaName);
    if (draft.floor) fd.set("floor", draft.floor);
    fd.set("areaType", draft.areaType);
    if (draft.areaSqm) fd.set("areaSqm", draft.areaSqm);
    if (draft.sortOrder) fd.set("sortOrder", draft.sortOrder);
    startTransition(async () => {
      const res = await updateArea(fd);
      if (res.ok) {
        setEditingId(null);
      } else {
        setError(res.error);
      }
    });
  }

  function remove(a: Area) {
    if (!confirm(`Hapus area "${a.area_code} — ${a.area_name}" dari proyek ini?`)) return;
    setError(null);
    const fd = new FormData();
    fd.set("areaId", a.id);
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    startTransition(async () => {
      const res = await deleteArea(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand-dark)]">
            Area
          </h2>
          <span className="text-[10px] text-[var(--text-muted)]">
            {areas.length} area
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSetupOpen(true)}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--sand-dark)] hover:border-[var(--sand-dark)] hover:bg-[var(--surface)]"
        >
          <SparkIcon size={13} /> Deteksi ruangan otomatis
        </button>
      </div>

      {areas.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--border)] p-6 text-center text-sm italic text-[var(--text-secondary)]">
          Belum ada area. Tambah area pertama di bawah untuk mengaktifkan matrix area × gate.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-[var(--border)]">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-[var(--foreground)] text-[var(--text-inverse)]">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Kode</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Nama</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Lantai</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide">Jenis</th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">Luas m²</th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">Urutan</th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {areas.map((a) =>
                editingId === a.id ? (
                  <AreaEditRow
                    key={a.id}
                    area={a}
                    pending={pending}
                    onCancel={cancelEdit}
                    onSave={(draft) => saveEdit(a, draft)}
                  />
                ) : (
                  <tr key={a.id} className="bg-[var(--surface)] hover:bg-[var(--surface-alt)]">
                    <td className="px-3 py-2 font-mono text-[12px] font-medium text-[var(--foreground)]">
                      {a.area_code}
                    </td>
                    <td className="px-3 py-2 font-medium text-[var(--foreground)]">
                      {a.area_name}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">
                      {a.floor ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">
                      {fmtAreaType(a.area_type)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {fmtSqm(a.area_sqm)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--text-muted)]">
                      {a.sort_order}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(a.id)}
                          disabled={pending}
                          aria-label={`Edit ${a.area_name}`}
                          className="rounded border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-alt)] disabled:opacity-50"
                        >
                          edit
                        </button>
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => remove(a)}
                            disabled={pending}
                            aria-label={`Hapus ${a.area_name} dari proyek`}
                            className="rounded border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--flag-critical)] hover:bg-[var(--flag-critical-bg)] disabled:opacity-50"
                          >
                            hapus
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          {error ? (
            <div className="border-t border-[var(--border)] bg-[var(--flag-critical-bg)] px-3 py-2 text-xs text-[var(--flag-critical)]">
              {error}
            </div>
          ) : null}
        </div>
      )}

      <AddAreaForm
        projectId={projectId}
        projectCode={projectCode}
      />

      {setupOpen ? (
        <AreaSetup
          projectId={projectId}
          projectCode={projectCode}
          onClose={() => setSetupOpen(false)}
          onApplied={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Edit row (inline)

type AreaDraft = {
  areaCode:  string;
  areaName:  string;
  floor:     string;
  areaType:  AreaTypeValue;
  areaSqm:   string;
  sortOrder: string;
};

function AreaEditRow({
  area,
  pending,
  onCancel,
  onSave,
}: {
  area: Area;
  pending: boolean;
  onCancel: () => void;
  onSave: (draft: AreaDraft) => void;
}) {
  const [draft, setDraft] = useState<AreaDraft>({
    areaCode:  area.area_code,
    areaName:  area.area_name,
    floor:     area.floor ?? "",
    areaType:  (area.area_type ?? "general") as AreaTypeValue,
    areaSqm:   area.area_sqm == null ? "" : String(area.area_sqm),
    sortOrder: String(area.sort_order),
  });

  function update<K extends keyof AreaDraft>(k: K, v: AreaDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  return (
    <tr className="bg-[var(--surface-alt)]">
      <td className="px-2 py-1.5">
        <input
          value={draft.areaCode}
          onChange={(e) => update("areaCode", e.target.value)}
          disabled={pending}
          className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-[12px] text-[var(--foreground)]"
          aria-label="Kode area"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          value={draft.areaName}
          onChange={(e) => update("areaName", e.target.value)}
          disabled={pending}
          className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--foreground)]"
          aria-label="Nama area"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          value={draft.floor}
          onChange={(e) => update("floor", e.target.value)}
          disabled={pending}
          placeholder="Lt. 1"
          className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--foreground)]"
          aria-label="Lantai"
        />
      </td>
      <td className="px-2 py-1.5">
        <select
          value={draft.areaType}
          onChange={(e) => update("areaType", e.target.value as AreaTypeValue)}
          disabled={pending}
          className="select-brand w-full"
          aria-label="Jenis area"
        >
          {AREA_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={draft.areaSqm}
          onChange={(e) => update("areaSqm", e.target.value)}
          disabled={pending}
          placeholder="—"
          className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-right text-sm tabular-nums text-[var(--foreground)]"
          aria-label="Luas m²"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          inputMode="numeric"
          step="1"
          min="0"
          value={draft.sortOrder}
          onChange={(e) => update("sortOrder", e.target.value)}
          disabled={pending}
          className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-right text-sm tabular-nums text-[var(--foreground)]"
          aria-label="Urutan"
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <div className="inline-flex gap-1">
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={pending || !draft.areaCode.trim() || !draft.areaName.trim()}
            className="rounded bg-[var(--foreground)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)] disabled:bg-[var(--text-muted)]"
          >
            {pending ? "…" : "Simpan"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50"
          >
            Batal
          </button>
        </div>
      </td>
    </tr>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Add form (matches AddProjectMemberForm style)

function AddAreaForm({
  projectId,
  projectCode,
}: {
  projectId: string;
  projectCode: string;
}) {
  const formId = useId();
  const [areaCode, setAreaCode] = useState("");
  const [areaName, setAreaName] = useState("");
  const [floor,    setFloor]    = useState("");
  const [areaType, setAreaType] = useState<AreaTypeValue>("general");
  const [areaSqm,  setAreaSqm]  = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [success,  setSuccess]  = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("projectCode", projectCode);
    fd.set("areaCode", areaCode.trim());
    fd.set("areaName", areaName.trim());
    if (floor.trim()) fd.set("floor", floor.trim());
    fd.set("areaType", areaType);
    if (areaSqm.trim()) fd.set("areaSqm", areaSqm.trim());
    startTransition(async () => {
      const res = await createArea(fd);
      if (res.ok) {
        setSuccess(`Area "${areaCode}" ditambahkan.`);
        setAreaCode("");
        setAreaName("");
        setFloor("");
        setAreaSqm("");
        // keep areaType — frequently same as last for runs of similar areas
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1.5fr_0.7fr_1fr_0.7fr_auto] lg:items-end"
    >
      <div>
        <label
          htmlFor={`${formId}-code`}
          className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]"
        >
          Kode area
        </label>
        <input
          id={`${formId}-code`}
          value={areaCode}
          onChange={(e) => setAreaCode(e.target.value)}
          disabled={pending}
          placeholder="LIVING-LT1"
          required
          className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 font-mono text-[12px] text-[var(--foreground)]"
        />
      </div>
      <div>
        <label
          htmlFor={`${formId}-name`}
          className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]"
        >
          Nama area
        </label>
        <input
          id={`${formId}-name`}
          value={areaName}
          onChange={(e) => setAreaName(e.target.value)}
          disabled={pending}
          placeholder="Living Lt.1"
          required
          className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm text-[var(--foreground)]"
        />
      </div>
      <div>
        <label
          htmlFor={`${formId}-floor`}
          className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]"
        >
          Lantai
        </label>
        <input
          id={`${formId}-floor`}
          value={floor}
          onChange={(e) => setFloor(e.target.value)}
          disabled={pending}
          placeholder="Lt. 1"
          className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm text-[var(--foreground)]"
        />
      </div>
      <div>
        <label
          htmlFor={`${formId}-type`}
          className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]"
        >
          Jenis
        </label>
        <select
          id={`${formId}-type`}
          value={areaType}
          onChange={(e) => setAreaType(e.target.value as AreaTypeValue)}
          disabled={pending}
          className="select-brand w-full"
        >
          {AREA_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label
          htmlFor={`${formId}-sqm`}
          className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--sand-dark)]"
        >
          Luas m²
        </label>
        <input
          id={`${formId}-sqm`}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={areaSqm}
          onChange={(e) => setAreaSqm(e.target.value)}
          disabled={pending}
          placeholder="—"
          className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-right text-sm tabular-nums text-[var(--foreground)]"
        />
      </div>
      <div>
        <button
          type="submit"
          disabled={pending || !areaCode.trim() || !areaName.trim()}
          className="w-full rounded bg-[var(--foreground)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-dark)] disabled:bg-[var(--text-muted)]"
        >
          {pending ? "Menambah…" : "Tambah area"}
        </button>
      </div>
      {error ? (
        <div className="rounded border border-[var(--flag-critical)] bg-[var(--flag-critical-bg)] px-3 py-2 text-xs text-[var(--flag-critical)] sm:col-span-2 lg:col-span-6">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded border border-[var(--flag-ok)] bg-[var(--flag-ok-bg)] px-3 py-2 text-xs text-[var(--flag-ok)] sm:col-span-2 lg:col-span-6">
          {success}
        </div>
      ) : null}
    </form>
  );
}
