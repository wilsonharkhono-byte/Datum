"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type AssistantContextValue = {
  openAndAsk: (prompt: string) => void;
  pendingPrompt: string | null;
  clearPending: () => void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const openAndAsk = useCallback((prompt: string) => setPendingPrompt(prompt), []);
  const clearPending = useCallback(() => setPendingPrompt(null), []);
  return (
    <AssistantContext.Provider value={{ openAndAsk, pendingPrompt, clearPending }}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within an AssistantProvider");
  return ctx;
}
