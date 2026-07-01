import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCandidateStepsForCard, inferCardEventSteps } from "@/lib/steps/infer-runner";
import { applyStepInference } from "@/lib/steps/mutations";
import { selectApplicableMatches, summarizeWorkEvent } from "@/lib/steps/infer";
import { isCronAuthorized, isMissingFunctionError } from "@/lib/cron/auth";

export const maxDuration = 300;
const BATCH = 5;
const MIN_CONFIDENCE = 0.6;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: claimed, error } = await supabase.rpc("claim_card_events_for_step_inference", {
    p_limit: BATCH,
  });
  if (error) {
    if (isMissingFunctionError(error)) {
      console.warn("[cron/infer-card-steps] claim RPC missing — migration not applied yet");
      return NextResponse.json({ skipped: "migration_pending" });
    }
    console.error(
      `[cron/infer-card-steps] claim failed: code=${error.code} message=${error.message}`,
    );
    Sentry.captureException(new Error(error.message), { extra: { code: error.code } });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = () => new Date().toISOString();
  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const ev of claimed ?? []) {
    try {
      const candidates = await getCandidateStepsForCard(supabase, ev.card_id);
      if (candidates.length === 0) {
        await supabase
          .from("card_events")
          .update({
            ai_step_status: "skipped",
            ai_step_error: "no_candidate_steps",
            ai_step_processed_at: now(),
          })
          .eq("id", ev.id);
        skipped++;
        continue;
      }

      const { data: card } = await supabase
        .from("cards")
        .select("title")
        .eq("id", ev.card_id)
        .single();
      const { verdict } = await inferCardEventSteps({
        cardTitle: card?.title ?? "",
        eventText: summarizeWorkEvent(ev.payload),
        candidates,
      });
      const selected = selectApplicableMatches(verdict, candidates, MIN_CONFIDENCE);
      await applyStepInference(supabase, {
        cardEventId: ev.id,
        projectId: ev.project_id,
        selected,
      });

      await supabase
        .from("card_events")
        .update({ ai_step_status: "done", ai_step_error: null, ai_step_processed_at: now() })
        .eq("id", ev.id);
      done++;
    } catch (e) {
      console.warn(`[cron/infer-card-steps] event ${ev.id} failed: ${errMsg(e)}`);
      Sentry.captureException(e, { extra: { cardEventId: ev.id } });
      await supabase
        .from("card_events")
        .update({
          ai_step_status: "failed",
          ai_step_error: errMsg(e),
          ai_step_processed_at: now(),
        })
        .eq("id", ev.id);
      failed++;
    }
  }

  if ((claimed?.length ?? 0) > 0) {
    console.log(
      `[cron/infer-card-steps] summary: claimed=${claimed?.length ?? 0} done=${done} skipped=${skipped} failed=${failed}`,
    );
  }
  return NextResponse.json({ claimed: claimed?.length ?? 0, done, skipped, failed });
}
