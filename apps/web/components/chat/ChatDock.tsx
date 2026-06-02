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
  const [mobileOpen, setMobileOpen] = useState(false);

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

  /** Shared dock content: mode toggle row + MessageList + MessageInput */
  function DockContent() {
    return (
      <>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-wide text-[var(--sand-dark)]">&#9652; Asisten</span>
            <div className="flex overflow-hidden rounded border border-[var(--border)] bg-[var(--surface)]">
              <button
                type="button"
                onClick={() => setMode("tanya")}
                aria-label="Mode tanya"
                aria-pressed={mode === "tanya"}
                className={`px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
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
                className={`px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
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
      </>
    );
  }

  return (
    <>
      {/* Mobile pill — shown below md when sheet is closed */}
      {!mobileOpen ? (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex h-12 w-full items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-4 text-xs md:hidden"
          aria-label="Buka asisten"
        >
          <span className="flex items-center gap-2">
            <span aria-hidden="true">&#9652;</span>
            <span className="font-semibold uppercase tracking-wide text-[var(--sand-dark)]">Asisten</span>
          </span>
          <span className="text-[var(--text-secondary)]">tap untuk buka</span>
        </button>
      ) : null}

      {/* Mobile full-screen sheet — shown below md when open */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--surface)] md:hidden">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <span className="font-semibold uppercase tracking-wide text-[var(--sand-dark)]">&#9652; Asisten</span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-xs"
              aria-label="Tutup asisten"
            >
              tutup
            </button>
          </div>
          <DockContent />
        </div>
      ) : null}

      {/* Desktop inline dock — md+ */}
      <div className="hidden h-[25vh] flex-col border-t border-[var(--border)] bg-[var(--surface)] md:flex">
        <DockContent />
      </div>
    </>
  );
}
