"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * A pending seed carried across navigation into the dock. Two variants:
 *  - `question`: the existing "Tanya asisten" behavior — the dock opens,
 *    posts the text as a USER message, and runs it against /api/assistant/message.
 *  - `assistant_message`: Task 4 (daily brief). The dock opens and posts the
 *    text directly as an ASSISTANT-authored first message — no request is
 *    sent, the user can just read it and ask follow-ups from there.
 */
export type PendingSeed =
  | { kind: "question"; text: string }
  | { kind: "assistant_message"; text: string };

type AssistantContextValue = {
  /** Back-compat convenience: seeds a `question` (same behavior as before). */
  openAndAsk: (prompt: string) => void;
  /** Seeds an assistant-authored first message (Task 4: daily brief). */
  openWithMessage: (text: string) => void;
  pendingSeed: PendingSeed | null;
  clearPending: () => void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [pendingSeed, setPendingSeed] = useState<PendingSeed | null>(null);
  const openAndAsk = useCallback((prompt: string) => setPendingSeed({ kind: "question", text: prompt }), []);
  const openWithMessage = useCallback((text: string) => setPendingSeed({ kind: "assistant_message", text }), []);
  const clearPending = useCallback(() => setPendingSeed(null), []);
  return (
    <AssistantContext.Provider value={{ openAndAsk, openWithMessage, pendingSeed, clearPending }}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within an AssistantProvider");
  return ctx;
}
