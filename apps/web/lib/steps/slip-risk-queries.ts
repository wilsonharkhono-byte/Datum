import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getProjectStepSignals } from "@/lib/steps/queries";
import { summarizeProjectRisk, type ProjectRisk } from "@/lib/steps/slip-risk";

export type ProjectSlipRow = {
  project: { id: string; code: string; name: string };
  risk: ProjectRisk;
  signalCount: number;
};

const LEVEL_RANK: Record<ProjectRisk["level"], number> = { behind: 0, at_risk: 1, on_track: 2 };

/** Every RLS-visible active project, ranked by slip risk. `today` = Jakarta YYYY-MM-DD, `now` = ISO. */
export async function getProjectsSlipRisk(
  supabase: SupabaseClient<Database>,
  today: string,
  now: string,
): Promise<ProjectSlipRow[]> {
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, project_code, project_name")
    .neq("status", "closed");
  if (error) throw error;

  const rows = await Promise.all(
    (projects ?? []).map(async (p) => {
      const signals = await getProjectStepSignals(supabase, p.id, today, now);
      return {
        project: { id: p.id, code: p.project_code, name: p.project_name },
        risk: summarizeProjectRisk(signals),
        signalCount: signals.length,
      };
    }),
  );

  return rows.sort(
    (a, b) =>
      LEVEL_RANK[a.risk.level] - LEVEL_RANK[b.risk.level] ||
      b.risk.behindCount - a.risk.behindCount ||
      b.signalCount - a.signalCount,
  );
}
