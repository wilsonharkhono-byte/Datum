"use client";
import Link from "next/link";
import { useProjects } from "@/lib/query/hooks";
import type { ProjectListItem } from "@/lib/projects/queries";
import { ProjectEditDialog } from "@/components/projects/ProjectEditDialog";

const statusLabel: Record<string, string> = {
  design: "Desain",
  construction: "Konstruksi",
  finishing: "Finishing",
  handover: "Serah terima",
  closed: "Selesai",
};

export function ProjectsList({ initialProjects }: { initialProjects: ProjectListItem[] }) {
  const { data: projects } = useProjects(initialProjects);
  const list = projects ?? initialProjects;

  return (
    <section>
      <div className="overflow-hidden rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6]">
        <div className="border-b border-[#B5AFA8] bg-[#141210] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#FDFAF6]">
          Proyek Aktif
        </div>
        <ul className="divide-y divide-[#B5AFA8]/70">
          {list.map((p) => (
            <li key={p.id} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <Link
                  href={`/project/${p.project_code}`}
                  className="block flex-1 transition-colors hover:opacity-80"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-[#141210]">
                        {p.project_code} · {p.project_name}
                      </div>
                      <div className="mt-1 text-sm leading-5 text-[#524E49]">
                        Client: {p.client_name ?? "-"}
                        {p.location && ` · ${p.location}`}
                      </div>
                    </div>
                    <span className="rounded-[5px] bg-[#B29F86]/15 px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#7A6B56]">
                      {statusLabel[p.status] ?? p.status}
                    </span>
                  </div>
                  {p.target_handover && (
                    <div className="mt-2 text-xs font-medium text-[#847E78]">
                      Target serah terima: {p.target_handover}
                    </div>
                  )}
                </Link>
                <ProjectEditDialog project={p} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
