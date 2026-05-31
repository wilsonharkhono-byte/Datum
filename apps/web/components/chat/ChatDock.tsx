"use client";
import { useState } from "react";
import { MessageList, type Message } from "./MessageList";
import { MessageInput } from "./MessageInput";

export function ChatDock({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function send(question: string) {
    setMessages((m) => [...m, { role: "user", content: question }]);
    setPending(true);
    try {
      const res = await fetch("/api/assistant/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, question, sessionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessionId(data.sessionId);
      setMessages((m) => [...m, { role: "assistant", content: data.answer, citations: data.citations }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Gagal: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-[25vh] flex-col border-t border-stone-300 bg-stone-50">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-1.5 text-xs">
        <span className="font-semibold uppercase tracking-wide text-amber-800">▴ Asisten</span>
        <span className="text-stone-500">Bahasa Indonesia · jawaban dikutip dari kartu</span>
      </div>
      <MessageList messages={messages} pending={pending} />
      <MessageInput onSend={send} disabled={pending} />
    </div>
  );
}
