"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StepDetail } from "@/components/schedule/StepDetail";
import { AddStepForm } from "@/components/schedule/AddStepForm";
import { restoreStep } from "@/lib/steps/actions";
import { truncateNames } from "@/lib/steps/flags";
import type { getRoomStepView, AreaStepEventRow } from "@/lib/steps/queries";

type View = Awaited<ReturnType<typeof getRoomStepView>>;
type StepEvents = Map<string, AreaStepEventRow[]>;
const CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Belum mulai", cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" },
  in_progress: { label: "Berjalan", cls: "bg-blue-100 text-blue-800" },
  blocked: { label: "Terblokir", cls: "bg-red-100 text-red-800" },
  stalled: { label: "Mandek", cls: "bg-red-100 text-red-800" },
  accepted: { label: "Selesai", cls: "bg-green-100 text-green-800" },
  done_with_defects: { label: "Selesai (ada defect)", cls: "bg-amber-100 text-amber-800" },
};

export function RoomStepsPanel({
  areaId,
  view,
  stepEvents,
  autoOpenStepId,
}: {
  areaId: string;
  view: View;
  stepEvents?: StepEvents;
  /** Step id to auto-open on mount (from a ?areaStep= deep link — see rooms/page.tsx). */
  autoOpenStepId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Start in the "all steps" view when deep-linking to a specific step — the target
  // may not be in `view.active` (e.g. an unconfirmed block that's still "in_progress"
  // with a note rather than a real `blocked` status), so only the grouped/full list
  // is guaranteed to render every step regardless of status.
  const [showAll, setShowAll] = useState(autoOpenStepId != null);
  const [openStep, setOpenStep] = useState<string | null>(autoOpenStepId ?? null);
  const [showRemoved, setShowRemoved] = useState(false);
  const nameOf = (code: string | null) => view.steps.find((s) => s.step_code === code)?.name ?? code;

  function restore(areaStepId: string) {
    startTransition(async () => { const r = await restoreStep({ areaStepId }); if (r.ok) router.refresh(); });
  }

  function StepRow({ s }: { s: View["steps"][number] }) {
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
          {view.flags.readyToStart === s.step_code ? <span className="text-[10px] text-[var(--sand-dark)]">siap</span> : null}
          <span className="text-[var(--text-muted)]">{isOpen ? "▾" : "▸"}</span>
        </button>
        {isOpen ? <StepDetail step={s} events={stepEvents?.get(s.id)} /> : null}
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border)]">
      {view.flags.readyToStart || view.flags.needsDecision.length > 0 ? (
        <div className="bg-[var(--sand-tint)] px-4 py-2 text-[11px] text-[var(--sand-dark)]">
          {view.flags.readyToStart ? <span className="mr-3">Siap dimulai: {nameOf(view.flags.readyToStart)}</span> : null}
          {view.flags.needsDecision.length > 0 ? (
            <span>
              Perlu keputusan: {truncateNames(view.flags.needsDecision.map((code) => nameOf(code) ?? code))}
            </span>
          ) : null}
        </div>
      ) : null}

      {!showAll ? (
        <>
          {view.active.length > 0
            ? view.active.map((s) => <StepRow key={s.id} s={s} />)
            : <p className="border-t border-[var(--border)] px-4 py-3 text-[12px] text-[var(--text-muted)]">Tidak ada langkah aktif.</p>}
          <button type="button" onClick={() => setShowAll(true)}
            className="min-h-11 w-full border-t border-[var(--border)] px-4 py-2.5 text-left text-[12px] font-semibold text-[var(--sand-dark)] hover:bg-[var(--sand-tint)] md:min-h-0">
            Lihat semua langkah ({view.steps.length})
          </button>
        </>
      ) : (
        <>
          {view.grouped.map((g) => (
            <details key={g.gate} className="border-t border-[var(--border)]" open={g.steps.some((s) => view.active.some((a) => a.id === s.id))}>
              <summary className="min-h-11 cursor-pointer px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] md:min-h-0">
                {g.gate} · {g.gateName} — {g.done}/{g.steps.length}
              </summary>
              {g.steps.map((s) => <StepRow key={s.id} s={s} />)}
            </details>
          ))}
          <AddStepForm areaId={areaId} addableCatalog={view.addableCatalog} />
          {view.removedSteps.length > 0 ? (
            <div className="border-t border-[var(--border)]">
              <button type="button" onClick={() => setShowRemoved((v) => !v)}
                className="min-h-11 w-full px-4 py-2.5 text-left text-[11px] text-[var(--text-muted)] md:min-h-0">
                Langkah dihapus ({view.removedSteps.length}) <span>{showRemoved ? "▾" : "▸"}</span>
              </button>
              {showRemoved ? view.removedSteps.map((r) => (
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
          <button type="button" onClick={() => setShowAll(false)}
            className="min-h-11 w-full border-t border-[var(--border)] px-4 py-2.5 text-left text-[11px] text-[var(--text-muted)] md:min-h-0">
            ▴ Tampilkan ringkas
          </button>
        </>
      )}
    </div>
  );
}
