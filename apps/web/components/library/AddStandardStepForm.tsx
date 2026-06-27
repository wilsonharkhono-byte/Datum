"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addStandardStep } from "@/lib/library/actions";
import { ROOM_TYPES } from "./StepLibraryView";

type StepType = "decision" | "procurement" | "site_work" | "inspection";
const TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: "site_work", label: "Pekerjaan" }, { value: "decision", label: "Keputusan" },
  { value: "procurement", label: "Pengadaan" }, { value: "inspection", label: "Inspeksi" },
];

export function AddStandardStepForm({ gateCode }: { gateCode: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [stepType, setStepType] = useState<StepType>("site_work");
  const [trade, setTrade] = useState("");
  const [dur, setDur] = useState("1");
  const [lead, setLead] = useState("0");
  const [rooms, setRooms] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reset() { setName(""); setTrade(""); setDur("1"); setLead("0"); setRooms([]); setStepType("site_work"); setError(null); }
  function add() {
    setError(null);
    startTransition(async () => {
      const r = await addStandardStep({
        gateCode, name: name.trim(), stepType, tradeRole: trade.trim() || null,
        typicalDurationDays: Number(dur) || 0, leadTimeDays: Number(lead) || 0,
        appliesToAreaTypes: rooms.length ? rooms : null,
      });
      if (r.ok) { reset(); setOpen(false); router.refresh(); } else setError(r.error);
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="min-h-11 w-full border-t border-[var(--border)] px-4 py-2 text-left text-[12px] font-semibold text-[var(--sand-dark)] hover:bg-[var(--sand-tint)] md:min-h-0">
        + Tambah langkah standar
      </button>
    );
  }
  return (
    <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-3 text-[12px]">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input value={name} disabled={pending} onChange={(e) => setName(e.target.value)} placeholder="Nama langkah baru"
          className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" />
        <select value={stepType} disabled={pending} onChange={(e) => setStepType(e.target.value as StepType)}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0">
          {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input value={trade} disabled={pending} onChange={(e) => setTrade(e.target.value)} placeholder="Trade"
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
          <button key={rt.value} type="button" disabled={pending}
            onClick={() => setRooms((r) => (r.includes(rt.value) ? r.filter((x) => x !== rt.value) : [...r, rt.value]))}
            className={`min-h-11 rounded border px-2 py-0.5 text-[11px] md:min-h-0 ${rooms.includes(rt.value) ? "border-[var(--sand-dark)] bg-[var(--surface)] text-[var(--foreground)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
            {rt.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">Kosongkan ruangan = berlaku untuk semua tipe ruangan.</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={pending || !name.trim()} onClick={add}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">Tambah</button>
        <button type="button" disabled={pending} onClick={() => { reset(); setOpen(false); }}
          className="min-h-11 text-[var(--text-muted)] disabled:opacity-50 md:min-h-0">Batal</button>
        {error ? <span className="text-[11px] text-[var(--flag-critical)]">{error}</span> : null}
      </div>
    </div>
  );
}
