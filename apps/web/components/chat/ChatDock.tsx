"use client";
import { useState } from "react";
import { MessageList, type Message } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { SparkIcon, XIcon } from "@/components/icons/Icon";

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
        const res = await fetch("/api/assistant/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, question: input, sessionId }),
        });
        if (!res.ok) {
          let body: { message?: string; error?: string } | null = null;
          try { body = await res.json(); } catch { /* ignore */ }
          const friendlyMessage = body?.message
            || (res.status === 503 ? "Asisten belum dikonfigurasi."
                : `Gagal: HTTP ${res.status}`);
          throw new Error(friendlyMessage);
        }
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
        if (!res.ok) {
          let body: { message?: string; error?: string } | null = null;
          try { body = await res.json(); } catch { /* ignore */ }
          const friendlyMessage = body?.message
            || (res.status === 503 ? "Asisten belum dikonfigurasi."
                : `Gagal: HTTP ${res.status}`);
          throw new Error(friendlyMessage);
        }
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

  function DockContent({ onClose }: { onClose?: () => void }) {
    return (
      <>
        {/* Layer 1 — signature dark header bar.
            Carries the assistant label, segmented mode control, and helper text.
            On mobile (when onClose is provided), shows a close button instead. */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--foreground)] bg-[var(--foreground)] px-4 py-2 text-[var(--text-inverse)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand)]">
              <SparkIcon size={12} /> Asisten
            </span>
            <div className="seg" role="tablist" aria-label="Mode asisten">
              <button
                type="button"
                role="tab"
                onClick={() => setMode("tanya")}
                aria-label="Mode tanya"
                aria-selected={mode === "tanya"}
                className={`seg-btn${mode === "tanya" ? " seg-active" : ""}`}
              >
                Tanya
              </button>
              <button
                type="button"
                role="tab"
                onClick={() => setMode("catat")}
                aria-label="Mode catat"
                aria-selected={mode === "catat"}
                className={`seg-btn${mode === "catat" ? " seg-active" : ""}`}
              >
                Catat
              </button>
            </div>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup asisten"
              className="inline-flex items-center gap-1 rounded border border-[var(--text-inverse-secondary)]/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-inverse-secondary)] hover:text-[var(--text-inverse)]"
            >
              <XIcon size={11} /> Tutup
            </button>
          ) : (
            <span className="hidden text-[10px] uppercase tracking-[0.06em] text-[var(--text-inverse-secondary)] md:inline">
              {mode === "tanya"
                ? "Bahasa Indonesia · jawaban dikutip dari kartu"
                : "AI memilih kartu + jenis aktivitas; Anda konfirmasi"}
            </span>
          )}
        </div>

        {/* Layer 2 — warm-white message canvas */}
        <MessageList messages={messages} pending={pending} />

        {/* Layer 3 — sand-tinted input footer band, anchored to the bottom */}
        <div className="border-t border-[var(--border)] bg-[var(--surface-alt)]">
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
      </>
    );
  }

  return (
    <>
      {/* Mobile pill — shown below md when sheet is closed.
          Same dark header treatment as the desktop dock so the assistant always
          announces itself with the signature dark bar. */}
      {!mobileOpen ? (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex h-12 w-full items-center justify-between border-t border-[var(--foreground)] bg-[var(--foreground)] px-4 text-xs text-[var(--text-inverse)] md:hidden"
          aria-label="Buka asisten"
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--sand)]">
            <SparkIcon size={12} /> Asisten
          </span>
          <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-inverse-secondary)]">
            tap untuk buka →
          </span>
        </button>
      ) : null}

      {/* Mobile full-screen sheet */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--surface)] md:hidden">
          <DockContent onClose={() => setMobileOpen(false)} />
        </div>
      ) : null}

      {/* Desktop inline dock — md+. The shadow under the dock anchors it to the
          screen edge and reinforces the assistant as a persistent surface. */}
      <div className="hidden h-[26vh] flex-col border-t border-[var(--border)] bg-[var(--surface)] shadow-[0_-6px_18px_-10px_rgba(20,18,16,0.18)] md:flex">
        <DockContent />
      </div>
    </>
  );
}
