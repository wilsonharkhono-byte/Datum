import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { describeAttachment, attachmentSkipReason } from "@/lib/attachments/analyze";

export const maxDuration = 300; // Fluid Compute ceiling — vision calls can be slow
const BATCH = 5;

/** Pure: validate Vercel Cron's bearer token. Exported for unit testing. */
export function isCronAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** True when the claim RPC isn't in the schema yet (migration not applied). */
export function isMissingFunctionError(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return true; // PostgREST: function not found
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("could not find the function") || msg.includes("does not exist");
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: claimed, error } = await supabase.rpc("claim_attachments_for_analysis", {
    p_limit: BATCH,
  });
  if (error) {
    // Before `supabase db push`, the claim RPC doesn't exist yet. Treat that as
    // an idle tick (200) so the cron isn't flagged failing every minute; any
    // other error is a genuine 500.
    if (isMissingFunctionError(error)) {
      console.warn("[cron/analyze-attachments] claim RPC missing — migration not applied yet");
      return NextResponse.json({ skipped: "migration_pending" });
    }
    console.error(
      `[cron/analyze-attachments] claim RPC failed: code=${error.code} message=${error.message}`,
    );
    Sentry.captureException(new Error(error.message), { extra: { code: error.code } });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = () => new Date().toISOString();
  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const att of claimed ?? []) {
    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from("card-attachments")
        .download(att.storage_path);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? "download_failed");

      const skip = attachmentSkipReason(att.mime_type, blob.size);
      if (skip) {
        await supabase
          .from("card_attachments")
          .update({ ai_status: "skipped", ai_error: skip, ai_processed_at: now() })
          .eq("id", att.id);
        skipped++;
        continue;
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { caption, model } = await describeAttachment({ bytes, mimeType: att.mime_type });
      await supabase
        .from("card_attachments")
        .update({
          ai_caption: caption,
          ai_status: "done",
          ai_model: model,
          ai_error: null,
          ai_processed_at: now(),
        })
        .eq("id", att.id);
      done++;
    } catch (e) {
      console.warn(`[cron/analyze-attachments] attachment ${att.id} failed: ${errMsg(e)}`);
      Sentry.captureException(e, { extra: { attachmentId: att.id } });
      await supabase
        .from("card_attachments")
        .update({ ai_status: "failed", ai_error: errMsg(e), ai_processed_at: now() })
        .eq("id", att.id);
      failed++;
    }
  }

  if ((claimed?.length ?? 0) > 0) {
    console.log(
      `[cron/analyze-attachments] summary: claimed=${claimed?.length ?? 0} done=${done} skipped=${skipped} failed=${failed}`,
    );
  }
  return NextResponse.json({ claimed: claimed?.length ?? 0, done, skipped, failed });
}
