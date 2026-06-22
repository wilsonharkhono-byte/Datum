/**
 * Dual-mode Supabase client factory for API routes.
 *
 * - Web (cookie auth): no `Authorization` header → delegates to
 *   `createSupabaseServerClient()` (SSR cookie client, unchanged behaviour).
 *
 * - Mobile (Bearer auth): `Authorization: Bearer <supabase-access-token>` →
 *   creates a plain `@supabase/supabase-js` client with the **anon** key and
 *   sets `global.headers.Authorization` so PostgREST / GoTrue evaluate the JWT
 *   and apply RLS as that user.  The **service-role** key is never used here;
 *   a forged or expired token produces no authenticated user and the existing
 *   `auth.getUser()` → 401 path handles it naturally.
 *
 * Callers can replace `await createSupabaseServerClient()` with
 * `await createSupabaseClientForRequest(req)` and leave all subsequent
 * `auth.getUser()` + authz checks exactly as-is.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createSupabaseClientForRequest(
  req: Request,
): Promise<SupabaseClient<Database>> {
  const auth = req.headers.get("authorization") ?? "";

  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    return createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    );
  }

  // No Bearer header — fall back to the cookie-based server client so web
  // behaviour is completely unchanged.
  return createSupabaseServerClient();
}
