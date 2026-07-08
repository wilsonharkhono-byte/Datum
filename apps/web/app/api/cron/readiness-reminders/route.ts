/**
 * Daily readiness-reminder cron — /api/cron/readiness-reminders
 *
 * Runs at 08:00 WIB (01:00 UTC) every day. Computes schedule-aware step
 * signals across all active projects and writes proactive in-app notifications
 * to the responsible staff members, deduplicating against unread notifications
 * from the last 7 days.
 *
 * Auth: Vercel Cron Bearer (CRON_SECRET). Same pattern as analyze-attachments.
 *
 * Push delivery (Expo sendExpoPush) is NOT wired here — it lives on the mobile
 * branch. Once that branch merges, call sendExpoPush on each written intent
 * here after the INSERT succeeds.
 */

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildReadinessReminders, READINESS_REMINDER_KIND } from "@/lib/steps/reminders";
import type { ReminderIntent } from "@/lib/steps/reminders";
import { sendExpoPush } from "@/lib/notifications/push-send";
import { sendWhatsAppTemplate, WHATSAPP_TEMPLATES } from "@/lib/notifications/whatsapp-send";

export const runtime = "nodejs";
export const maxDuration = 300;

const LOG = "[cron/readiness-reminders]";

/** Validate Vercel Cron's bearer token. Exported for unit testing. */
export function isCronAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** True when a table/function doesn't exist yet (migration not applied). */
export function isMigrationPendingError(
  error: { code?: string | null; message?: string | null } | null | unknown,
): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "PGRST202") return true;
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("could not find") ||
    msg.includes("relation") ||
    msg.includes("pgrst202")
  );
}

/**
 * Compute Asia/Jakarta today as YYYY-MM-DD.
 * Jakarta is UTC+7 (no DST).
 */
export function jakartaToday(): string {
  const now = new Date();
  // Offset Jakarta time: UTC+7 = +420 minutes
  const jakartaMs = now.getTime() + 7 * 60 * 60 * 1000;
  return new Date(jakartaMs).toISOString().slice(0, 10);
}

// ─── Dedup helper ─────────────────────────────────────────────────────────────

/**
 * For a single intent, check if an unread matching notification already exists
 * in the last 7 days. Matching is by recipient_staff_id + link + kind + read_at IS NULL.
 *
 * Returns true if we should SKIP the insert (already notified, not yet read).
 *
 * Exported for unit testing.
 */
export async function isAlreadyNotified(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  intent: Pick<ReminderIntent, "recipientStaffId" | "link" | "kind">,
  sevenDaysAgo: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("notifications")
    .select("id")
    .eq("recipient_staff_id", intent.recipientStaffId)
    .eq("link", intent.link)
    .eq("kind", intent.kind)
    .is("read_at", null)
    .gte("created_at", sevenDaysAgo)
    .limit(1);

  if (error) {
    // On error, err on the side of not duplicating — treat as already notified.
    console.warn(`${LOG} dedup check failed: ${error.message}`);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const today = jakartaToday();
  const now = new Date().toISOString();

  // Compute the dedup window: 7 days ago in ISO format.
  const sevenDaysAgo = new Date(
    new Date().getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  let buildResult: Awaited<ReturnType<typeof buildReadinessReminders>>;

  try {
    buildResult = await buildReadinessReminders(admin, today, now);
  } catch (err) {
    if (isMigrationPendingError(err)) {
      console.warn(`${LOG} area_steps / trade_steps tables missing — migration not applied yet`);
      return NextResponse.json({ skipped: "migration_pending" });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} buildReadinessReminders failed: ${msg}`);
    Sentry.captureException(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { intents, projectsScanned, signalsFound } = buildResult;

  let written = 0;
  let skippedDup = 0;
  let failed = 0;
  let waSent = 0;

  for (const intent of intents) {
    try {
      const alreadyDone = await isAlreadyNotified(admin, intent, sevenDaysAgo);
      if (alreadyDone) {
        skippedDup++;
        continue;
      }

      const { error: insertErr } = await admin.from("notifications").insert({
        recipient_staff_id: intent.recipientStaffId,
        kind: READINESS_REMINDER_KIND,
        summary: intent.message,
        link: intent.link,
        project_id: intent.projectId,
      });

      if (insertErr) {
        console.warn(`${LOG} insert failed for ${intent.dedupeKey}: ${insertErr.message}`);
        failed++;
      } else {
        written++;
        await sendExpoPush([intent.recipientStaffId], {
          title: "Pengingat kesiapan",
          body: intent.message,
          data: { link: intent.link },
        });
        await sendWhatsAppTemplate(admin, [intent.recipientStaffId], {
          template: WHATSAPP_TEMPLATES.readinessReminder,
          bodyParams: [intent.message],
          dedupeKey: intent.dedupeKey,
        });
        waSent++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG} error processing intent ${intent.dedupeKey}: ${msg}`);
      Sentry.captureException(err, { extra: { dedupeKey: intent.dedupeKey } });
      failed++;
    }
  }

  console.log(
    `${LOG} summary: projects_scanned=${projectsScanned} signals_found=${signalsFound} ` +
    `intents=${intents.length} written=${written} skipped_dup=${skippedDup} failed=${failed} wa_sent=${waSent}`,
  );

  return NextResponse.json({
    projectsScanned,
    signalsFound,
    intents: intents.length,
    written,
    skippedDup,
    failed,
  });
}
