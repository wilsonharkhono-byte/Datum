import type { ProjectListItem } from "./list";

export const UNGROUPED_LABEL = "Belum dikelompokkan";

export type ProjectGroup = {
  id: string | null;
  name: string;
  area_label: string | null;
  sort_order: number;
  projects: ProjectListItem[];
};

export function filterProjects(
  list: ProjectListItem[],
  opts: { query: string; status: string },
): ProjectListItem[] {
  const q = opts.query.trim().toLowerCase();
  return list.filter((p) => {
    if (opts.status !== "all" && p.status !== opts.status) return false;
    if (!q) return true;
    const hay = [p.project_code, p.project_name, p.client_name ?? "", p.location ?? ""]
      .join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export function groupProjects(list: ProjectListItem[]): ProjectGroup[] {
  const map = new Map<string | null, ProjectGroup>();
  for (const p of list) {
    const key = p.development_id;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        name: key ? (p.development_name ?? UNGROUPED_LABEL) : UNGROUPED_LABEL,
        area_label: p.development_area_label,
        sort_order: p.development_sort_order ?? Number.MAX_SAFE_INTEGER,
        projects: [],
      });
    }
    map.get(key)!.projects.push(p);
  }
  return [...map.values()].sort((a, b) => {
    if (a.id === null) return 1; // ungrouped always last
    if (b.id === null) return -1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name);
  });
}
