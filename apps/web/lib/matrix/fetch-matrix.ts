import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchMatrix as coreFetchMatrix } from "@datum/core";

// Re-export types from core so existing web importers are unbroken.
export type { MatrixData, MatrixArea, MatrixCell } from "@datum/core";

/**
 * Thin wrapper over core.fetchMatrix. Web passes its server client;
 * mobile passes its anon session client.
 */
export async function fetchMatrix(projectId: string) {
  const supabase = await createSupabaseServerClient();
  return coreFetchMatrix(supabase, projectId);
}
