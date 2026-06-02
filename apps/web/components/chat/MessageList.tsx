"use client";
import { useEffect, useRef } from "react";
import { InlineCardSnippet } from "./InlineCardSnippet";
import { ProposalCard, type Proposal } from "./ProposalCard";

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; citations?: { cardId: string; eventIds: string[] }[] }
  | { role: "assistant"; proposal: Proposal };

export function MessageList({ messages, pending }: { messages: Message[]; pending: boolean }) {
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
        return (
          <div key={i} className="flex flex-col gap-2">
            <div className="max-w-[80%] rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">{m.content}</div>
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
      {pending ? <div className="italic text-[var(--text-muted)]">…sedang memproses</div> : null}
    </div>
  );
}
