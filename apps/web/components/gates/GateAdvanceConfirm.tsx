"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  getGateCheckpoints,
  markGatePassed,
  type GateCheckpoint,
} from "@/lib/gates/advance";
import { gateShortName } from "@/lib/gates/labels";
import { CheckIcon, XIcon, ClipboardIcon } from "@/components/icons/Icon";

export type GateAdvanceTarget = {
  projectId: string;
  areaId: string;
  areaName: string;
  gateCode: string;
};

/** Today as YYYY-MM-DD in the local timezone (for the date input default). */
function todayIso(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/**
 * The advisor row's inline affordance: a "Tandai selesai" button that opens
 * the confirm sheet. Client island — the surrounding feed row stays server-
 * rendered. Self-contained so AdvisorFeed (a server component) can drop it in.
 */
export function GateAdvanceConfirmAction({ target }: { target: GateAdvanceTarget }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-[var(--flag-ok-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--flag-ok)]">
        <CheckIcon size={11} /> Ditandai selesai
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Tandai Gate ${target.gateCode} ${target.areaName} selesai`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded border border-[var(--sand)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--sand-dark)] hover:border-[var(--sand-dark)] hover:bg-[var(--sand-tint)]"
      >
        <CheckIcon size={12} /> Tandai selesai
      </button>
      {open ? (
        <GateAdvanceConfirm
          target={target}
          onClose={() => setOpen(false)}
          onConfirmed={() => {
            setDone(true);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The confirm sheet itself. Bottom sheet on mobile, centered card on md+.
 * Shows the gate + area, the (skippable) Lampiran-A reminder checklist, an
 * optional completed-date, and the primary confirm button.
 */
export function GateAdvanceConfirm({
  target,
  onClose,
  onConfirmed,
}: {
  target: GateAdvanceTarget;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [checkpoints, setCheckpoints] = useState<GateCheckpoint[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [completedDate, setCompletedDate] = useState<string>(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Lazy-load the reminder checklist when the sheet opens.
  useEffect(() => {
    let alive = true;
    getGateCheckpoints(target.gateCode)
      .then((items) => {
        if (alive) setCheckpoints(items);
      })
      .catch(() => {
        if (alive) setCheckpoints([]); // checklist is optional — fail open
      });
    return () => {
      alive = false;
    };
  }, [target.gateCode]);

  // Esc closes; focus the close button on open for keyboard users.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await markGatePassed({
        projectId: target.projectId,
        areaId: target.areaId,
        gateCode: target.gateCode as never,
        completedDate,
        checkedTemplateIds: checked.size > 0 ? [...checked] : undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onConfirmed();
    });
  }

  const tickedCount = checked.size;
  const totalCount = checkpoints?.length ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Konfirmasi Gate ${target.gateCode} ${target.areaName} selesai`}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      {/* Scrim */}
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <div className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_-8px_30px_-12px_rgba(20,18,16,0.4)] sm:max-w-md sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--sand-tint)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sand-dark)]">
              Tandai gate selesai
            </p>
            <h2 className="mt-0.5 truncate text-sm font-semibold text-foreground">
              Gate {target.gateCode} · {target.areaName}
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
              {gateShortName(target.gateCode)}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--surface)]"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Body (scrolls) */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-3 flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <ClipboardIcon size={13} />
            <span>
              Pengingat QA (Lampiran A) — opsional, boleh dilewati.
              {totalCount > 0 ? ` ${tickedCount}/${totalCount} dicentang.` : ""}
            </span>
          </div>

          {checkpoints == null ? (
            <p className="py-4 text-center text-[11px] italic text-[var(--text-muted)]">
              Memuat daftar periksa…
            </p>
          ) : checkpoints.length === 0 ? (
            <p className="rounded border border-dashed border-[var(--border)] px-3 py-3 text-[11px] italic text-[var(--text-muted)]">
              Tidak ada item periksa untuk gate ini. Lanjut konfirmasi saja.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {checkpoints.map((cp) => {
                const on = checked.has(cp.id);
                return (
                  <li key={cp.id}>
                    <button
                      type="button"
                      onClick={() => toggle(cp.id)}
                      aria-pressed={on}
                      className={`flex min-h-11 w-full items-start gap-2.5 rounded border px-3 py-2 text-left text-xs transition-colors ${
                        on
                          ? "border-[var(--flag-ok)] bg-[var(--flag-ok-bg)]"
                          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--sand-dark)]"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                          on
                            ? "border-[var(--flag-ok)] bg-[var(--flag-ok)] text-[var(--text-inverse)]"
                            : "border-[var(--sand-dark)] bg-[var(--surface)]"
                        }`}
                      >
                        {on ? <CheckIcon size={11} /> : null}
                      </span>
                      <span className="min-w-0 flex-1 text-foreground">
                        {cp.itemText}
                        {cp.required ? (
                          <span className="ml-1 text-[10px] font-semibold uppercase text-[var(--sand-dark)]">
                            · wajib
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Completed date */}
          <label className="mt-4 block">
            <span className="mb-1 block text-[11px] font-semibold text-[var(--text-secondary)]">
              Tanggal selesai
            </span>
            <input
              type="date"
              value={completedDate}
              max={todayIso()}
              onChange={(e) => setCompletedDate(e.target.value)}
              className="min-h-11 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-foreground focus:border-[var(--sand-dark)] focus:outline-none"
            />
          </label>

          {error ? (
            <p className="mt-3 rounded border border-[var(--flag-critical)]/40 bg-[var(--flag-critical-bg)] px-3 py-2 text-[11px] text-[var(--flag-critical)]">
              {error}
            </p>
          ) : null}
        </div>

        {/* Footer actions (sticky) */}
        <div className="flex gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded bg-foreground px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-inverse)] shadow-[0_2px_6px_-1px_rgba(122,107,86,0.4)] hover:bg-[var(--sand-dark)] disabled:opacity-60"
          >
            <CheckIcon size={13} />
            {pending ? "Menyimpan…" : "Tandai selesai"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--text-secondary)] disabled:opacity-60"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  );
}
