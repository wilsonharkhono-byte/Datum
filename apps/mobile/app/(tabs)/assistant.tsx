/**
 * assistant.tsx — AI Assistant chat screen (Tanya + Catat modes).
 *
 * Architecture:
 *   - Mobile NEVER calls Anthropic directly. It posts to:
 *       ${WEB_BASE_URL}/api/assistant/message  (Tanya)
 *       ${WEB_BASE_URL}/api/assistant/capture  (Catat)
 *     with `Authorization: Bearer <access_token>` from supabase.auth.getSession().
 *
 * OPEN QUESTION — Bearer auth (roadmap §1.5):
 *   The web assistant routes currently validate via createSupabaseServerClient()
 *   which reads cookies, NOT an Authorization header. Until the web routes are
 *   updated to also accept Bearer tokens, mobile sends will receive a 401 or
 *   cookie-less session error. This is surfaced as a readable Indonesian error
 *   message rather than a crash. Track: apps/web/app/api/assistant/{message,capture}/route.ts.
 *
 * OPEN QUESTION — Expo streaming:
 *   expo/fetch (WinterCG) may expose response.body as an async byte ReadableStream.
 *   This is runtime-dependent. We try to consume the body as a stream if available;
 *   if response.body is null or text() must be used as fallback, we buffer the full
 *   response and parse line-by-line with parseStreamLine. Both paths use
 *   parseStreamLine for event parsing.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { View, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import {
  parseStreamLine,
  extractCitations,
  enqueue,
  drain,
  remove,
  ChatRequest,
  CaptureRequest,
} from "@datum/core";
import type { Citation, Proposal } from "@datum/core";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session/session";
import { useProjects } from "@/lib/query/hooks";
import { WEB_BASE_URL } from "@/lib/env";
import { Text } from "@/components/ui/Text";
import { Screen } from "@/components/ui/Screen";
import { MessageList } from "@/components/chat/MessageList";
import { MessageInput } from "@/components/chat/MessageInput";
import { ProjectSwitcher, useProjectSelection } from "@/components/chat/ProjectSwitcher";
import type { ChatMessage } from "@/components/chat/MessageList";
import type { AttachedFile } from "@/components/chat/MessageInput";

// ─── Constants ────────────────────────────────────────────────────────────────

// First-byte timeout mirror of web ChatDock (20 s).
const FIRST_BYTE_TIMEOUT_MS = 20_000;

// AsyncStorage-backed QueueStorage adapter
const queueStorage = {
  getItem: (k: string) => AsyncStorage.getItem(k),
  setItem: (k: string, v: string) => AsyncStorage.setItem(k, v),
  removeItem: (k: string) => AsyncStorage.removeItem(k),
};

function genId() {
  return Crypto.randomUUID();
}

async function getBearerToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Consume an NDJSON response body.
 *
 * OPEN QUESTION (Expo streaming): expo/fetch (WinterCG) may expose
 * response.body as a ReadableStream<Uint8Array>. We attempt the streaming
 * path first; fall back to response.text() (full buffer) if response.body is
 * null or reading fails. Both paths use parseStreamLine for event parsing.
 */
async function consumeNdjson(
  response: Response,
  onDelta: (text: string) => void,
  onDone: (citations: Citation[], sessionId: string | null) => void,
  onError: (msg: string) => void,
): Promise<void> {
  // TextDecoder and ReadableStream are available in the Hermes / WinterCG
  // runtime on Expo SDK 56+. TypeScript's "react-native" lib type set does not
  // include them, so we access globalThis to avoid TS2304 errors.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  const decoder: { decode(v: Uint8Array, opts?: { stream?: boolean }): string } | null =
    g.TextDecoder ? new g.TextDecoder() : null;

  // ── Streaming path ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null =
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (response as any).body ?? null;
  if (body && decoder) {
    try {
      const reader = body.getReader();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const ev = parseStreamLine(line);
          if (!ev) continue;
          if (ev.type === "delta") onDelta(ev.text);
          else if (ev.type === "done") onDone(ev.citations, ev.sessionId);
          else if (ev.type === "error") onError(ev.message);
        }
      }
      // Flush remaining buffer
      if (buffer.trim()) {
        const ev = parseStreamLine(buffer);
        if (ev?.type === "delta") onDelta(ev.text);
        else if (ev?.type === "done") onDone(ev.citations, ev.sessionId);
        else if (ev?.type === "error") onError(ev.message);
      }
      return;
    } catch {
      // Fall through to buffered path
    }
  }

  // ── Buffered fallback path ─────────────────────────────────────────────────
  const text = await response.text();
  for (const line of text.split("\n")) {
    const ev = parseStreamLine(line);
    if (!ev) continue;
    if (ev.type === "delta") onDelta(ev.text);
    else if (ev.type === "done") onDone(ev.citations, ev.sessionId);
    else if (ev.type === "error") onError(ev.message);
  }
}

