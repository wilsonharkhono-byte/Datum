// apps/web/lib/assistant/audit.ts
// Note: assistant_sessions, assistant_messages, assistant_query_audit tables are
// defined in the Slice 1.1 migration (not yet reflected in types.generated.ts).
// The `as any` casts on `.from()` calls will be removed once types are regenerated.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

export async function ensureSession(
  supabase: SupabaseClient<Database>,
  args: { staffId: string; projectId: string; sessionId?: string },
): Promise<string> {
  if (args.sessionId) return args.sessionId;
  const db = supabase as AnyClient;
  const { data, error } = await db
    .from("assistant_sessions")
    .insert({ staff_id: args.staffId, project_id: args.projectId, title: "Chat" })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
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
  const db = supabase as AnyClient;

  await db.from("assistant_messages").insert([
    {
      session_id: args.sessionId,
      staff_id: args.staffId,
      role: "user",
      content: args.question,
      token_count: args.usage.input_tokens,
    },
    {
      session_id: args.sessionId,
      staff_id: args.staffId,
      role: "assistant",
      content: args.answer,
      sources_jsonb: args.citations as unknown as Record<string, unknown>,
      token_count: args.usage.output_tokens,
    },
  ]);

  await db.from("assistant_query_audit").insert({
    staff_id: args.staffId,
    project_scope_jsonb: { project_id: args.projectId },
    question: args.question,
    answer_summary: args.answer.slice(0, 400),
    records_accessed_jsonb: args.citations as unknown as Record<string, unknown>,
    included_unapproved_drafts: false,
  });
}
