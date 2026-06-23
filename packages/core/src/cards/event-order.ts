/**
 * Canonical ordering for append-only card events when deciding which entry
 * is "latest" (supersession). occurred_at alone ties for any two same-day
 * manual entries (date-only input → midnight timestamp), so fall back to
 * created_at, then id, for a deterministic total order shared by readiness
 * rules, board labels, and the brief.
 */
export type OrderableEvent = {
  occurred_at: string | null;
  created_at?: string | null;
  id?: string | null;
};

export function compareEventTime(a: OrderableEvent, b: OrderableEvent): number {
  const occ = (a.occurred_at ?? "").localeCompare(b.occurred_at ?? "");
  if (occ !== 0) return occ;
  const cre = (a.created_at ?? "").localeCompare(b.created_at ?? "");
  if (cre !== 0) return cre;
  return (a.id ?? "").localeCompare(b.id ?? "");
}
