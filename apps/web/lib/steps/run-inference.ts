import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getCandidateStepsForCard, inferCardEventSteps } from "@/lib/steps/infer-runner";
import { applyStepInference } from "@/lib/steps/mutations";
import { selectApplicableMatches, summarizeEventText } from "@/lib/steps/infer";
import { isMissingFunctionError } from "@/lib/cron/auth";

const MIN_CONFIDENCE = 0.6;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type InferenceResult =
  | { claimed: number; done: number; skipped: number; failed: number }
  | { migrationPending: true };

export async function processPendingStepInference(
  supabase: SupabaseClient<Database>,
  limit: number,
): Promise<InferenceResult> {
  const { data: claimed, error } = await supabase.rpc("claim_card_events_for_step_inference", {
    p_limit: limit,
  });
  if (error) {
    if (isMissingFunctionError(error)) {
      console.warn("[infer-card-steps] claim RPC missing — migration not applied yet");
      return { migrationPending: true };
    }
    throw error;
  }

  const now = () => new Date().toISOString();
  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const ev of claimed ?? []) {
    try {
      const candidates = await getCandidateStepsForCard(supabase, ev.card_id);
      if (candidates.length === 0) {
        const { error: writeErr } = await supabase
          .from("card_events")
          .update({
            ai_step_status: "skipped",
            ai_step_error: "no_candidate_steps",
            ai_step_processed_at: now(),
          })
          .eq("id", ev.id);
        if (writeErr) throw writeErr;
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
        eventText: summarizeEventText(ev.event_kind, ev.payload),
        candidates,
      });

      if (!verdict.is_progress) {
        const { error: writeErr } = await supabase
          .from("card_events")
          .update({
            ai_step_status: "skipped",
            ai_step_error: "not_progress",
            ai_step_processed_at: now(),
          })
          .eq("id", ev.id);
        if (writeErr) throw writeErr;
        skipped++;
        continue;
      }

      const selected = selectApplicableMatches(verdict, candidates, MIN_CONFIDENCE);
      await applyStepInference(supabase, {
        cardEventId: ev.id,
        projectId: ev.project_id,
        occurredAt: ev.occurred_at,
        selected,
      });

      const { error: writeErr } = await supabase
        .from("card_events")
        .update({ ai_step_status: "done", ai_step_error: null, ai_step_processed_at: now() })
        .eq("id", ev.id);
      if (writeErr) throw writeErr;
      done++;
    } catch (e) {
      console.warn(`[infer-card-steps] event ${ev.id} failed: ${errMsg(e)}`);
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
      `[infer-card-steps] summary: claimed=${claimed?.length ?? 0} done=${done} skipped=${skipped} failed=${failed}`,
    );
  }
  return { claimed: claimed?.length ?? 0, done, skipped, failed };
}
