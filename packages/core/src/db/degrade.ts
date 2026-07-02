/**
 * Shared "missing schema, degrade gracefully" detector.
 *
 * Several read paths (area_step_events attribution columns, the
 * card_events relationship embed, etc.) need to tell the difference
 * between:
 *   - a genuinely missing column/relationship because a migration hasn't
 *     landed on this environment yet (pre `supabase db push`) — degrade to
 *     a narrower select and keep rendering, and
 *   - literally any other Postgres/PostgREST error — which must propagate
 *     as a real error, not be silently swallowed.
 *
 * Two error shapes matter:
 *   - 42703 / "column ... does not exist"  — plain Postgres undefined_column.
 *   - PGRST200 / "...relationship..."      — PostgREST reports a missing
 *     embed (e.g. `card_events:card_event_id (...)`) as a missing
 *     relationship, not a missing column, when the FK column doesn't exist.
 *
 * `allowlist` scopes this deliberately: the caller passes the exact
 * column/relationship names it is willing to treat as "missing schema,
 * degrade" for its own query (e.g. ["source", "confidence",
 * "card_event_id"]). If the error's message doesn't mention any allowlisted
 * name, this returns false even if the error LOOKS like a missing-column
 * error shape — an unrelated missing column must still throw. When the
 * error carries no message text (message is null/empty), the coded checks
 * (42703 / PGRST200) still apply on their own, matching prior behavior
 * where callers could not always inspect column names from the code alone.
 */
export function isMissingSchemaError(
  error: { code?: string | null; message?: string | null } | null,
  allowlist: readonly string[],
): boolean {
  if (!error) return false;

  const isMissingColumnCode = error.code === "42703"; // Postgres: undefined_column
  const isMissingRelationshipCode = error.code === "PGRST200"; // PostgREST: missing embed relationship

  const msg = (error.message ?? "").toLowerCase();
  const isMissingColumnMessage = msg.includes("column") && msg.includes("does not exist");
  const isMissingRelationshipMessage = msg.includes("relationship");

  const looksLikeMissingSchema =
    isMissingColumnCode || isMissingRelationshipCode || isMissingColumnMessage || isMissingRelationshipMessage;

  if (!looksLikeMissingSchema) return false;

  // No message to check names against: fall back to the coded checks alone
  // (mirrors prior behavior for errors that carry a code but no text).
  if (!msg) return isMissingColumnCode || isMissingRelationshipCode;

  return allowlist.some((name) => msg.includes(name.toLowerCase()));
}
