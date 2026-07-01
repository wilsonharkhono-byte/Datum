import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processPendingStepInference } from "@/lib/steps/run-inference";
import { isCronAuthorized } from "@/lib/cron/auth";

export const maxDuration = 300;
const BATCH = 5;

export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  try {
    const r = await processPendingStepInference(admin, BATCH);
    if ("migrationPending" in r) {
      return NextResponse.json({ skipped: "migration_pending" });
    }
    return NextResponse.json(r);
  } catch (e) {
    Sentry.captureException(e, { extra: { where: "cron/infer-card-steps" } });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
