/**
 * NDJSON wire-protocol helpers for the DATUM assistant streaming API.
 *
 * Pure — no I/O, no storage, no React, no Next.js.
 * Used by the web message route AND the mobile NDJSON reader.
 */

// ─── Wire types ───────────────────────────────────────────────────────────────

export type Citation = { cardId: string; eventIds: string[] };

export type AssistantStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      sessionId: string | null;
      citations: Citation[];
      usage: { input_tokens: number; output_tokens: number };
      /**
       * Confirm-gated action proposal (Phase 3 Task 3), already parsed +
       * validated server-side, or null when the reply had no (valid) action
       * tail. Left as `unknown` here — the concrete zod schema for the three
       * action types lives in apps/web/lib/assistant/actions.ts (web-only,
       * since the executors need web-only queries); core only needs to know
       * the wire shape exists so it round-trips through parseStreamLine.
       */
      action: unknown;
    }
  | { type: "error"; message: string };

// ─── parseStreamLine ──────────────────────────────────────────────────────────

/**
 * Parse one NDJSON line from the assistant stream.
 * Returns null for blank lines or lines that fail to parse / don't match a
 * known shape — the caller should skip nulls and continue reading.
 */
export function parseStreamLine(line: string): AssistantStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const ev = obj as Record<string, unknown>;
  if (ev.type === "delta" && typeof ev.text === "string") {
    return { type: "delta", text: ev.text };
  }
  if (ev.type === "done") {
    return {
      type: "done",
      sessionId: typeof ev.sessionId === "string" ? ev.sessionId : null,
      citations: Array.isArray(ev.citations)
        ? (ev.citations as unknown[]).filter(isCitation)
        : [],
      usage:
        typeof ev.usage === "object" && ev.usage !== null
          ? {
              input_tokens:
                typeof (ev.usage as Record<string, unknown>).input_tokens === "number"
                  ? ((ev.usage as Record<string, unknown>).input_tokens as number)
                  : 0,
              output_tokens:
                typeof (ev.usage as Record<string, unknown>).output_tokens === "number"
                  ? ((ev.usage as Record<string, unknown>).output_tokens as number)
                  : 0,
            }
          : { input_tokens: 0, output_tokens: 0 },
      action: "action" in ev ? ev.action : null,
    };
  }
  if (ev.type === "error" && typeof ev.message === "string") {
    return { type: "error", message: ev.message };
  }
  return null;
}

function isCitation(v: unknown): v is Citation {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.cardId === "string" &&
    Array.isArray(c.eventIds) &&
    (c.eventIds as unknown[]).every((e) => typeof e === "string")
  );
}

// ─── extractCitations ─────────────────────────────────────────────────────────

/**
 * Extract citation tokens from an assistant answer string.
 * Best-effort: each [event:UUID] is attached to the last [card:UUID] seen
 * before it. Moved verbatim from apps/web/lib/assistant/anthropic.ts.
 */
export function extractCitations(answer: string): Citation[] {
  const map = new Map<string, Set<string>>();
  const cardRe = /\[card:([0-9a-f-]{36})\]/gi;
  const eventRe = /\[event:([0-9a-f-]{36})\]/gi;
  for (const m of answer.matchAll(cardRe)) {
    if (!map.has(m[1]!)) map.set(m[1]!, new Set());
  }
  for (const m of answer.matchAll(eventRe)) {
    const card = [...map.keys()][map.size - 1]; // best-effort: attach to last mentioned card
    if (card) map.get(card)!.add(m[1]!);
  }
  return [...map.entries()].map(([cardId, eventIds]) => ({
    cardId,
    eventIds: [...eventIds],
  }));
}

// ─── stripCitationTokens ──────────────────────────────────────────────────────

/**
 * Remove complete citation tokens from visible text.
 * A partially-arrived token (mid-stream) stays visible until its closing
 * bracket arrives — keep that behaviour by only stripping complete tokens.
 * Moved verbatim from apps/web/components/chat/MessageList.tsx.
 */
export function stripCitationTokens(text: string): string {
  return text.replace(/\s*\[(?:card|event):[0-9a-f-]{36}\]/gi, "");
}

// ─── stripActionTail ────────────────────────────────────────────────────────

/**
 * Remove a confirm-gated action tail (`<action>{json}</action>`, Phase 3
 * Task 3) from text meant for display. Isomorphic — used by the web message
 * route to strip before persisting/citing, and directly by any client
 * (mobile) that renders the raw accumulated stream text and hasn't (yet)
 * built its own action-chip UI, so a raw `<action>` tag never leaks into a
 * chat bubble on any platform.
 *
 * Truncates at the FIRST `<action>` occurrence and drops everything after —
 * this is deliberately more aggressive than a token-strip: an action tail is
 * always meant to be the last thing in a reply, so anything from the first
 * open tag onward (closed or not, valid JSON or not) is presentation-only
 * plumbing, never message content.
 */
export function stripActionTail(text: string): string {
  const idx = text.indexOf("<action>");
  if (idx === -1) return text;
  return text.slice(0, idx).trimEnd();
}
