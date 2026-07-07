import Link from "next/link";
import { getProjectBySlug } from "@datum/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectStepActivity, groupByDay } from "@/lib/activity/step-activity";

const CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Belum mulai", cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" },
  in_progress: { label: "Berjalan", cls: "bg-[var(--flag-info-bg)] text-[var(--flag-info)]" },
  blocked: { label: "Terblokir", cls: "bg-[var(--flag-critical-bg)] text-[var(--flag-critical)]" },
  done: { label: "Selesai", cls: "bg-[var(--flag-ok-bg)] text-[var(--flag-ok)]" },
};

export default async function ProjectActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  const project = await getProjectBySlug(supabase, slug);
  if (!project) {
    return <div className="p-6 text-[var(--flag-critical)]">Proyek tidak ditemukan: {slug}</div>;
  }
  const items = await getProjectStepActivity(supabase, project.id);
  const groups = groupByDay(items);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Link href={`/project/${project.project_code}`} className="text-xs text-[var(--text-muted)] hover:underline">← {project.project_code} Board</Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">Aktivitas Langkah</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">50 update langkah terbaru di proyek ini.</p>

      {groups.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-[var(--border)] p-6 text-center text-sm italic text-[var(--text-secondary)]">
          Belum ada aktivitas langkah.
        </div>
      ) : null}

      {groups.map((g) => (
        <section key={g.day} className="mt-6">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--sand-dark)]">{g.day} ({g.items.length})</h2>
          <ol className="space-y-2">
            {g.items.map((it) => {
              const chip = CHIP[it.status] ?? { label: it.status, cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" };
              return (
                <li key={it.id} className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip.cls}`}>{chip.label}</span>
                    <span className="text-[var(--foreground)]">{it.areaName} · {it.stepName}</span>
                    {it.percentComplete !== null ? <span className="text-[10px] text-[var(--text-muted)]">{it.percentComplete}%</span> : null}
                    <span className="flex-1" />
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {new Date(it.occurredAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                      {it.authorName ? ` · ${it.authorName}` : ""}
                    </span>
                  </div>
                  {it.note ? <p className="mt-1 text-[12px] text-[var(--foreground)]">{it.note}</p> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
