"use client";
import { useEffect, useRef, useState } from "react";
import { MessageList, type Message } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { SparkIcon, XIcon } from "@/components/icons/Icon";

type Mode = "tanya" | "catat";

const WAITING_LABEL = "Sedang memproses…";
const RETRYING_LABEL = "Koneksi lambat — mencoba lagi…";
const STORED_MESSAGE_CAP = 30;
const FIRST_BYTE_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [1_000, 3_000];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST with a 20s timeout-to-first-byte and up to 2 automatic retries
 * (1s, 3s backoff) — ONLY for network failures / timeouts / 5xx responses.
 * 4xx responses are returned immediately and never retried.
 */
async function fetchWithRetry(
  url: string,
  payload: unknown,
  onRetryWait: () => void,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FIRST_BYTE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (e) {
      // Network failure or first-byte timeout — retryable.
      if (attempt < RETRY_DELAYS_MS.length) {
        onRetryWait();
        await sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      throw e instanceof DOMException && e.name === "AbortError"
        ? new Error("Tidak ada respons dari server (timeout). Periksa koneksi Anda.")
        : e;
    } finally {
      // Headers received = first byte arrived; body streaming has no timeout.
      clearTimeout(timer);
    }
    if (res.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
      onRetryWait();
      await sleep(RETRY_DELAYS_MS[attempt]!);
      continue;
    }
    return res;
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  let body: { message?: string; error?: string } | null = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return (
    body?.message
    || (res.status === 503 ? "Asisten belum dikonfigurasi." : `Gagal: HTTP ${res.status}`)
  );
}

/** Strip non-serializable / transient bits before writing to localStorage. */
function toStorable(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && "error" in m && m.error) continue; // transient
    if (m.role === "assistant" && "proposal" in m) {
      // Proposal cards carry a live File and per-card commit state we can't
      // restore safely (re-rendering SIMPAN after reload risks double-saving).
      // Keep a readable trace line instead.
      out.push({
        role: "assistant",
        content: `Usulan catatan untuk kartu "${m.proposal.cardTitle}" (${m.proposal.eventKind}) — dari sesi sebelumnya.`,
      });
      continue;
    }
    if (m.role === "assistant" && "content" in m && m.streaming) {
      out.push({ ...m, streaming: false });
      continue;
    }
    out.push(m);
  }
  return out.slice(-STORED_MESSAGE_CAP);
}

