"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useProjects } from "@/lib/query/hooks";
import type { ProjectListItem, DevelopmentOption } from "@/lib/projects/queries";
import { filterProjects, groupProjects } from "@/lib/projects/grouping";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { SearchIcon } from "@/components/icons/Icon";

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "design", label: "Desain" },
  { value: "construction", label: "Konstruksi" },
  { value: "finishing", label: "Finishing" },
  { value: "handover", label: "Serah terima" },
  { value: "closed", label: "Selesai" },
];

export function ProjectsList({
  initialProjects, developments,
}: { initialProjects: ProjectListItem[]; developments: DevelopmentOption[] }) {
  const { data: projects } = useProjects(initialProjects);
  const list = projects ?? initialProjects;

  const params = useSearchParams();
  const devFilter = params.get("dev");

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    let scoped = list;
    if (devFilter) scoped = scoped.filter((p) => p.development_id === devFilter);
    return groupProjects(filterProjects(scoped, { query, status }));
  }, [list, devFilter, query, status]);

  const total = groups.reduce((n, g) => n + g.projects.length, 0);

  return (
    <section className="grid gap-3">
      <div className="sticky top-0 z-10 -mx-1 grid gap-2 bg-[#DAD6C9]/95 px-1 py-2 backdrop-blur">
        <div className="flex items-center gap-2 rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6] px-3 py-2">
          <SearchIcon size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari proyek, klien, atau lokasi…"
            aria-label="Cari proyek"
            className="w-full bg-transparent text-sm text-[#141210] outline-none placeholder:text-[#847E78]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              aria-pressed={status === f.value}
              className={`rounded-[6px] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${
                status === f.value
                  ? "bg-[#141210] text-[#FDFAF6]"
                  : "border border-[#B5AFA8] bg-[#FDFAF6] text-[#524E49] hover:border-[#7A6B56]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-[8px] border border-dashed border-[#B5AFA8] p-6 text-sm text-[#524E49]">
          Tidak ada proyek yang cocok dengan filter.
        </div>
      ) : (
        groups.map((g) => {
          const key = g.id ?? "__ungrouped__";
          const isCollapsed = collapsed[key] ?? false;
          return (
            <div key={key} className="overflow-hidden rounded-[8px] border border-[#B5AFA8] bg-[#EFEADF]">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center justify-between bg-[#141210] px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[#FDFAF6]"
              >
                <span>{isCollapsed ? "▸" : "▾"} {g.name} · {g.projects.length}</span>
                {g.area_label ? <span className="font-medium text-[#B5AFA8]">{g.area_label}</span> : null}
              </button>
              {!isCollapsed ? (
                <div className="grid gap-2.5 p-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
                  {g.projects.map((p) => (
                    <ProjectCard key={p.id} project={p} developments={developments} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}
