import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

/** The single Supabase client type every core data-access function accepts.
    Web injects its server/browser client; mobile injects its anon client. */
export type DatumClient = SupabaseClient<Database>;
