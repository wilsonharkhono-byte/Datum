/**
 * recompute-system.ts
 *
 * Server-only module (NOT "use server") — deliberately split out of
 * lib/gates/recompute.ts (a Server Actions file). Everything in a "use
 * server" file is a client-callable RPC endpoint by default; a function that
 * uses the service-role admin client + skipAuthCheck must never live there,
 * even if no client currently imports it, because any future client import
 * would mint it as an unauthenticated action. Mirrors the precedent in
 * lib/projects/staff-core.ts (admin-client logic kept out of "use server"
 * files) and the "server-only" guard used by lib/supabase/admin.ts.
 */
import "server-only";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recomputeProjectGates as coreRecomputeProjectGates } from "@datum/core";
import type { RecomputeResult } from "@/lib/gates/recompute";

/**
 * System-context variant for use inside `after()` background callbacks that
 * run without an end-user cookie session (e.g. post-inference gate refresh
 * using the service-role admin client). Skips the getUser() guard — the
 * admin client already bypasses RLS, so that check would always fail here.
 * Never call this from a path driven directly by end-user request input.
 */
export async function recomputeProjectGatesSystem(
  projectId:   string,
  projectCode: string,
): Promise<RecomputeResult> {
  const admin = createSupabaseAdminClient();
  const result = await coreRecomputeProjectGates(admin, projectId, projectCode, { skipAuthCheck: true });
  if (result.ok) {
    revalidatePath(`/project/${projectCode}/schedule`);
  }
  return result;
}
