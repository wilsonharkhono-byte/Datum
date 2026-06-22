// Re-export from @datum/core — single source of truth shared with mobile.
export { ChatRequest } from "@datum/core";
export type { ChatRequest as ChatRequestType, Proposal } from "@datum/core";

export type ChatResponse = {
  sessionId: string | null;
  answer: string;
  citations: { cardId: string; eventIds: string[] }[];
};
