import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getCandidateStepsForCard, inferCardEventSteps } from "@/lib/steps/infer-runner";
import { applyStepInference } from "@/lib/steps/mutations";
import { selectApplicableMatches, summarizeEventText } from "@/lib/steps/infer";
import { isMissingFunctionError } from "@/lib/cron/auth";
import { recomputeProjectGatesSystem } from "@/lib/gates/recompute-system";

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
  // Projects whose area_step_events this run actually wrote — gate cells for
  // these need a recompute (a "work"-equivalent projected step status is
  // gate-relevant, see readiness-rules.ts RELEVANT_KINDS). Collected instead
  // of recomputing per-event so a batch touching the same project only
  // recomputes once.
  const projectsToRecompute = new Set<string>();

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

      const eventText = summarizeEventText(ev.event_kind, ev.payload);
      if (eventText.trim().length === 0) {
        const { error: writeErr } = await supabase
          .from("card_events")
          .update({
            ai_step_status: "skipped",
            ai_step_error: "no_text",
            ai_step_processed_at: now(),
          })
          .eq("id", ev.id);
        if (writeErr) throw writeErr;
        skipped++;
        continue;
      }

      const { data: card, error: cardErr } = await supabase
        .from("cards")
        .select("title")
        .eq("id", ev.card_id)
        .single();
      if (cardErr) throw cardErr; // don't infer with a silently-empty title
      const { verdict } = await inferCardEventSteps({
        cardTitle: card?.title ?? "",
        eventText,
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
      if (selected.length > 0) {
        projectsToRecompute.add(ev.project_id);
      }

      const { error: writeErr } = await supabase
        .from("card_events")
        .update({ ai_step_status: "done", ai_step_error: null, ai_step_processed_at: now() })
        .eq("id", ev.id);
      if (writeErr) throw writeErr;
      done++;
    } catch (e) {
      console.warn(`[infer-card-steps] event ${ev.id} failed: ${errMsg(e)}`);
      Sentry.captureException(e, { extra: { cardEventId: ev.id } });
      const { error: markErr } = await supabase
        .from("card_events")
        .update({
          ai_step_status: "failed",
          ai_step_error: errMsg(e),
          ai_step_processed_at: now(),
        })
        .eq("id", ev.id);
      if (markErr) {
        // Event stays claimed/processing with no recorded error — surface it.
        console.error(`[infer-card-steps] could not mark event ${ev.id} failed: ${markErr.message}`);
        Sentry.captureException(markErr, { extra: { cardEventId: ev.id } });
      }
      failed++;
    }
  }

  // B4 fix: AI-written step progress is gate-relevant (a projected step
  // status feeds readiness the same way a human "work" event does), but this
  // function is the only writer of area_step_events for AI inference and can
  // run from either the request-scoped after() hooks in lib/cards/mutations.ts
  // or the standalone cron route (app/api/cron/infer-card-steps) which has no
  // surrounding request to hang a recompute off of. Recompute here so both
  // callers self-heal, instead of duplicating this at every call site.
  for (const projectId of projectsToRecompute) {
    try {
      const { data: project } = await supabase
        .from("projects")
        .select("project_code")
        .eq("id", projectId)
        .maybeSingle();
      if (project?.project_code) {
        await recomputeProjectGatesSystem(projectId, project.project_code);
      }
    } catch (e) {
      console.warn(`[infer-card-steps] recompute failed for project ${projectId}: ${errMsg(e)}`);
      Sentry.captureException(e, { extra: { where: "processPendingStepInference.recompute", projectId } });
    }
  }

  if ((claimed?.length ?? 0) > 0) {
    console.log(
      `[infer-card-steps] summary: claimed=${claimed?.length ?? 0} done=${done} skipped=${skipped} failed=${failed}`,
    );
  }
  return { claimed: claimed?.length ?? 0, done, skipped, failed };
}
