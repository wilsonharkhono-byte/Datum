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

  async function send(input: string, file: File | null) {
    setMessages((m) => [...m, { role: "user", content: input + (file ? " 📎" : "") }]);
    setPending(true);
    try {
      if (mode === "tanya") {
        // File ignored in Tanya mode (could be a future enhancement)
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
          body: JSON.stringify({
            projectId,
            text: input,
            file: file ? { name: file.name, mime: file.type || "application/octet-stream", size: file.size } : undefined,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.ok) {
          setMessages((m) => [...m, { role: "assistant", content: `Tidak bisa mencatat: ${data.error}` }]);
        } else {
          // Stash the actual File object on the proposal so ProposalCard can upload it on commit
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const proposalWithFile = { ...data.proposal, projectCode, pendingFile: file ?? undefined } as any;
          setMessages((m) => [...m, { role: "assistant", proposal: proposalWithFile }]);
        }
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Gagal: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-[25vh] flex-col border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold uppercase tracking-wide text-[var(--sand-dark)]">&#9652; Asisten</span>
          <div className="flex overflow-hidden rounded border border-[var(--border)] bg-[var(--surface)]">
            <button
              type="button"
              onClick={() => setMode("tanya")}
              aria-label="Mode tanya"
              aria-pressed={mode === "tanya"}
              className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                mode === "tanya" ? "bg-foreground text-white" : "text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
              }`}
            >
              Tanya
            </button>
            <button
              type="button"
              onClick={() => setMode("catat")}
              aria-label="Mode catat"
              aria-pressed={mode === "catat"}
              className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                mode === "catat" ? "bg-foreground text-white" : "text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
              }`}
            >
              Catat
            </button>
          </div>
        </div>
        <span className="text-[var(--text-muted)]">
          {mode === "tanya"
            ? "Bahasa Indonesia · jawaban dikutip dari kartu"
            : "AI memilih kartu + jenis aktivitas; Anda konfirmasi"}
        </span>
      </div>
      <MessageList messages={messages} pending={pending} />
      <MessageInput
        onSend={send}
        disabled={pending}
        acceptFiles={mode === "catat"}
        placeholder={
          mode === "tanya"
            ? "Tanya atau cari di kartu…"
            : "Catat sesuatu atau drop file…"
        }
      />
    </div>
  );
}
