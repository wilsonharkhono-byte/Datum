"use client";
import { useEffect, useRef } from "react";
import { InlineCardSnippet } from "./InlineCardSnippet";

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; citations?: { cardId: string; eventIds: string[] }[] };

export function MessageList({ messages, pending }: { messages: Message[]; pending: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [messages, pending]);

  return (
    <div ref={ref} className="flex-1 space-y-2 overflow-y-auto px-4 py-2 text-sm">
      {messages.length === 0 ? (
        <p className="italic text-stone-500">Tanya apa saja tentang proyek ini — misalnya "apa keputusan terakhir untuk master bath?"</p>
      ) : null}
      {messages.map((m, i) => (
        <div key={i} className={m.role === "user" ? "flex justify-end" : "flex flex-col gap-2"}>
          <div className={
            m.role === "user"
              ? "max-w-[70%] rounded bg-green-100 px-3 py-1.5"
              : "max-w-[80%] rounded bg-white border border-stone-200 px-3 py-1.5"
          }>
            {m.content}
          </div>
          {m.role === "assistant" && m.citations?.length ? (
            <div className="ml-1 flex flex-col gap-1">
              {m.citations.map((c) => (
                <InlineCardSnippet key={c.cardId} cardId={c.cardId} eventIds={c.eventIds} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
      {pending ? <div className="italic text-stone-500">…sedang mencari di kartu</div> : null}
    </div>
  );
}
