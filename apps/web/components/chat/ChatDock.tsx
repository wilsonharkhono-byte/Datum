"use client";
import { useEffect, useRef, useState } from "react";
import { stripActionTail } from "@datum/core";
import { useAssistant } from "./AssistantProvider";
import { MessageList, type Message } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { SparkIcon, XIcon } from "@/components/icons/Icon";
import { drain, enqueue, readQueue, remove } from "@/lib/assistant/offline-queue";
import type { ActionProposalType } from "@/lib/assistant/types";

type Mode = "tanya" | "catat";

const WAITING_LABEL = "Sedang memproses…";
const RETRYING_LABEL = "Koneksi lambat — mencoba lagi…";
const DRAINING_LABEL = "Mengirim catatan tertunda…";
const QUEUED_NOTICE = "Tersimpan offline — akan dikirim otomatis saat koneksi kembali.";
const STORED_MESSAGE_CAP = 30;
const FIRST_BYTE_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [1_000, 3_000];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Thrown when fetchWithRetry exhausts its retries without ever reaching the
 * server (fetch rejection / first-byte timeout). These sends are parked in
 * the offline queue rather than surfaced as failures — 4xx/5xx server
 * rejections are NOT tagged and keep the existing error + "Coba lagi" path.
 */
class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
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
      throw new NetworkError(
        e instanceof DOMException && e.name === "AbortError"
          ? "Tidak ada respons dari server (timeout). Periksa koneksi Anda."
          : e instanceof Error ? e.message : String(e),
      );
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
  const [queueCount, setQueueCount] = useState(0);

  const { pendingSeed, clearPending } = useAssistant();

  // Offline-queue guards. busyRef mirrors `busy` so the window "online"
  // listener can tell whether a send is in progress without a fresh render;
  // drainingRef serializes drains; inFlightIds prevents a double-send when
  // drains overlap on rapid online/offline flaps (items are only removed
  // from storage once the server confirms).
  const drainingRef = useRef(false);
  const busyRef = useRef(false);
  const inFlightIds = useRef<Set<string>>(new Set());

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

  // A seeded prompt (e.g. from the room "Tanya asisten" button, or the daily
  // brief notification link — carried across navigation by AssistantProvider)
  // opens the dock. Two variants (see PendingSeed in AssistantProvider):
  //  - "question": posts the text as a USER message and runs it (existing
  //    "Tanya asisten" behavior).
  //  - "assistant_message": posts the text directly as an ASSISTANT-authored
  //    first message — no request sent, deterministic compose already
  //    happened server-side in the cron (Task 4: daily brief). The user can
  //    still type follow-ups afterward like any other conversation.
  useEffect(() => {
    if (!pendingSeed) return;
    setMobileOpen(true);
    setMode("tanya");
    if (pendingSeed.kind === "assistant_message") {
      setMessages((m) => [...m, { role: "assistant", content: pendingSeed.text }]);
    } else {
      setMessages((m) => [...m, { role: "user", content: pendingSeed.text }]);
      void run("tanya", pendingSeed.text, null);
    }
    clearPending();
    // Fire only when a new seed arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeed]);

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
      let evt: {
        type?: string;
        text?: string;
        message?: string;
        sessionId?: string | null;
        citations?: { cardId: string; eventIds: string[] }[];
        action?: ActionProposalType | null;
      };
      try { evt = JSON.parse(line); } catch { return; }
      if (evt.type === "delta") {
        appendDelta(evt.text ?? "");
      } else if (evt.type === "done") {
        finished = true;
        if (evt.sessionId) setSessionId(evt.sessionId);
        // The action tail (Task 3) streamed in as raw text via `delta` events
        // above (the server can't hold it back mid-stream), so the
        // accumulated bubble content still has the raw <action>...</action>
        // tag in it here. Finalize the bubble with that tail stripped and
        // attach the server-parsed+validated `action` (if any) — this is the
        // "client parses AFTER stream completion" step: MessageList's render
        // also strips defensively, but stripping here keeps the *stored*
        // message (localStorage, history) clean too.
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant" && "content" in last && last.streaming) {
            copy[copy.length - 1] = {
              role: "assistant",
              content: stripActionTail(last.content),
              citations: evt.citations ?? [],
              action: evt.action ?? null,
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
    busyRef.current = true;
    setPendingLabel(WAITING_LABEL);
    setLastFailed(null);
    let succeeded = false;
    try {
      if (runMode === "tanya") await runTanya(input);
      else await runCatat(input, file);
      succeeded = true;
    } catch (e) {
      if (e instanceof NetworkError) {
        // Never lose the text: park it in the offline queue (the user bubble
        // stays visible in the thread) and announce it with an amber bubble.
        // No "Coba lagi" here — the drain triggers re-send automatically.
        await enqueue(projectId, { mode: runMode, text: input, ts: Date.now() });
        setQueueCount((await readQueue(projectId)).length);
        setMessages((m) => [...m, { role: "assistant" as const, content: QUEUED_NOTICE, queued: true }]);
      } else {
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
      }
    } finally {
      setBusy(false);
      busyRef.current = false;
      setPendingLabel(null);
    }
    // A send just went through — the connection is back, so flush anything
    // that piled up while offline.
    if (succeeded) void drainQueue();
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

  // ── Offline queue drain ────────────────────────────────────────────────
  // Re-sends queued items oldest first, one at a time; stops on the first
  // network failure (still offline). drain() prunes Tanya items older than
  // 30 minutes — a stale question's answer is no longer wanted; Catat notes
  // are never dropped. Items stay in storage until their send succeeds
  // (remove-on-success), so a crash mid-send can't lose a note; inFlightIds
  // is what stops an overlapping drain from double-sending meanwhile.
  async function drainQueue() {
    if (drainingRef.current || busyRef.current) return;
    const items = await drain(projectId);
    setQueueCount(items.length);
    if (items.length === 0) return;
    drainingRef.current = true;
    busyRef.current = true;
    setBusy(true);
    try {
      for (const item of items) {
        if (inFlightIds.current.has(item.id)) continue; // already being sent
        setPendingLabel(DRAINING_LABEL);
        inFlightIds.current.add(item.id);
        try {
          if (item.mode === "tanya") await runTanya(item.text);
          else await runCatat(item.text, null);
          await remove(projectId, item.id);
        } catch (e) {
          if (!(e instanceof NetworkError)) {
            // The server received and rejected this item — re-sending the
            // same payload won't succeed, so drop it (the text stays visible
            // in the thread) instead of wedging the queue head forever.
            await remove(projectId, item.id);
            setMessages((m) => [...m, {
              role: "assistant" as const,
              content: `Gagal mengirim pesan tertunda: ${e instanceof Error ? e.message : String(e)}`,
              error: true,
            }]);
          }
          break; // stop on first failure; remaining items stay queued
        } finally {
          inFlightIds.current.delete(item.id);
          setQueueCount((await readQueue(projectId)).length);
        }
      }
    } finally {
      drainingRef.current = false;
      busyRef.current = false;
      setBusy(false);
      setPendingLabel(null);
    }
  }

  // Latest-closure ref so the mount/"online" effect below doesn't pin a
  // stale drainQueue (and with it a stale sessionId) for the listener's
  // lifetime. The refs above make any overlapping invocation a safe no-op.
  const drainQueueRef = useRef(drainQueue);
  drainQueueRef.current = drainQueue;

  useEffect(() => {
    if (!hydrated) return;
    // drainQueue refreshes queueCount as its first step, so the badge is
    // initialized here even when the drain itself has nothing to send.
    void drainQueueRef.current();
    const onOnline = () => { void drainQueueRef.current(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [hydrated, projectId]);

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
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--foreground)] bg-[var(--foreground)] px-4 py-2 text-[var(--text-inverse)]">
          <div className="flex min-w-0 items-center gap-3">
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
          <div className="flex shrink-0 items-center gap-2">
            {queueCount > 0 ? (
              <span
                className="rounded border border-[var(--flag-warning)]/40 bg-[var(--flag-warning-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--flag-warning)]"
                title="Pesan menunggu koneksi untuk dikirim"
              >
                {queueCount} tertunda
              </span>
            ) : null}
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
            projectId={projectId}
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

      {/* Mobile full-screen sheet. Safe-area insets keep the dark header clear
          of the notch/status bar and the input clear of the home indicator. */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] md:hidden"
        >
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
