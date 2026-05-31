// apps/web/lib/assistant/audit.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@datum/db";

export async function ensureSession(
  supabase: SupabaseClient<Database>,
  args: { staffId: string; projectId: string; sessionId?: string },
): Promise<string> {
  if (args.sessionId) return args.sessionId;
  const { data, error } = await supabase
    .from("assistant_sessions")
    .insert({ staff_id: args.staffId, project_id: args.projectId, title: "Chat" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function recordExchange(
  supabase: SupabaseClient<Database>,
  args: {
    sessionId: string;
    staffId: string;
    projectId: string;
    question: string;
    answer: string;
    citations: { cardId: string; eventIds: string[] }[];
    usage: { input_tokens: number; output_tokens: number };
  },
): Promise<void> {
  await supabase.from("assistant_messages").insert([
    {
      session_id: args.sessionId,
      staff_id: args.staffId,
      role: "user" as const,
      content: args.question,
      token_count: args.usage.input_tokens,
    },
    {
      session_id: args.sessionId,
      staff_id: args.staffId,
      role: "assistant" as const,
      content: args.answer,
      sources_jsonb: args.citations as unknown as Json,
      token_count: args.usage.output_tokens,
    },
  ]);

  await supabase.from("assistant_query_audit").insert({
    staff_id: args.staffId,
    project_scope_jsonb: { project_id: args.projectId },
    question: args.question,
    answer_summary: args.answer.slice(0, 400),
    records_accessed_jsonb: args.citations as unknown as Json,
    included_unapproved_drafts: false,
  });
}
