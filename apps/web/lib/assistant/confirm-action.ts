"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ActionProposal, executeAction, type ActionExecResult } from "@/lib/assistant/actions";

/**
 * Server action wired to the chat action chip's "Konfirmasi" tap
 * (ChatDock.tsx / MessageList.tsx). This is the ONLY path that turns a
 * parsed action proposal into a write — it only ever runs when explicitly
 * invoked by that tap, never automatically after a stream completes.
 *
 * Re-validates `action` against ActionProposal before executing (defense in
 * depth: the chip only ever displays an already-server-validated proposal,
 * but this guards against a tampered client payload) and uses the caller's
 * own session-scoped Supabase client — never an admin/service-role client —
 * so a confirmed action can only do what the confirming user themselves is
 * authorized to do.
 */
export async function confirmAssistantAction(args: {
  projectId: string;
  action: unknown;
}): Promise<ActionExecResult> {
  const parsed = ActionProposal.safeParse(args.action);
  if (!parsed.success) return { ok: false, error: "Aksi tidak valid" };

  const supabase = await createSupabaseServerClient();
  return executeAction(supabase, { projectId: args.projectId, action: parsed.data });
}
