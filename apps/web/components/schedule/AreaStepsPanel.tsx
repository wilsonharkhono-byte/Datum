"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StepDetail } from "@/components/schedule/StepDetail";
import { AddStepForm } from "@/components/schedule/AddStepForm";
import { restoreStep } from "@/lib/steps/actions";
import type { AreaStepRow, CatalogStep, RemovedStep, AreaStepEventRow } from "@/lib/steps/queries";
import type { AreaFlags } from "@/lib/steps/flags";

const CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Belum mulai", cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" },
  in_progress: { label: "Berjalan", cls: "bg-blue-100 text-blue-800" },
  blocked: { label: "Terblokir", cls: "bg-red-100 text-red-800" },
  stalled: { label: "Mandek", cls: "bg-red-100 text-red-800" },
  accepted: { label: "Selesai", cls: "bg-green-100 text-green-800" },
  done_with_defects: { label: "Selesai (ada defect)", cls: "bg-amber-100 text-amber-800" },
};

export function AreaStepsPanel({ areaId, areaName, steps, flags, addableCatalog, removedSteps, stepEventsMap }: {
  areaId: string;
  areaName: string;
  steps: AreaStepRow[];
  flags: AreaFlags;
  addableCatalog: CatalogStep[];
  removedSteps: RemovedStep[];
  stepEventsMap?: Map<string, AreaStepEventRow[]>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const done = steps.filter((s) => s.status === "accepted" || s.status === "done_with_defects").length;
  const nameOf = (code: string | null) => steps.find((s) => s.step_code === code)?.name ?? code;

  function restore(areaStepId: string) {
    startTransition(async () => {
      const res = await restoreStep({ areaStepId });
      if (res.ok) router.refresh();
    });
  }

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
                {isOpen ? <StepDetail step={s} events={stepEventsMap?.get(s.id) ?? []} /> : null}
              </div>
            );
          })}

          <AddStepForm areaId={areaId} addableCatalog={addableCatalog} />

          {removedSteps.length > 0 ? (
            <div className="border-t border-[var(--border)]">
              <button type="button" onClick={() => setShowRemoved((v) => !v)}
                className="min-h-11 w-full px-4 py-2.5 text-left text-[11px] text-[var(--text-muted)] md:min-h-0">
                Langkah dihapus ({removedSteps.length}) <span>{showRemoved ? "▾" : "▸"}</span>
              </button>
              {showRemoved ? removedSteps.map((r) => (
                <div key={r.id} className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2 text-[12px] text-[var(--text-muted)]">
                  <span className="flex-1 line-through">{r.name}</span>
                  <button type="button" disabled={pending} onClick={() => restore(r.id)}
                    className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
                    Pulihkan
                  </button>
                </div>
              )) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
