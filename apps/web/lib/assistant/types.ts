// apps/web/lib/assistant/types.ts
import { z } from "zod";

export const ChatRequest = z.object({
  projectId: z.string().uuid(),
  question: z.string().min(1).max(2000),
  sessionId: z.string().uuid().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export type ChatResponse = {
  sessionId: string | null;
  answer: string;
  citations: { cardId: string; eventIds: string[] }[];
};
