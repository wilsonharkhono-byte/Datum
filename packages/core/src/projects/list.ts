import type { DatumClient } from "../client";
import { coverImageUrl } from "./cover";

export type ProjectListItem = {
  id: string; project_code: string; project_name: string;
  client_name: string | null; location: string | null;
  status: string; target_handover: string | null;
  development_id: string | null;
  development_name: string | null;
  development_area_label: string | null;
  development_sort_order: number | null;
  cover_image_path: string | null;
  cover_url: string | null;
};

export type DevelopmentOption = {
  id: string; name: string; area_label: string | null; sort_order: number;
};

type Row = {
  id: string; project_code: string; project_name: string;
  client_name: string | null; location: string | null;
  status: string; target_handover: string | null;
  development_id: string | null; cover_image_path: string | null;
  developments: { name: string; area_label: string | null; sort_order: number } | null;
};

export async function getProjectsList(
  supabase: DatumClient,
  coverBaseUrl: string,
): Promise<ProjectListItem[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, project_code, project_name, client_name, location, status, target_handover, development_id, cover_image_path, developments:development_id (name, area_label, sort_order)",
    )
    .order("project_code");
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    project_code: r.project_code,
    project_name: r.project_name,
    client_name: r.client_name,
    location: r.location,
    status: r.status,
    target_handover: r.target_handover,
    development_id: r.development_id,
    development_name: r.developments?.name ?? null,
    development_area_label: r.developments?.area_label ?? null,
    development_sort_order: r.developments?.sort_order ?? null,
    cover_image_path: r.cover_image_path,
    cover_url: coverImageUrl(r.cover_image_path, coverBaseUrl),
  }));
}

export async function getDevelopments(
  supabase: DatumClient,
): Promise<DevelopmentOption[]> {
  const { data, error } = await supabase
    .from("developments")
    .select("id, name, area_label, sort_order")
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []) as DevelopmentOption[];
}
