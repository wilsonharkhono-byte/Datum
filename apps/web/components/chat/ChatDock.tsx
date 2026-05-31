"use client";
import { useState } from "react";
import { MessageList, type Message } from "./MessageList";
import { MessageInput } from "./MessageInput";

type Mode = "tanya" | "catat";

export function ChatDock({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const [mode, setMode] = useState<Mode>("tanya");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function send(input: string) {
    setMessages((m) => [...m, { role: "user", content: input }]);
    setPending(true);
    try {
      if (mode === "tanya") {
        const res = await fetch("/api/assistant/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, question: input, sessionId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSessionId(data.sessionId);
        setMessages((m) => [...m, { role: "assistant", content: data.answer, citations: data.citations }]);
      } else {
        const res = await fetch("/api/assistant/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, text: input }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.ok) {
          setMessages((m) => [...m, { role: "assistant", content: `Tidak bisa mencatat: ${data.error}` }]);
        } else {
          setMessages((m) => [...m, { role: "assistant", proposal: { ...data.proposal, projectCode } }]);
        }
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Gagal: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-[25vh] flex-col border-t border-stone-300 bg-stone-50">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold uppercase tracking-wide text-amber-800">&#9652; Asisten</span>
          <div className="flex overflow-hidden rounded border border-stone-300 bg-white">
            <button
              type="button"
              onClick={() => setMode("tanya")}
              className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                mode === "tanya" ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              Tanya
            </button>
            <button
              type="button"
              onClick={() => setMode("catat")}
              className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                mode === "catat" ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              Catat
            </button>
          </div>
        </div>
        <span className="text-stone-500">
          {mode === "tanya"
            ? "Bahasa Indonesia · jawaban dikutip dari kartu"
            : "AI memilih kartu + jenis aktivitas; Anda konfirmasi"}
        </span>
      </div>
      <MessageList messages={messages} pending={pending} />
      <MessageInput
        onSend={send}
        disabled={pending}
        placeholder={
          mode === "tanya"
            ? "Tanya atau cari di kartu…"
            : "Catat sesuatu — mis. 'marmer Statuario disetujui klien'"
        }
      />
    </div>
  );
}