function isStoredMessage(v: unknown): v is Message {
  if (typeof v !== "object" || v === null) return false;
  const m = v as { role?: unknown; content?: unknown };
  return (
    (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
  );
}

export function ChatDock({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const [mode, setMode] = useState<Mode>("tanya");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<{ mode: Mode; input: string; file: File | null } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const storageKey = `datum.chat.${projectId}`;

  // ── Session persistence ────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw) as { sessionId?: unknown; messages?: unknown };
        if (Array.isArray(data.messages)) {
          setMessages(data.messages.filter(isStoredMessage).slice(-STORED_MESSAGE_CAP));
        }
        if (typeof data.sessionId === "string" && data.sessionId) {
          setSessionId(data.sessionId);
        }
      }
    } catch { /* corrupt storage — start fresh */ }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ sessionId: sessionId ?? null, messages: toStorable(messages) }),
      );
    } catch { /* quota exceeded / private mode — non-fatal */ }
  }, [messages, sessionId, hydrated, storageKey]);

  function resetChat() {
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
    setMessages([]);
    setSessionId(undefined);
    setLastFailed(null);
  }

  // ── Send / retry pipeline ──────────────────────────────────────────────
  const showRetrying = () => setPendingLabel(RETRYING_LABEL);

  async function runTanya(input: string) {
    const res = await fetchWithRetry(
      "/api/assistant/message",
      { projectId, question: input, sessionId },
      showRetrying,
    );
    if (!res.ok) throw new Error(await readErrorMessage(res));

    // Legacy / proxy fallback: a plain JSON body is the old non-streamed shape.
    const ctype = res.headers.get("content-type") ?? "";
    if (ctype.includes("application/json")) {
      const data = await res.json();
      if (data.sessionId) setSessionId(data.sessionId);
      setMessages((m) => [...m, { role: "assistant", content: data.answer ?? "", citations: data.citations }]);
      return;
    }

    if (!res.body) throw new Error("Tidak ada respons dari asisten.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let started = false;
    let finished = false;

    const appendDelta = (text: string) => {
      if (!text) return;
      if (!started) {
        started = true;
        setPendingLabel(null); // the growing bubble is the feedback now
        setMessages((m) => [...m, { role: "assistant", content: text, streaming: true }]);
        return;
      }
      setMessages((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant" && "content" in last && last.streaming) {
          copy[copy.length - 1] = { ...last, content: last.content + text };
        }
        return copy;
      });
    };

    const handleEvent = (line: string) => {
      let evt: { type?: string; text?: string; message?: string; sessionId?: string | null; citations?: { cardId: string; eventIds: string[] }[] };
      try { evt = JSON.parse(line); } catch { return; }
      if (evt.type === "delta") {
        appendDelta(evt.text ?? "");
      } else if (evt.type === "done") {
        finished = true;
        if (evt.sessionId) setSessionId(evt.sessionId);
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant" && "content" in last && last.streaming) {
            copy[copy.length - 1] = {
              role: "assistant",
              content: last.content,
              citations: evt.citations ?? [],
            };
          } else if (!started) {
            // Model produced no text at all — still surface an honest bubble.
            copy.push({ role: "assistant", content: "(tidak ada jawaban)", citations: evt.citations ?? [] });
          }
          return copy;
        });
      } else if (evt.type === "error") {
        finished = true;
        throw new Error(evt.message || "Asisten gagal menjawab.");
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) handleEvent(line);
      }
    }
    const tail = (buffer + decoder.decode()).trim();
    if (tail) handleEvent(tail);

    if (!finished) {
      throw new Error("Koneksi terputus sebelum jawaban selesai.");
    }
  }

  async function runCatat(input: string, file: File | null) {
    const res = await fetchWithRetry(
      "/api/assistant/capture",
      {
        projectId,
        text: input,
        file: file ? { name: file.name, mime: file.type || "application/octet-stream", size: file.size } : undefined,
      },
      showRetrying,
    );
    if (!res.ok) throw new Error(await readErrorMessage(res));
    const data = await res.json();
    if (!data.ok) {
      setMessages((m) => [...m, { role: "assistant", content: `Tidak bisa mencatat: ${data.error}` }]);
      return;
    }
    // Stash the actual File object on the proposal so ProposalCard can upload it on commit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proposalWithFile = { ...data.proposal, projectCode, pendingFile: file ?? undefined } as any;
    setMessages((m) => [...m, { role: "assistant", proposal: proposalWithFile }]);
  }

  async function run(runMode: Mode, input: string, file: File | null) {
    setBusy(true);
    setPendingLabel(WAITING_LABEL);
    setLastFailed(null);
    try {
      if (runMode === "tanya") await runTanya(input);
      else await runCatat(input, file);
    } catch (e) {
      const msg = `Gagal: ${e instanceof Error ? e.message : String(e)}`;
      setLastFailed({ mode: runMode, input, file });
      setMessages((m) => {
        // Close out any half-streamed bubble, then append the error bubble.
        const copy = m.map((msg2) =>
          msg2.role === "assistant" && "content" in msg2 && msg2.streaming
            ? { ...msg2, streaming: false }
            : msg2,
        );
        return [...copy, { role: "assistant" as const, content: msg, error: true }];
      });
    } finally {
      setBusy(false);
      setPendingLabel(null);
    }
  }

  async function send(input: string, file: File | null) {
    setMessages((m) => [...m, { role: "user", content: input + (file ? " 📎" : "") }]);
    await run(mode, input, file);
  }

  function retryLast() {
    if (!lastFailed || busy) return;
    const { mode: failedMode, input, file } = lastFailed;
    setLastFailed(null);
    // Drop the trailing error bubble; the original user bubble stays put.
    setMessages((m) => {
      const last = m[m.length - 1];
      if (last && last.role === "assistant" && "error" in last && last.error) {
        return m.slice(0, -1);
      }
      return m;
    });
    void run(failedMode, input, file);
  }

  const pending = pendingLabel !== null;
  const hasContent = messages.length > 0 || pending;

  // Render helper (NOT a nested component — keeping it a plain function call
  // preserves child state like ProposalCard's commit status across the
  // frequent re-renders streaming produces).
  function renderDock(onClose?: () => void) {
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
          <div className="flex items-center gap-2">
            {messages.length > 0 || sessionId ? (
              <button
                type="button"
                onClick={resetChat}
                disabled={busy}
                aria-label="Mulai percakapan baru"
                className="inline-flex items-center rounded border border-[var(--text-inverse-secondary)]/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-inverse-secondary)] hover:text-[var(--text-inverse)] disabled:opacity-50"
              >
                Mulai baru
              </button>
            ) : null}
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
        </div>

        {/* Layer 2 — warm-white message canvas. Only rendered once there's
            actual conversation; the empty-state placeholder lives in the
            input row's helper text instead so the dock collapses to a thin
            strip and gives the board page more real estate. */}
        {hasContent ? (
          <MessageList
            messages={messages}
            pending={pending}
            pendingLabel={pendingLabel ?? WAITING_LABEL}
            onRetry={lastFailed ? retryLast : null}
          />
        ) : null}

        {/* Layer 3 — sand-tinted input footer band, anchored to the bottom */}
        <div className="border-t border-[var(--border)] bg-[var(--surface-alt)]">
          <MessageInput
            onSend={send}
            disabled={busy}
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
          {renderDock(() => setMobileOpen(false))}
        </div>
      ) : null}

      {/* Desktop inline dock — md+. Compact when there's nothing to show
          (more board area for cards); expands to 34vh once messages or
          proposals exist so SIMPAN and replies have room to breathe. */}
      <div
        className={`hidden flex-col border-t border-[var(--border)] bg-[var(--surface)] shadow-[0_-6px_18px_-10px_rgba(20,18,16,0.18)] transition-[height] duration-200 ease-out md:flex ${
          hasContent ? "h-[34vh]" : "h-auto"
        }`}
      >
        {renderDock()}
      </div>
    </>
  );
}
