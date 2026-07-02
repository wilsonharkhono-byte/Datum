import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectStepActivity, groupByDay, type StepActivityItem } from "@/lib/activity/step-activity";

const CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Belum mulai", cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" },
  in_progress: { label: "Berjalan", cls: "bg-blue-100 text-blue-800" },
  blocked: { label: "Terblokir", cls: "bg-red-100 text-red-800" },
  done: { label: "Selesai", cls: "bg-green-100 text-green-800" },
};

/** "Asisten AI" for AI-authored items with no human author; otherwise the human's name (may be null). */
function itemAuthorLabel(it: Pick<StepActivityItem, "source" | "authorName">): string | null {
  if (it.source === "ai") return it.authorName ?? "Asisten AI";
  return it.authorName;
}

/** Confidence 0–1 → fixed 2-decimal display string, null when absent. */
function itemConfidenceLabel(confidence: number | null): string | null {
  if (confidence === null) return null;
  return confidence.toFixed(2);
}

/** href for "dari kartu →", null when there's no resolvable card link. */
function itemCardLinkHref(cardLink: StepActivityItem["cardLink"]): string | null {
  if (!cardLink) return null;
  return `/project/${cardLink.projectCode}/cards/${cardLink.cardSlug}`;
}

export default async function ProjectActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("projects").select("id, project_code, project_name").eq("project_code", slug.toUpperCase()).maybeSingle();
  if (!project) {
    return <div className="p-6 text-[var(--flag-critical)]">Proyek tidak ditemukan: {slug}</div>;
  }
  const items = await getProjectStepActivity(supabase, project.id);
  const groups = groupByDay(items);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Link href={`/project/${project.project_code}`} className="text-xs text-[var(--text-muted)] hover:underline">← {project.project_code} Board</Link>
      <h1 className="mt-2 text-2xl font-semibold text-[#141210]">Aktivitas Langkah</h1>
      <p className="mt-1 text-sm text-[#524E49]">50 update langkah terbaru di proyek ini.</p>

      {groups.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-[#B5AFA8] p-6 text-center text-sm italic text-[#524E49]">
          Belum ada aktivitas langkah.
        </div>
      ) : null}

      {groups.map((g) => (
        <section key={g.day} className="mt-6">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7A6B56]">{g.day} ({g.items.length})</h2>
          <ol className="space-y-2">
            {g.items.map((it) => {
              const chip = CHIP[it.status] ?? { label: it.status, cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" };
              const isAi = it.source === "ai";
              const author = itemAuthorLabel(it);
              const confidence = itemConfidenceLabel(it.confidence);
              const href = itemCardLinkHref(it.cardLink);
              return (
                <li key={it.id} className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip.cls}`}>{chip.label}</span>
                    {isAi ? (
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                        AI
                      </span>
                    ) : null}
                    <span className="text-[var(--foreground)]">{it.areaName} · {it.stepName}</span>
                    {it.percentComplete !== null ? <span className="text-[10px] text-[var(--text-muted)]">{it.percentComplete}%</span> : null}
                    <span className="flex-1" />
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {new Date(it.occurredAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                      {author ? ` · ${author}` : ""}
                      {confidence ? ` · ${confidence}` : ""}
                    </span>
                    {href ? (
                      <Link href={href} className="text-[10px] text-[var(--sand-dark)] underline hover:text-[var(--foreground)]">
                        dari kartu →
                      </Link>
                    ) : null}
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
