import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

/**
 * Service-role Supabase client. Bypasses RLS — only use after the caller has
 * been verified at the application layer (e.g., via requirePrincipalOrAdmin).
 * Never expose to the browser. Never import from a client component.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY tidak tersedia. Tambahkan ke .env untuk fitur admin (undang staf, dll).",
    );
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
