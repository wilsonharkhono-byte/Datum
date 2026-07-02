"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitStepUpdate, submitCheckpointResult, removeStep } from "@/lib/steps/actions";
import type { AreaStepRow, AreaStepEventRow } from "@/lib/steps/queries";

const STATUS_LABEL: Record<string, string> = {
  not_started: "Belum mulai",
  in_progress: "Berjalan",
  blocked: "Terblokir",
  done: "Selesai",
};

const EVENT_CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Belum mulai", cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" },
  in_progress:  { label: "Berjalan",   cls: "bg-blue-100 text-blue-800" },
  blocked:      { label: "Terblokir",  cls: "bg-red-100 text-red-800" },
  done:         { label: "Selesai",    cls: "bg-green-100 text-green-800" },
};

const HISTORY_PREVIEW = 5;

function formatEventTime(isoString: string): string {
  return new Date(isoString).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

/** Pure: "Asisten AI" for AI-authored events with no human author; otherwise the human's name (may be null). */
export function eventAuthorLabel(ev: Pick<AreaStepEventRow, "source" | "author_name">): string | null {
  if (ev.source === "ai") return ev.author_name ?? "Asisten AI";
  return ev.author_name;
}

/** Pure: confidence 0–1 → fixed 2-decimal display string (e.g. 0.947 -> "0.95"), null when absent. */
export function confidenceLabel(confidence: number | null): string | null {
  if (confidence === null) return null;
  return confidence.toFixed(2);
}

/** Pure: href for "dari kartu →", null when there's no resolvable card link. */
export function cardLinkHref(cardLink: AreaStepEventRow["card_link"]): string | null {
  if (!cardLink) return null;
  return `/project/${cardLink.projectCode}/cards/${cardLink.cardSlug}`;
}

function StepHistory({
  events,
  pending,
  onBenar,
  onKoreksi,
}: {
  events: AreaStepEventRow[];
  pending: boolean;
  onBenar: (ev: AreaStepEventRow) => void;
  onKoreksi: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? events : events.slice(0, HISTORY_PREVIEW);
  const hasMore = events.length > HISTORY_PREVIEW;

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Riwayat update
      </p>
      {events.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">Belum ada update.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {shown.map((ev) => {
              const chip = EVENT_CHIP[ev.status] ?? EVENT_CHIP.not_started!;
              const isAi = ev.source === "ai";
              const author = eventAuthorLabel(ev);
              const confidence = confidenceLabel(ev.confidence);
              const href = cardLinkHref(ev.card_link);
              return (
                <li key={ev.id} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip.cls}`}>
                      {chip.label}
                    </span>
                    {isAi ? (
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                        AI
                      </span>
                    ) : null}
                    {ev.percent_complete !== null ? (
                      <span className="text-[10px] text-[var(--text-muted)]">{ev.percent_complete}%</span>
                    ) : null}
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {formatEventTime(ev.occurred_at)}
                    </span>
                    {author ? (
                      <span className="text-[10px] text-[var(--text-muted)]">· {author}</span>
                    ) : null}
                    {confidence ? (
                      <span className="text-[10px] text-[var(--text-muted)]">· {confidence}</span>
                    ) : null}
                    {href ? (
                      <Link href={href} className="text-[10px] text-[var(--sand-dark)] underline hover:text-[var(--foreground)]">
                        dari kartu →
                      </Link>
                    ) : null}
                  </div>
                  {ev.note ? (
                    <p className="ml-1 text-[12px] text-[var(--foreground)]">{ev.note}</p>
                  ) : null}
                  {isAi ? (
                    <div className="ml-1 mt-0.5 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onBenar(ev)}
                        className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold text-green-800 hover:border-green-700 disabled:opacity-50 md:min-h-0"
                      >
                        Benar
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={onKoreksi}
                        className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--sand-dark)] hover:border-[var(--sand-dark)] disabled:opacity-50 md:min-h-0"
                      >
                        Koreksi
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {hasMore && !expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-1.5 text-[11px] text-[var(--text-muted)] underline hover:text-[var(--foreground)]"
            >
              lihat semua ({events.length})
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Pure: true when the step has an AI event newer than `nowIso` — a manual status set now would NOT outrank it. */
export function hasNewerAiEvent(events: Pick<AreaStepEventRow, "source" | "occurred_at">[], nowIso: string): boolean {
  return events.some((e) => e.source === "ai" && e.occurred_at > nowIso);
}

/**
 * Pure: the note to send when a human hits "Benar" on an AI history row.
 *
 * For a blocked AI row, the projection derives `blockingReason` from the latest
 * event's note (see lib/steps/status.ts `payload.blocked_on ?? payload.description`
 * — read here via the row's `note` field). Sending a generic "Dikonfirmasi" note
 * unconditionally would become the newest human event and overwrite that reason
 * with the confirmation text, destroying the "why" the room is blocked.
 *
 * So for blocked rows: carry the AI event's own note forward when it has one;
 * otherwise fall back to the step's current `blocking_reason` (still on the
 * step even though this event's note is empty); otherwise "Dikonfirmasi".
 * Non-blocked rows are unaffected — always "Dikonfirmasi".
 */
export function benarNote(
  ev: Pick<AreaStepEventRow, "status" | "note">,
  currentBlockingReason: string | null,
): string {
  if (ev.status === "blocked") return ev.note ?? currentBlockingReason ?? "Dikonfirmasi";
  return "Dikonfirmasi";
}

export function StepDetail({ step, events = [] }: { step: AreaStepRow; events?: AreaStepEventRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const statusButtonsRef = useRef<HTMLDivElement | null>(null);

  const overrideHint = hasNewerAiEvent(events, new Date().toISOString());

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) { setNote(""); router.refresh(); }
      else setError(res.error);
    });
  }

  function setStatus(status: "not_started" | "in_progress" | "blocked" | "done") {
    if (status === "blocked") {
      const reason = window.prompt("Alasan terblokir?") ?? "";
      if (!reason.trim()) return;
      run(() => submitStepUpdate({ areaStepId: step.id, status, note: reason.trim() }));
      return;
    }
    run(() => submitStepUpdate({ areaStepId: step.id, status }));
  }

  /**
   * "Benar" on an AI history row: write a human-authored confirming event with
   * the same status — cheap, locks it in via the newest-information-wins rule.
   * For a blocked row, carry the blocking reason forward (see `benarNote`)
   * instead of overwriting it with a generic confirmation note.
   */
  function confirmAiEvent(ev: AreaStepEventRow) {
    run(() =>
      submitStepUpdate({
        areaStepId: step.id,
        status: ev.status as "not_started" | "in_progress" | "blocked" | "done",
        note: benarNote(ev, step.blocking_reason),
      }),
    );
  }

  /** "Koreksi" on an AI history row: reveal the existing status buttons so the human can pick a different status. */
  function focusStatusButtons() {
    statusButtonsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function remove() {
    if (!window.confirm("Hapus langkah ini dari ruang ini? Bisa dipulihkan nanti.")) return;
    run(() => removeStep({ areaStepId: step.id }));
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-3">
      <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
        {step.planned_start ? <span>Rencana {step.planned_start} – {step.planned_end}</span> : null}
        {step.assigned_trade ? <span>· {step.assigned_trade}</span> : null}
      </div>

      <div ref={statusButtonsRef} className="mb-3 flex flex-wrap gap-1.5">
        {(["not_started", "in_progress", "blocked", "done"] as const).map((s) => (
          <button key={s} type="button" disabled={pending} onClick={() => setStatus(s)}
            className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)] hover:border-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {overrideHint ? (
        <p className="mb-3 -mt-2 text-[11px] text-[var(--sand-dark)]">
          Update AI yang lebih baru akan diabaikan
        </p>
      ) : null}

      <div className="mb-3 flex items-center gap-1.5">
        <input value={note} disabled={pending} onChange={(e) => setNote(e.target.value)}
          placeholder="Tambah update progres…"
          className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] focus:border-[var(--sand-dark)] focus:outline-none md:min-h-0" />
        <button type="button" disabled={pending || !note.trim()}
          onClick={() => run(() => submitStepUpdate({ areaStepId: step.id, note: note.trim() }))}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sand-dark)] hover:border-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
          Catat
        </button>
      </div>

      {step.checkpoints.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {step.checkpoints.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[12px] text-[var(--foreground)]">
              <input type="checkbox" checked={c.result === "pass"} disabled={pending}
                onChange={(e) => run(() => submitCheckpointResult({ checkpointId: c.id, result: e.target.checked ? "pass" : "pending" }))} />
              <span>{c.item_text}</span>
              {c.severity === "kritis" ? <span className="ml-auto rounded-sm bg-red-100 px-1 text-[9px] font-bold uppercase text-red-700">kritis</span> : null}
            </label>
          ))}
        </div>
      ) : null}

      <div className="mt-3 border-t border-[var(--border)] pt-2">
        <button type="button" disabled={pending} onClick={remove}
          className="min-h-11 text-[11px] font-semibold text-[var(--text-muted)] hover:text-red-700 disabled:opacity-50 md:min-h-0">
          Hapus langkah
        </button>
      </div>

      {error ? <p className="mt-2 text-[11px] text-red-700">{error}</p> : null}

      <StepHistory events={events} pending={pending} onBenar={confirmAiEvent} onKoreksi={focusStatusButtons} />
    </div>
  );
}
