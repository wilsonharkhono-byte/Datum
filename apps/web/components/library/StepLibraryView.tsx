"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateStandardStep, setStandardStepActive, reorderStandardSteps } from "@/lib/library/actions";
import type { StandardLibraryGate, StandardStep } from "@/lib/library/queries";
import { AddStandardStepForm } from "./AddStandardStepForm";

export const ROOM_TYPES: { value: string; label: string }[] = [
  { value: "bathroom", label: "Kamar mandi" }, { value: "kitchen", label: "Dapur" },
  { value: "bedroom", label: "Kamar tidur" }, { value: "living", label: "Ruang keluarga" },
  { value: "dining", label: "Ruang makan" }, { value: "garden", label: "Taman" },
  { value: "circulation", label: "Sirkulasi" }, { value: "utility", label: "Servis" },
  { value: "general", label: "Umum" },
];
const TYPE_OPTIONS: { value: StandardStep["step_type"]; label: string }[] = [
  { value: "site_work", label: "Pekerjaan" }, { value: "decision", label: "Keputusan" },
  { value: "procurement", label: "Pengadaan" }, { value: "inspection", label: "Inspeksi" },
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.value, t.label]));

function StepEditor({ step, onDone }: { step: StandardStep; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(step.name);
  const [stepType, setStepType] = useState(step.step_type);
  const [trade, setTrade] = useState(step.trade_role ?? "");
  const [dur, setDur] = useState(String(step.typical_duration_days));
  const [lead, setLead] = useState(String(step.lead_time_days));
  const [rooms, setRooms] = useState<string[]>(step.applies_to_area_types ?? []);

  function toggleRoom(v: string) {
    setRooms((r) => (r.includes(v) ? r.filter((x) => x !== v) : [...r, v]));
  }
  function save() {
    setError(null);
    startTransition(async () => {
      const r = await updateStandardStep({
        code: step.code, name: name.trim(),
        stepType: stepType as "decision" | "procurement" | "site_work" | "inspection",
        tradeRole: trade.trim() || null,
        typicalDurationDays: Number(dur) || 0, leadTimeDays: Number(lead) || 0,
        appliesToAreaTypes: rooms.length ? rooms : null,
        applicability: step.applicability, // pass through unchanged — don't wipe finish-profile conditions
      });
      if (r.ok) { onDone(); router.refresh(); } else setError(r.error);
    });
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-3 text-[12px]">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input value={name} disabled={pending} onChange={(e) => setName(e.target.value)} placeholder="Nama langkah"
          className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" />
        <select value={stepType} disabled={pending} onChange={(e) => setStepType(e.target.value)}
          className="select-brand-sm min-h-11 md:min-h-0">
          {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input value={trade} disabled={pending} onChange={(e) => setTrade(e.target.value)} placeholder="Tukang (mis. tukang_marmer)"
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" />
        <label className="flex items-center gap-1">Durasi
          <input value={dur} disabled={pending} inputMode="numeric" onChange={(e) => setDur(e.target.value.replace(/[^0-9]/g, ""))}
            className="min-h-11 w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" /></label>
        <label className="flex items-center gap-1">Lead
          <input value={lead} disabled={pending} inputMode="numeric" onChange={(e) => setLead(e.target.value.replace(/[^0-9]/g, ""))}
            className="min-h-11 w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" /></label>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ROOM_TYPES.map((rt) => (
          <button key={rt.value} type="button" disabled={pending} onClick={() => toggleRoom(rt.value)}
            className={`min-h-11 rounded border px-2 py-0.5 text-[11px] md:min-h-0 ${rooms.includes(rt.value) ? "border-[var(--sand-dark)] bg-[var(--surface)] text-[var(--foreground)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
            {rt.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">Kosongkan ruangan = berlaku untuk semua tipe ruangan.</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={pending || !name.trim()} onClick={save}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">Simpan</button>
        <button type="button" disabled={pending} onClick={onDone}
          className="min-h-11 text-[var(--text-muted)] disabled:opacity-50 md:min-h-0">Batal</button>
        {error ? <span className="text-[11px] text-[var(--flag-critical)]">{error}</span> : null}
      </div>
    </div>
  );
}

function GateSection({ g }: { g: StandardLibraryGate }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => { const r = await fn(); if (r.ok) router.refresh(); else setError(r.error); });
  }
  function move(idx: number, dir: -1 | 1) {
    const codes = g.active.map((s) => s.code);
    const j = idx + dir;
    if (j < 0 || j >= codes.length) return;
    [codes[idx], codes[j]] = [codes[j]!, codes[idx]!];
    run(() => reorderStandardSteps({ gateCode: g.gate, codes }));
  }

  return (
    <details className="rounded border border-[var(--border)] bg-[var(--surface)]" open>
      <summary className="min-h-11 cursor-pointer px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--foreground)] md:min-h-0">
        {g.gate} · {g.gateName} <span className="text-[var(--text-muted)]">({g.active.length})</span>
      </summary>
      {error ? <p className="border-t border-[var(--border)] px-4 py-1.5 text-[11px] text-[var(--flag-critical)]">{error}</p> : null}
      {g.active.map((s, i) => (
        <div key={s.code}>
          <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2 text-[13px]">
            <div className="flex flex-col gap-0.5">
              <button type="button" aria-label="Naikkan" disabled={pending || i === 0} onClick={() => move(i, -1)} className="flex min-h-11 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 text-[10px] leading-none text-[var(--sand-dark)] disabled:opacity-30 md:min-h-6">▲</button>
              <button type="button" aria-label="Turunkan" disabled={pending || i === g.active.length - 1} onClick={() => move(i, 1)} className="flex min-h-11 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 text-[10px] leading-none text-[var(--sand-dark)] disabled:opacity-30 md:min-h-6">▼</button>
            </div>
            <span className="rounded bg-[var(--sand-tint)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">{TYPE_LABEL[s.step_type] ?? s.step_type}</span>
            <span className="flex-1 text-[var(--foreground)]">{s.name}</span>
            <span className="text-[10px] text-[var(--text-muted)]">Durasi {s.typical_duration_days}h · Lead {s.lead_time_days}h</span>
            <button type="button" onClick={() => setEditing(editing === s.code ? null : s.code)}
              className="min-h-11 rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sand-dark)] md:min-h-0">Ubah</button>
            <button type="button" disabled={pending} onClick={() => run(() => setStandardStepActive({ code: s.code, active: false }))}
              className="min-h-11 text-[11px] text-[var(--text-muted)] hover:text-[var(--flag-critical)] disabled:opacity-50 md:min-h-0">Nonaktifkan</button>
          </div>
          {editing === s.code ? <StepEditor step={s} onDone={() => setEditing(null)} /> : null}
        </div>
      ))}
      <AddStandardStepForm gateCode={g.gate} />
      {g.inactive.length > 0 ? (
        <div className="border-t border-[var(--border)]">
          <button type="button" onClick={() => setShowInactive((v) => !v)}
            className="min-h-11 w-full px-4 py-2 text-left text-[11px] text-[var(--text-muted)] md:min-h-0">
            Nonaktif ({g.inactive.length}) {showInactive ? "▾" : "▸"}
          </button>
          {showInactive ? g.inactive.map((s) => (
            <div key={s.code} className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2 text-[12px] text-[var(--text-muted)]">
              <span className="flex-1 line-through">{s.name}</span>
              <button type="button" disabled={pending} onClick={() => run(() => setStandardStepActive({ code: s.code, active: true }))}
                className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">Aktifkan</button>
            </div>
          )) : null}
        </div>
      ) : null}
    </details>
  );
}

export function StepLibraryView({ library }: { library: StandardLibraryGate[] }) {
  // "Empty" = no gates at all, or every gate has zero steps (active + inactive).
  // The per-gate AddStandardStepForm still renders below so the pustaka can be
  // seeded — the notice just explains the blank slate.
  const isEmpty = library.length === 0 || library.every((g) => g.active.length === 0 && g.inactive.length === 0);
  return (
    <div className="flex flex-col gap-3">
      {isEmpty ? (
        <div className="rounded border border-dashed border-[var(--border)] p-6 text-center text-sm italic text-[var(--text-secondary)]">
          Belum ada langkah di pustaka. Tambahkan langkah standar di bawah.
        </div>
      ) : null}
      {library.map((g) => <GateSection key={g.gate} g={g} />)}
    </div>
  );
}
