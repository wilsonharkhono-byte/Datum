/**
 * /api/health/ai — operational visibility into the AI pipelines.
 *
 * Auth: Vercel Cron Bearer (CRON_SECRET), same as the crons. Not meant for
 * browser/staff use — it's a cheap dashboard-by-curl for checking whether
 * attachment captioning, card->step inference, and readiness reminders are
 * actually running in prod.
 *
 * Each section is independently try/caught: on a fresh prod deploy that
 * hasn't had `supabase db push` run yet, a missing column/table degrades
 * that section to "unavailable" instead of 500ing the whole endpoint.
 */

import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { summarizeStatusCounts, UNAVAILABLE, type Unavailable } from "@/lib/cron/health";

export const runtime = "nodejs";

const ATTACHMENT_AI_STATUSES = ["pending", "processing", "done", "failed", "skipped"] as const;
const STEP_INFERENCE_STATUSES = ["pending", "processing", "done", "failed", "skipped"] as const;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Cheap per-status count via head+count queries (no row bodies fetched).
 * One request per known status value — small, bounded fan-out. `countFor`
 * is a per-call-site closure so the Supabase query builder's table/column
 * types stay concrete (avoids widening `.eq()` to a union of every table).
 */
async function countByStatus(
  statuses: readonly string[],
  countFor: (
    status: string,
  ) => PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<Record<string, number>> {
  const rows = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await countFor(status);
      if (error) throw new Error(error.message);
      return { status, count: count ?? 0 };
    }),
  );
  return summarizeStatusCounts(rows, statuses);
}

async function getAttachmentsSection(
  admin: AdminClient,
): Promise<Record<string, number> | Unavailable> {
  try {
    return await countByStatus(ATTACHMENT_AI_STATUSES, (status) =>
      admin
        .from("card_attachments")
        .select("*", { count: "exact", head: true })
        .eq("ai_status", status as (typeof ATTACHMENT_AI_STATUSES)[number]),
    );
  } catch (e) {
    console.warn(`[health/ai] attachments section unavailable: ${errMsg(e)}`);
    return UNAVAILABLE;
  }
}

async function getStepInferenceSection(
  admin: AdminClient,
): Promise<Record<string, number> | Unavailable> {
  try {
    // No `as (typeof STEP_INFERENCE_STATUSES)[number]` cast here (unlike
    // getAttachmentsSection's ai_status above) — ai_step_status is a plain
    // text column, not a Postgres enum, so the generated Database type
    // already accepts a bare string for .eq().
    return await countByStatus(STEP_INFERENCE_STATUSES, (status) =>
      admin.from("card_events").select("*", { count: "exact", head: true }).eq("ai_step_status", status),
    );
  } catch (e) {
    console.warn(`[health/ai] step_inference section unavailable: ${errMsg(e)}`);
    return UNAVAILABLE;
  }
}

async function getNotifications7dSection(admin: AdminClient): Promise<number | Unavailable> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await admin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo);
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    console.warn(`[health/ai] notifications_7d section unavailable: ${errMsg(e)}`);
    return UNAVAILABLE;
  }
}

async function getLastAiStepEventSection(
  admin: AdminClient,
): Promise<string | null | Unavailable> {
  try {
    const { data, error } = await admin
      .from("area_step_events")
      .select("created_at")
      .eq("source", "ai")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.created_at ?? null;
  } catch (e) {
    console.warn(`[health/ai] last_ai_step_event section unavailable: ${errMsg(e)}`);
    return UNAVAILABLE;
  }
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  const [attachments, stepInference, notifications7d, lastAiStepEvent] = await Promise.all([
    getAttachmentsSection(admin),
    getStepInferenceSection(admin),
    getNotifications7dSection(admin),
    getLastAiStepEventSection(admin),
  ]);

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    attachments,
    step_inference: stepInference,
    notifications_7d: notifications7d,
    last_ai_step_event: lastAiStepEvent,
  });
}
