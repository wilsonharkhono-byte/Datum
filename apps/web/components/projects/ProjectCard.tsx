"use client";
import Link from "next/link";
import Image from "next/image";
import type { ProjectListItem, DevelopmentOption } from "@/lib/projects/queries";
import { developmentTint } from "@/lib/projects/tint";
import { ProjectEditDialog } from "@/components/projects/ProjectEditDialog";

const statusLabel: Record<string, string> = {
  design: "Desain", construction: "Konstruksi", finishing: "Finishing",
  handover: "Serah terima", closed: "Selesai",
};

// Trailing unit token (e.g. "E7-20") for the fallback cover.
function unitCode(p: ProjectListItem): string {
  const tokens = p.project_name.trim().split(/\s+/);
  const last = tokens[tokens.length - 1] ?? "";
  return /[0-9/]/.test(last) ? last : p.project_code;
}

export function ProjectCard({
  project, developments,
}: { project: ProjectListItem; developments: DevelopmentOption[] }) {
  const tint = developmentTint(project.development_name ?? "");
  return (
    <div className="overflow-hidden rounded-[8px] border border-[#B5AFA8] bg-[#FDFAF6]">
      <Link href={`/project/${project.project_code}`} className="block transition-opacity hover:opacity-90">
        <div className="relative h-24 w-full" style={{ backgroundColor: tint.bg }}>
          {project.cover_url ? (
            <Image src={project.cover_url} alt="" fill sizes="(max-width:640px) 100vw, 33vw" className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center px-2 text-center text-base font-bold uppercase tracking-[0.06em]" style={{ color: tint.fg }}>
              {unitCode(project)}
            </div>
          )}
        </div>
        <div className="p-3">
          <div className="text-[13px] font-bold uppercase leading-tight tracking-[0.04em] text-[#141210]">
            {project.project_code}
          </div>
          <div className="mt-0.5 text-sm text-[#524E49]">{project.project_name}</div>
          <div className="mt-1 text-xs text-[#847E78]">Client: {project.client_name ?? "-"}</div>
          <span className="mt-2 inline-block rounded-[5px] bg-[#B29F86]/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7A6B56]">
            {statusLabel[project.status] ?? project.status}
          </span>
        </div>
      </Link>
      <div className="border-t border-[#EAE4DA] px-3 py-2">
        <ProjectEditDialog project={project} developments={developments} />
      </div>
    </div>
  );
}
