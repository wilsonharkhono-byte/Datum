"use client";
import { useEffect, useRef } from "react";
import { InlineCardSnippet } from "./InlineCardSnippet";
import { ProposalCard, type Proposal } from "./ProposalCard";

export type Message =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      citations?: { cardId: string; eventIds: string[] }[];
      /** true while text deltas are still being appended */
      streaming?: boolean;
      /** true for failure bubbles — rendered in critical style with "Coba lagi" */
      error?: boolean;
      /** true for offline-queue notices — rendered in amber "tersimpan offline" style */
      queued?: boolean;
    }
  | { role: "assistant"; proposal: Proposal };

/**
 * Citation tokens ([card:uuid] / [event:uuid]) are extracted server-side and
 * rendered as InlineCardSnippet below the bubble — hide the raw markers from
 * the visible text. Safe mid-stream: a partially-arrived token stays visible
 * only until its closing bracket streams in.
 */
function stripCitationTokens(text: string): string {
  return text.replace(/\s*\[(?:card|event):[0-9a-f-]{36}\]/gi, "");
}

/** Subtle three-dot typing indicator. Static dots under prefers-reduced-motion. */
function PendingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)] motion-reduce:animate-none"
          style={{ animationDelay: `${i * 160}ms`, animationDuration: "1s" }}
        />
      ))}
    </span>
  );
}

export function MessageList({
  messages,
  pending,
  pendingLabel = "Sedang memproses…",
  onRetry,
}: {
  messages: Message[];
  pending: boolean;
  pendingLabel?: string;
  onRetry?: (() => void) | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [messages, pending]);

  return (
    <div ref={ref} className="flex-1 space-y-2 overflow-y-auto px-4 py-2 text-sm">
      {messages.length === 0 ? (
        <p className="italic text-[var(--text-muted)]">
          Mode Tanya: ajukan pertanyaan tentang proyek. Mode Catat: tulis sesuatu untuk dicatat — AI akan memilih kartu.
        </p>
      ) : null}
      {messages.map((m, i) => {
        if (m.role === "user") {
          return (
            <div key={i} className="flex justify-end">
              {/* User bubble: bg-[var(--flag-ok-bg)] keeps brand palette while preserving the "user said this" visual convention */}
              <div className="max-w-[70%] rounded bg-[var(--flag-ok-bg)] px-3 py-1.5">{m.content}</div>
            </div>
          );
        }
        if ("proposal" in m) {
          return (
            <div key={i} className="flex">
              <ProposalCard proposal={m.proposal} />
            </div>
          );
        }
        if (m.queued) {
          return (
            <div key={i} className="flex">
              <div className="max-w-[80%] rounded border border-[var(--flag-warning)]/40 bg-[var(--flag-warning-bg)] px-3 py-1.5 text-[var(--flag-warning)]">
                {m.content}
              </div>
            </div>
          );
        }
        if (m.error) {
          return (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="max-w-[80%] rounded border border-[var(--flag-critical)]/40 bg-[var(--flag-critical-bg)] px-3 py-1.5 text-[var(--flag-critical)]">
                {m.content}
              </div>
              {onRetry && i === messages.length - 1 ? (
                <button
                  type="button"
                  onClick={onRetry}
                  aria-label="Kirim ulang pesan terakhir"
                  className="self-start rounded border border-[var(--flag-critical)]/40 bg-[var(--surface)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--flag-critical)] hover:bg-[var(--flag-critical-bg)]"
                >
                  ↻ Coba lagi
                </button>
              ) : null}
            </div>
          );
        }
        return (
          <div key={i} className="flex flex-col gap-2">
            <div className="max-w-[80%] rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 whitespace-pre-wrap">
              {stripCitationTokens(m.content)}
              {m.streaming ? (
                <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-[var(--sand-dark)] align-middle motion-reduce:animate-none" aria-hidden="true" />
              ) : null}
            </div>
            {m.citations?.length ? (
              <div className="ml-1 flex flex-col gap-1">
                {m.citations.map((c) => (
                  <InlineCardSnippet key={c.cardId} cardId={c.cardId} eventIds={c.eventIds} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {pending ? (
        <div className="flex items-center gap-2 text-[var(--text-muted)]" role="status">
          <PendingDots />
          <span className="italic text-xs">{pendingLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
