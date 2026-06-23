"use client";

import { useState } from "react";
import { StepDetail } from "@/components/schedule/StepDetail";
import type { AreaStepRow } from "@/lib/steps/queries";
import type { AreaFlags } from "@/lib/steps/flags";

const CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Belum mulai", cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" },
  in_progress: { label: "Berjalan", cls: "bg-blue-100 text-blue-800" },
  blocked: { label: "Terblokir", cls: "bg-red-100 text-red-800" },
  stalled: { label: "Mandek", cls: "bg-red-100 text-red-800" },
  accepted: { label: "Selesai", cls: "bg-green-100 text-green-800" },
  done_with_defects: { label: "Selesai (ada defect)", cls: "bg-amber-100 text-amber-800" },
};

export function AreaStepsPanel({ areaName, steps, flags }: { areaName: string; steps: AreaStepRow[]; flags: AreaFlags }) {
  const [open, setOpen] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const done = steps.filter((s) => s.status === "accepted" || s.status === "done_with_defects").length;
  const nameOf = (code: string | null) => steps.find((s) => s.step_code === code)?.name ?? code;

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface)]">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--foreground)]">{areaName}</div>
          <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{done}/{steps.length} selesai</div>
        </div>
        <span className="text-[var(--text-muted)]">{open ? "▾" : "▸"}</span>
      </button>

      {flags.readyToStart || flags.needsDecision.length > 0 ? (
        <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-2 text-[11px] text-[var(--sand-dark)]">
          {flags.readyToStart ? <span className="mr-3">Siap dimulai: {nameOf(flags.readyToStart)}</span> : null}
          {flags.needsDecision.length > 0 ? <span>Perlu keputusan: {flags.needsDecision.map(nameOf).join(", ")}</span> : null}
        </div>
      ) : null}

      {open ? (
        <div className="border-t border-[var(--border)]">
          {steps.map((s) => {
            const chip = (CHIP[s.status] || CHIP.not_started)!;
            const isOpen = openStep === s.id;
            const dimmed = s.status === "accepted" || s.status === "done_with_defects";
            return (
              <div key={s.id}>
                <button type="button" onClick={() => setOpenStep(isOpen ? null : s.id)}
                  className={`flex w-full items-center gap-2.5 border-t border-[var(--border)] px-4 py-2.5 text-left ${dimmed ? "opacity-60" : ""}`}>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip.cls}`}>{chip.label}</span>
                  <span className="text-[13px] text-[var(--foreground)]">{s.name}</span>
                  <span className="flex-1" />
                  {flags.readyToStart === s.step_code ? <span className="text-[10px] text-[var(--sand-dark)]">siap</span> : null}
                  <span className="text-[var(--text-muted)]">{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen ? <StepDetail step={s} /> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
