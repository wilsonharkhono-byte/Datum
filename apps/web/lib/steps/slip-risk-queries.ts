import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getProjectStepSignals } from "@/lib/steps/queries";
import { summarizeProjectRisk, type ProjectRisk } from "@/lib/steps/slip-risk";
import { getProjectForecast, type ProjectForecast } from "@/lib/steps/forecast-queries";

export type ProjectSlipRow = {
  project: { id: string; code: string; name: string };
  risk: ProjectRisk;
  signalCount: number;
  forecast: ProjectForecast;
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
      const forecast = await getProjectForecast(supabase, p.id, today);
      return {
        project: { id: p.id, code: p.project_code, name: p.project_name },
        // Forecast slip is folded into the level here (not just displayed
        // alongside it) — see slip-risk.ts's B5 docstring for why silent
        // signals + a real forecast slip must never render as "Aman".
        risk: summarizeProjectRisk(signals, forecast.slipDays),
        signalCount: signals.length,
        forecast,
      };
    }),
  );

  return rows.sort(
    (a, b) =>
      LEVEL_RANK[a.risk.level] - LEVEL_RANK[b.risk.level] ||
      b.risk.behindCount - a.risk.behindCount ||
      b.signalCount - a.signalCount ||
      (b.forecast.slipDays ?? -Infinity) - (a.forecast.slipDays ?? -Infinity),
  );
}
