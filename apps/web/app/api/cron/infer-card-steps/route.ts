import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processPendingStepInference } from "@/lib/steps/run-inference";
import { recomputeProjectGatesSystem } from "@/lib/gates/recompute-system";
import { isCronAuthorized } from "@/lib/cron/auth";

export const maxDuration = 300;
const BATCH = 5;
/** Cap projects recomputed per tick — the backstop is for the rare dropped
    after() callback, not routine load; anything left picks up next tick. */
const STALE_PROJECT_CAP = 5;

/** Backstop for gate-cell freshness: the after() recomputes on card events and
    area-link changes normally keep area_gate_status fresh, but a killed
    function instance can drop one. This sweeps projects that still have
    stale=true cells so drift lasts ≤ one cron tick instead of forever. */
async function recomputeStaleProjects(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<{ staleProjectsRecomputed: number }> {
  const { data: staleCells, error } = await admin
    .from("area_gate_status")
    .select("project_id")
    .eq("stale", true)
    .limit(500);
  if (error) throw new Error(`stale scan: ${error.message}`);
  const projectIds = [...new Set((staleCells ?? []).map((c) => c.project_id))]
    .slice(0, STALE_PROJECT_CAP);
  if (projectIds.length === 0) return { staleProjectsRecomputed: 0 };

  const { data: projects, error: pErr } = await admin
    .from("projects")
    .select("id, project_code")
    .in("id", projectIds);
  if (pErr) throw new Error(`stale project lookup: ${pErr.message}`);
  for (const p of projects ?? []) {
    const r = await recomputeProjectGatesSystem(p.id, p.project_code);
    if (!r.ok) {
      Sentry.captureException(new Error(r.error), {
        extra: { where: "cron/infer-card-steps.staleRecompute", projectId: p.id },
      });
    }
  }
  return { staleProjectsRecomputed: (projects ?? []).length };
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  try {
    const r = await processPendingStepInference(admin, BATCH);
    // Stale-gate backstop runs even when inference has nothing to do — its
    // failure must not fail the inference response, only report to Sentry.
    let stale = { staleProjectsRecomputed: 0 };
    try {
      stale = await recomputeStaleProjects(admin);
    } catch (e) {
      Sentry.captureException(e, { extra: { where: "cron/infer-card-steps.staleRecompute" } });
    }
    if ("migrationPending" in r) {
      return NextResponse.json({ skipped: "migration_pending", ...stale });
    }
    return NextResponse.json({ ...r, ...stale });
  } catch (e) {
    Sentry.captureException(e, { extra: { where: "cron/infer-card-steps" } });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
