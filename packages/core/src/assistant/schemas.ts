/**
 * Shared Zod schemas for assistant HTTP requests and the capture Proposal type.
 *
 * Pure — no I/O, no Next.js, no React, no Anthropic SDK.
 * Used by the web API routes AND the mobile client for client-side validation.
 */

import { z } from "zod";

// ─── ChatRequest ──────────────────────────────────────────────────────────────

/**
 * Body sent to POST /api/assistant/message.
 * Moved from apps/web/lib/assistant/types.ts.
 */
export const ChatRequest = z.object({
  projectId: z.string().uuid(),
  question: z.string().min(1).max(2000),
  sessionId: z.string().uuid().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

// ─── CaptureRequest ───────────────────────────────────────────────────────────

/**
 * Body sent to POST /api/assistant/capture.
 * Matches the inline `Body` schema in apps/web/app/api/assistant/capture/route.ts.
 */
export const CaptureRequest = z.object({
  projectId: z.string().uuid(),
  text: z.string().min(1).max(4000),
  file: z
    .object({
      name: z.string().min(1).max(255),
      mime: z.string().min(1).max(120),
      size: z.number().int().nonnegative().max(20_971_520), // 20 MB
    })
    .optional(),
});
export type CaptureRequest = z.infer<typeof CaptureRequest>;

// ─── Proposal ─────────────────────────────────────────────────────────────────

/**
 * The capture-route proposal shape returned from POST /api/assistant/capture
 * on { ok: true }. This is the isomorphic Proposal — it does NOT include the
 * web-only `pendingFile: File` field (mobile uses `pendingAsset` instead).
 * ProposalCard in web adds that field via a local extension.
 */
export type Proposal = {
  projectId: string;
  cardId: string;
  cardTitle: string;
  cardSlug: string;
  topicName: string;
  eventKind: string;
  payload: Record<string, unknown>;
  rationale: string;
  confidence: number;
  /** projectCode is added by the web client from the URL context. */
  projectCode?: string;
  fileMeta?: { name: string; mime: string; size: number } | null;
  areaHint?: { areaId: string; areaCode: string; areaName: string } | null;
  /** When true the commit must create a new card first (template placeholder). */
  createNew?: boolean;
  newCardTitle?: string | null;
  topicId?: string;
};