// ─── ModeToggle ───────────────────────────────────────────────────────────────

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "tanya" | "catat";
  onChange: (m: "tanya" | "catat") => void;
}) {
  return (
    <View className="flex-row rounded-lg border border-border/40 bg-surface-alt">
      {(["tanya", "catat"] as const).map((m) => (
        <Pressable
          key={m}
          onPress={() => onChange(m)}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === m }}
          testID={`mode-toggle-${m}`}
          className={`flex-1 items-center rounded-md px-4 py-1.5 ${
            mode === m ? "bg-primary" : ""
          }`}
        >
          <Text
            className={`text-[13px] font-semibold capitalize ${
              mode === m ? "text-[#FDFAF6]" : "text-text-sec"
            }`}
          >
            {m === "tanya" ? "Tanya" : "Catat"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── NoBaseUrlNotice ──────────────────────────────────────────────────────────

function NoBaseUrlNotice() {
  return (
    <View className="flex-1 items-center justify-center px-6" testID="no-base-url-notice">
      <Text variant="heading" className="mb-2 text-center">
        Asisten tidak tersedia
      </Text>
      <Text variant="muted" className="text-center leading-5">
        Variabel EXPO_PUBLIC_WEB_BASE_URL belum dikonfigurasi. Hubungi admin
        untuk mengaktifkan fitur AI.
      </Text>
    </View>
  );
}

// ─── AssistantChat ────────────────────────────────────────────────────────────

// Exported for testing (tests render AssistantChat directly with a valid projectId).
export function AssistantChat({ projectId }: { projectId: string }) {
  const { staff } = useSession();
  const [mode, setMode] = useState<"tanya" | "catat">("tanya");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const drainInFlightRef = useRef(false);

  // ── Append / update helpers ──────────────────────────────────────────────

  function appendMessage(msg: ChatMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  function updateLastAssistant(
    updater: (
      prev: Extract<ChatMessage, { role: "assistant" }>,
    ) => Extract<ChatMessage, { role: "assistant" }>,
  ) {
    setMessages((prev) => {
      const next = [...prev];
      // Walk backwards to find the latest assistant bubble
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i];
        if (m?.role === "assistant") {
          next[i] = updater(m);
          break;
        }
      }
      return next;
    });
  }

  // ── Tanya send ──────────────────────────────────────────────────────────────

  async function sendTanya(text: string, assistantMsgId?: string) {
    if (!WEB_BASE_URL) return;

    const aid = assistantMsgId ?? genId();
    if (!assistantMsgId) {
      appendMessage({
        id: aid,
        role: "assistant",
        content: "",
        streaming: true,
        citations: [],
      });
    }

    const token = await getBearerToken();
    if (!token) {
      updateLastAssistant((m) => ({
        ...m,
        streaming: false,
        error: "Tidak ada sesi aktif — silakan masuk kembali.",
      }));
      return;
    }

    const bodyParse = ChatRequest.safeParse({
      projectId,
      question: text,
      sessionId: sessionIdRef.current ?? undefined,
    });
    if (!bodyParse.success) {
      updateLastAssistant((m) => ({
        ...m,
        streaming: false,
        error: "Pertanyaan tidak valid: " + (bodyParse.error.issues[0]?.message ?? ""),
      }));
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FIRST_BYTE_TIMEOUT_MS);

    try {
      const res = await fetch(`${WEB_BASE_URL}/api/assistant/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // OPEN QUESTION (Bearer auth): web route uses cookie auth; Bearer may
          // be ignored until route.ts is updated. A 401 surfaces below.
          // Track: apps/web/app/api/assistant/message/route.ts
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(bodyParse.data),
        signal: ctrl.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errText =
          res.status === 401
            ? "Sesi tidak dikenali server (401). Server mungkin belum mendukung Bearer token — hubungi admin."
            : `Server error ${res.status}: ${await res.text().catch(() => "")}`;
        updateLastAssistant((m) => ({
          ...m,
          streaming: false,
          error: errText,
        }));
        return;
      }

      let accumulated = "";

      await consumeNdjson(
        res,
        (delta) => {
          accumulated += delta;
          updateLastAssistant((m) => ({ ...m, content: accumulated }));
        },
        (citations, sid) => {
          if (sid) sessionIdRef.current = sid;
          const finalCitations =
            citations.length > 0 ? citations : extractCitations(accumulated);
          updateLastAssistant((m) => ({
            ...m,
            streaming: false,
            content: accumulated,
            citations: finalCitations,
          }));
        },
        (errMsg) => {
          updateLastAssistant((m) => ({
            ...m,
            streaming: false,
            error: errMsg,
          }));
        },
      );
    } catch (e) {
      clearTimeout(timer);
      const isOffline =
        !onlineManager.isOnline() ||
        (e instanceof Error && e.name === "AbortError");

      if (isOffline) {
        await enqueue(
          queueStorage,
          projectId,
          { mode: "tanya", text, ts: Date.now() },
          genId,
        );
        updateLastAssistant((m) => ({
          ...m,
          streaming: false,
          queued: true,
          content: text,
        }));
      } else {
        updateLastAssistant((m) => ({
          ...m,
          streaming: false,
          error:
            e instanceof Error ? e.message : "Terjadi kesalahan tak terduga",
        }));
      }
    }
  }

  // ── Catat send ──────────────────────────────────────────────────────────────

  async function sendCatat(text: string, file?: AttachedFile) {
    if (!WEB_BASE_URL) return;

    const aid = genId();
    appendMessage({
      id: aid,
      role: "assistant",
      content: "",
      streaming: true,
      citations: [],
    });

    const token = await getBearerToken();
    if (!token) {
      updateLastAssistant((m) => ({
        ...m,
        streaming: false,
        error: "Tidak ada sesi aktif — silakan masuk kembali.",
      }));
      return;
    }

    const bodyParse = CaptureRequest.safeParse({
      projectId,
      text,
      file: file ? { name: file.name, mime: file.mime, size: file.size } : undefined,
    });

    if (!bodyParse.success) {
      updateLastAssistant((m) => ({
        ...m,
        streaming: false,
        error: "Permintaan tidak valid: " + (bodyParse.error.issues[0]?.message ?? ""),
      }));
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FIRST_BYTE_TIMEOUT_MS);

    try {
      const res = await fetch(`${WEB_BASE_URL}/api/assistant/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // OPEN QUESTION (Bearer auth): same as Tanya route above.
          // Track: apps/web/app/api/assistant/capture/route.ts
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(bodyParse.data),
        signal: ctrl.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errText =
          res.status === 401
            ? "Sesi tidak dikenali server (401). Server mungkin belum mendukung Bearer token — hubungi admin."
            : `Server error ${res.status}: ${await res.text().catch(() => "")}`;
        updateLastAssistant((m) => ({
          ...m,
          streaming: false,
          error: errText,
        }));
        return;
      }

      const json = (await res.json()) as
        | { ok: true; proposal: Proposal }
        | { ok: false; error: string };

      if (!json.ok) {
        updateLastAssistant((m) => ({
          ...m,
          streaming: false,
          error: json.error,
        }));
        return;
      }

      // Replace the streaming placeholder with a proposal message
      const proposalId = genId();
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.id === aid);
        if (idx >= 0) {
          next.splice(idx, 1, {
            id: proposalId,
            role: "proposal",
            proposal: json.proposal,
          });
        }
        return next;
      });
    } catch (e) {
      clearTimeout(timer);
      const isOffline =
        !onlineManager.isOnline() ||
        (e instanceof Error && e.name === "AbortError");

      if (isOffline) {
        await enqueue(
          queueStorage,
          projectId,
          { mode: "catat", text, ts: Date.now() },
          genId,
        );
        updateLastAssistant((m) => ({
          ...m,
          streaming: false,
          queued: true,
          content: text,
        }));
      } else {
        updateLastAssistant((m) => ({
          ...m,
          streaming: false,
          error:
            e instanceof Error ? e.message : "Terjadi kesalahan tak terduga",
        }));
      }
    }
  }

  // ── Drain offline queue on reconnect ─────────────────────────────────────────

  const drainQueue = useCallback(async () => {
    if (drainInFlightRef.current || !onlineManager.isOnline() || !WEB_BASE_URL) return;
    drainInFlightRef.current = true;
    try {
      const items = await drain(queueStorage, projectId, Date.now());
      for (const item of items) {
        try {
          if (item.mode === "tanya") {
            await sendTanya(item.text);
          } else {
            await sendCatat(item.text);
          }
          await remove(queueStorage, projectId, item.id);
        } catch {
          // Individual drain failure — keep item in queue for next reconnect
        }
      }
    } finally {
      drainInFlightRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    // Drain on mount
    void drainQueue();
    // Subscribe to reconnect events
    const unsub = onlineManager.subscribe(() => {
      if (onlineManager.isOnline()) void drainQueue();
    });
    return () => unsub();
  }, [drainQueue]);

  // ── Main send handler ──────────────────────────────────────────────────────

  async function handleSend(text: string, file?: AttachedFile) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      appendMessage({ id: genId(), role: "user", text: text || "(lampiran)" });
      if (mode === "tanya") {
        await sendTanya(text);
      } else {
        await sendCatat(text, file);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      {/* Mode toggle header */}
      <View className="border-b border-border/30 px-4 pb-2 pt-1">
        <ModeToggle mode={mode} onChange={setMode} />
      </View>

      {/* Message list */}
      <View className="flex-1">
        <MessageList messages={messages} />
      </View>

      {/* Input bar */}
      <MessageInput
        mode={mode}
        disabled={!staff}
        sending={sending}
        onSend={(text, file) => void handleSend(text, file)}
      />
    </KeyboardAvoidingView>
  );
}

// ─── NoProjectNotice ──────────────────────────────────────────────────────────

function NoProjectNotice() {
  return (
    <View className="flex-1 items-center justify-center px-6" testID="no-project-notice">
      <Text variant="heading" className="mb-2 text-center">
        Pilih proyek dulu
      </Text>
      <Text variant="muted" className="text-center leading-5">
        Belum ada proyek yang dipilih. Pilih proyek di atas untuk memulai.
      </Text>
    </View>
  );
}

// ─── AssistantTab (root export) ───────────────────────────────────────────────

/**
 * The assistant tab root.
 *
 * - Shows a notice when WEB_BASE_URL is not configured (AI is optional).
 * - Loads projects via useProjects() and shows a horizontal chip picker.
 * - Persists the selected project id in AsyncStorage (datum.assistant.projectId).
 * - Passes the resolved project id into AssistantChat; chat is disabled until
 *   a project is selected.
 */
export default function AssistantTab() {
  const { status } = useSession();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { selectedId, isRestoring, select } = useProjectSelection(projects);

  if (!WEB_BASE_URL) {
    return (
      <Screen>
        <NoBaseUrlNotice />
      </Screen>
    );
  }

  if (status === "loading") {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <Text variant="muted">Memuat…</Text>
        </View>
      </Screen>
    );
  }

  if (status === "unauthenticated") {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="muted" className="text-center">
            Silakan masuk untuk menggunakan asisten.
          </Text>
        </View>
      </Screen>
    );
  }

  // Resolved project id — null while restoring AsyncStorage or projects loading.
  const resolvedProjectId =
    !isRestoring && !projectsLoading && selectedId ? selectedId : null;

  return (
    <Screen className="px-0">
      {/* Project picker bar */}
      <View className="border-b border-border/30">
        <ProjectSwitcher
          projects={projects}
          isLoading={projectsLoading || isRestoring}
          selectedId={selectedId}
          onSelect={select}
        />
      </View>

      {resolvedProjectId ? (
        <AssistantChat projectId={resolvedProjectId} />
      ) : projectsLoading || isRestoring ? (
        // Still loading — AssistantChat not mounted yet
        <View className="flex-1 items-center justify-center">
          <Text variant="muted">Memuat…</Text>
        </View>
      ) : (
        <NoProjectNotice />
      )}
    </Screen>
  );
}
