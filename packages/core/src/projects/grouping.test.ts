import { describe, expect, it } from "vitest";
import { filterProjects, groupProjects } from "./grouping";
import type { ProjectListItem } from "./list";

function mk(over: Partial<ProjectListItem>): ProjectListItem {
  return {
    id: "x", project_code: "ARCH-X-1", project_name: "X 1", client_name: null,
    location: null, status: "construction", target_handover: null,
    development_id: null, development_name: null, development_area_label: null,
    development_sort_order: null, cover_image_path: null, cover_url: null, ...over,
  };
}

describe("filterProjects", () => {
  const list = [
    mk({ id: "a", project_code: "ARCH-CITRALAND-E7-20", project_name: "Citraland E7-20", client_name: "Budhi", status: "construction" }),
    mk({ id: "b", project_code: "ARCH-PAKUWON-AB1-38", project_name: "Pakuwon Ab1-38", client_name: "Heru", status: "finishing" }),
  ];
  it("matches code, name, client, location (case-insensitive)", () => {
    expect(filterProjects(list, { query: "budhi", status: "all" }).map((p) => p.id)).toEqual(["a"]);
    expect(filterProjects(list, { query: "pakuwon", status: "all" }).map((p) => p.id)).toEqual(["b"]);
  });
  it("filters by status", () => {
    expect(filterProjects(list, { query: "", status: "finishing" }).map((p) => p.id)).toEqual(["b"]);
  });
  it("returns all when query empty and status all", () => {
    expect(filterProjects(list, { query: "", status: "all" })).toHaveLength(2);
  });
});

describe("groupProjects", () => {
  it("orders groups by sort_order then name, ungrouped last", () => {
    const list = [
      mk({ id: "u", development_id: null, development_name: null }),
      mk({ id: "c", development_id: "d2", development_name: "Citraland", development_sort_order: 100 }),
      mk({ id: "p", development_id: "d1", development_name: "Pakuwon", development_sort_order: 50 }),
    ];
    const groups = groupProjects(list);
    expect(groups.map((g) => g.name)).toEqual(["Pakuwon", "Citraland", "Belum dikelompokkan"]);
    expect(groups[2]!.projects.map((p) => p.id)).toEqual(["u"]);
  });
});
