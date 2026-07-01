// apps/web/lib/steps/infer-runner.ts
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getAnthropicClient, getModel, cachedSystemBlock, textOf } from "@/lib/assistant/anthropic";
import {
  buildInferencePrompt,
  parseStepVerdict,
  STEP_VERDICT_SCHEMA,
  type CandidateStep,
  type StepVerdict,
} from "@/lib/steps/infer";

/** Active, non-removed steps for every area linked to a card, with template name + gate. */
export async function getCandidateStepsForCard(
  supabase: SupabaseClient<Database>,
  cardId: string,
): Promise<CandidateStep[]> {
  const { data: links, error: linkErr } = await supabase
    .from("card_areas").select("area_id").eq("card_id", cardId);
  if (linkErr) throw linkErr;
  const areaIds = (links ?? []).map((l) => l.area_id);
  if (areaIds.length === 0) return [];

  const { data, error } = await supabase
    .from("area_steps")
    .select("id, step_code, status, trade_steps:step_code (name, gate_code)")
    .in("area_id", areaIds)
    .is("removed_at", null);
  if (error) throw error;

  return (data ?? []).map((r) => {
    const tmpl = r.trade_steps as { name: string; gate_code: string } | null;
    return {
      area_step_id: r.id,
      step_code: r.step_code,
      name: tmpl?.name ?? r.step_code,
      gate_code: tmpl?.gate_code ?? "",
      status: r.status,
    };
  });
}

/** Call Haiku with a cached prompt + structured output; return the parsed verdict. */
export async function inferCardEventSteps(args: {
  cardTitle: string;
  eventText: string;
  candidates: CandidateStep[];
  client?: Pick<Anthropic, "messages">;
}): Promise<{ verdict: StepVerdict; model: string }> {
  const { systemText, userText } = buildInferencePrompt({
    cardTitle: args.cardTitle,
    eventText: args.eventText,
    candidates: args.candidates,
  });
  const model = getModel();
  const client = args.client ?? getAnthropicClient();
  const res = await client.messages.create({
    model,
    max_tokens: 512,
    system: cachedSystemBlock(systemText),
    messages: [{ role: "user", content: userText }],
    output_config: { format: { type: "json_schema", schema: STEP_VERDICT_SCHEMA } },
  } as Anthropic.MessageCreateParamsNonStreaming);
  return { verdict: parseStepVerdict(textOf(res.content)), model };
}
