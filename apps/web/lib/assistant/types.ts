// Re-export from @datum/core — single source of truth shared with mobile.
export { ChatRequest } from "@datum/core";
export type { ChatRequest as ChatRequestType, Proposal } from "@datum/core";

export type ChatResponse = {
  sessionId: string | null;
  answer: string;
  citations: { cardId: string; eventIds: string[] }[];
};

// Confirm-gated action proposal (Task 3). Hand-duplicated (not imported)
// from the zod-inferred type in actions.ts — actions.ts has `import
// "server-only"`, and this codebase has already been bitten once by a
// `export type` re-export from a server-only/"use server" module breaking
// bundling at runtime in a way `next build`/tsc don't catch (see
// d1a2ae8 in git history). A tiny duplicated type here is cheap insurance;
// keep the two shapes in sync if the action schema changes.
export type ActionProposalType =
  | { type: "remind"; recipientRole?: string; staffName?: string; message: string; link?: string }
  | { type: "update_step"; areaName: string; stepName: string; status: "in_progress" | "blocked" | "done"; note?: string }
  | { type: "record_decision"; cardSlug?: string; question?: string; outcome: string };
