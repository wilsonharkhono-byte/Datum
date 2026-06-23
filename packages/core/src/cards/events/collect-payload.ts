/**
 * collectPayloadFromEntries — coerce flat payload_* entries into a typed record.
 *
 * Moved from apps/web/lib/cards/mutations.ts into core so mobile can share it.
 * Pure function; no supabase; isomorphic (no DOM globals).
 *
 * Usage (web):
 *   import { collectPayloadFromEntries } from "@datum/core";
 *   const payload = collectPayloadFromEntries(formData.entries());
 *
 * Usage (mobile):
 *   const payload = collectPayloadFromEntries([["payload_amount","500000"], ...]);
 */

/** Coerce an iterable of [key, value] pairs where key starts with "payload_". */
export function collectPayloadFromEntries(
  entries: Iterable<readonly [string, unknown]>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (!key.startsWith("payload_")) continue;
    const field = key.slice("payload_".length);
    const raw = typeof value === "string" ? value : "";
    if (raw.trim() === "") continue;
    // Heuristic: amount/percent_complete/quantity → number; attendees → string[]
    if (field === "amount" || field === "percent_complete" || field === "quantity") {
      const n = Number(raw);
      if (!Number.isNaN(n)) payload[field] = n;
    } else if (field === "attendees") {
      payload[field] = raw.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      payload[field] = raw;
    }
  }
  return payload;
}
