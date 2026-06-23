import type { DatumClient } from "../client";

// ─── Type ─────────────────────────────────────────────────────────────────────

/**
 * Project fields needed by the settings shell + info form.
 * Mirrors the select in apps/web/app/(app)/project/[slug]/settings/page.tsx.
 */
export type ProjectSettingsRow = {
  id: string;
  project_code: string;
  project_name: string;
  client_name: string | null;
  location: string | null;
  status: string;
  target_handover: string | null;
  kickoff_date: string | null;
};

// ─── Read helper ──────────────────────────────────────────────────────────────

/**
 * Fetch a project by its slug (project_code, case-insensitive via toUpperCase).
 * Returns null when not found.
 */
export async function getProjectBySlug(
  supabase: DatumClient,
  slug: string,
): Promise<ProjectSettingsRow | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, project_code, project_name, client_name, location, status, target_handover, kickoff_date")
    .eq("project_code", slug.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectSettingsRow | null) ?? null;
}
