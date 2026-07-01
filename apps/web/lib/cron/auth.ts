/** Pure: validate Vercel Cron's bearer token. */
export function isCronAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** True when the claim RPC isn't in the schema yet (migration not applied). */
export function isMissingFunctionError(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return true; // PostgREST: function not found
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("could not find the function") || msg.includes("does not exist");
}
