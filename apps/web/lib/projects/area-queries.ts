// Thin re-export — source of truth moved to @datum/core.
// The two-argument signature (supabase, projectId) is preserved so existing
// page callers that inject their own server client continue to work unchanged.
export { getProjectAreas } from "@datum/core";
export type { Area } from "@datum/db";
