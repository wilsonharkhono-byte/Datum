/**
 * Guard for Supabase read results. A PostgREST failure sets `error` and leaves
 * `data` null — destructuring `{ data }` alone renders every dashboard as a
 * confident "empty" state when the database errors (AUDIT_CODE.md finding 2).
 *
 * Wrap the awaited result: `const { data } = must(await q, "brief.drafts")`.
 * Throws so server components hit the error boundary and react-query enters
 * its error/retry state instead of silently showing nothing.
 */
export function must<R extends { error: { message: string } | null }>(
  res: R,
  label: string,
): R {
  if (res.error) {
    throw new Error(`[db] ${label}: ${res.error.message}`);
  }
  return res;
}
