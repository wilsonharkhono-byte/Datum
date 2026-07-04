/**
 * Pure helpers for /api/health/ai. Kept dependency-free (no Supabase import)
 * so the aggregation logic is unit-testable without a live client.
 */

/** Sentinel returned for a section whose query failed (e.g. column/table not
 * yet migrated on prod). Distinct from any real payload shape. */
export const UNAVAILABLE = "unavailable" as const;

export type Unavailable = typeof UNAVAILABLE;

/** One row of a Postgres `group by status` aggregate (or head-count-per-status
 * loop result) — the shape callers should map their query results into before
 * calling `summarizeStatusCounts`. */
export interface StatusCountRow {
  status: string;
  count: number;
}

/**
 * Build a status -> count map, zero-filling every status in `knownStatuses`
 * even if no rows matched, and ignoring any row whose status isn't in the
 * known list (defensive against enum drift between code and schema).
 */
export function summarizeStatusCounts(
  rows: StatusCountRow[],
  knownStatuses: readonly string[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const status of knownStatuses) {
    result[status] = 0;
  }
  for (const row of rows) {
    if (row.status in result) {
      result[row.status] = row.count;
    }
  }
  return result;
}
