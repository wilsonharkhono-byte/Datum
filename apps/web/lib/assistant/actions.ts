/**
 * Confirm-gated assistant actions (Phase 3 Task 3).
 *
 * The assistant may end its reply with ONE fenced `<action>{json}</action>`
 * tail proposing a write. Nothing in this file executes anything on its
 * own — `parseActionTail` only recognizes and validates the proposal so the
 * UI can render a chip; the actual write only happens when the confirming
 * user taps "Konfirmasi" and the corresponding `execute*` function below is
 * called explicitly with args carried by that tap (see ChatDock.tsx).
 *
 * Executors always take the CALLER'S session-scoped Supabase client (RLS
 * applies) — never an admin/service-role client — so an assistant-proposed
 * write can only do what the confirming user themselves is authorized to do.
 */
import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { updateAreaStep } from "@/lib/steps/mutations";
import { getRoomStepViews } from "@/lib/steps/queries";
import { getCurrentStaff, resolveCardEvent } from "@datum/core";
import { sendExpoPush } from "@/lib/notifications/push-send";

type Supa = SupabaseClient<Database>;

// ─── Schema ───────────────────────────────────────────────────────────────────

const RemindAction = z.object({
  type: z.literal("remind"),
  recipientRole: z.string().min(1).max(60).optional(),
  staffName: z.string().min(1).max(120).optional(),
  message: z.string().min(1).max(500),
  link: z.string().min(1).max(300).optional(),
});

const UpdateStepAction = z.object({
  type: z.literal("update_step"),
  areaName: z.string().min(1).max(120),
  stepName: z.string().min(1).max(160),
  status: z.enum(["in_progress", "blocked", "done"]),
  note: z.string().min(1).max(500).optional(),
});

const RecordDecisionAction = z.object({
  type: z.literal("record_decision"),
  cardSlug: z.string().min(1).max(160).optional(),
  question: z.string().min(1).max(300).optional(),
  outcome: z.string().min(1).max(500),
});

export const ActionProposal = z.discriminatedUnion("type", [
  RemindAction,
  UpdateStepAction,
  RecordDecisionAction,
]);

export type ActionProposalType = z.infer<typeof ActionProposal>;
export type RemindActionType = z.infer<typeof RemindAction>;
export type UpdateStepActionType = z.infer<typeof UpdateStepAction>;
export type RecordDecisionActionType = z.infer<typeof RecordDecisionAction>;

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Matches ONE `<action>...</action>` tail, non-greedy so multiple tails only
 * ever match the first. Deliberately does NOT anchor to end-of-string —
 * models sometimes trail whitespace/newlines after the closing tag.
 */
const ACTION_TAG_RE = /<action>([\s\S]*?)<\/action>/;

/** Hard cap on the raw JSON payload inside the tag — guards against a
 * pathological/oversized block before we even attempt to parse it. */
const MAX_TAIL_JSON_LENGTH = 4000;

/**
 * Extract + validate the action tail from an assistant reply.
 *
 * - No tail present → null.
 * - Multiple tails → only the first is considered; if it's invalid, returns
 *   null rather than falling through to a later tail (conservative: never
 *   guess which one the model "meant").
 * - Malformed JSON, unknown type, missing/invalid fields, or an oversized
 *   payload → null ("ignore silently" per the brief).
 */
export function parseActionTail(text: string): ActionProposalType | null {
  const match = ACTION_TAG_RE.exec(text);
  if (!match) return null;
  const raw = match[1]!.trim();
  if (!raw || raw.length > MAX_TAIL_JSON_LENGTH) return null;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = ActionProposal.safeParse(json);
  if (!result.success) return null;
  return result.data;
}

/**
 * Remove the action tail from text meant for display — re-exported from
 * @datum/core (isomorphic; mobile shares the exact same stripping logic so a
 * raw `<action>` tag never leaks into any platform's chat bubble even before
 * mobile has its own chip UI). See protocol.ts for the full contract.
 */
export { stripActionTail } from "@datum/core";

// ─── Executor result ────────────────────────────────────────────────────────

export type ActionExecResult = { ok: true } | { ok: false; error: string };

// ─── remind ───────────────────────────────────────────────────────────────────

/**
 * Resolve recipients for a `remind` action: a named staff member (matched
 * against `staff.full_name`, case-insensitive) takes priority over a
 * trade/staff role. Ambiguous name matches (>1 active staff with that name)
 * are treated as "not found" — the caller reports an error rather than
 * guessing which Budi to notify.
 */
export async function resolveRemindRecipients(
  supabase: Supa,
  projectId: string,
  args: { recipientRole?: string; staffName?: string },
): Promise<{ ok: true; staffIds: string[] } | { ok: false; error: string }> {
  if (args.staffName) {
    const { data, error } = await supabase
      .from("project_staff")
      .select("staff_id, staff:staff_id (id, full_name, active)")
      .eq("project_id", projectId);
    if (error) return { ok: false, error: error.message };
    const needle = args.staffName.trim().toLowerCase();
    const matches = (data ?? [])
      .map((r) => r.staff as { id: string; full_name: string; active: boolean } | null)
      .filter((s): s is { id: string; full_name: string; active: boolean } => !!s && s.active)
      .filter((s) => s.full_name.trim().toLowerCase() === needle);
    if (matches.length === 0) {
      return { ok: false, error: `Staf bernama "${args.staffName}" tidak ditemukan di proyek ini` };
    }
    if (matches.length > 1) {
      return { ok: false, error: `Ada lebih dari satu staf bernama "${args.staffName}" — sebutkan lebih spesifik` };
    }
    return { ok: true, staffIds: [matches[0]!.id] };
  }

  if (args.recipientRole) {
    const { data, error } = await supabase
      .from("project_staff")
      .select("staff_id, staff:staff_id (id, role, active)")
      .eq("project_id", projectId);
    if (error) return { ok: false, error: error.message };
    const needle = args.recipientRole.trim().toLowerCase();
    const matches = (data ?? [])
      .map((r) => r.staff as { id: string; role: string; active: boolean } | null)
      .filter((s): s is { id: string; role: string; active: boolean } => !!s && s.active)
      .filter((s) => s.role.trim().toLowerCase() === needle);
    if (matches.length === 0) {
      return { ok: false, error: `Tidak ada staf dengan peran "${args.recipientRole}" di proyek ini` };
    }
    return { ok: true, staffIds: matches.map((s) => s.id) };
  }

  return { ok: false, error: "Perlu nama staf atau peran penerima" };
}

/**
 * Execute a confirmed `remind` action: inserts a `notifications` row per
 * resolved recipient (RLS `notifications_insert` allows any authenticated
 * user — see 20260601000014_notifications.sql) using the CALLER's session
 * client, then best-effort pushes via the existing Expo fan-out. Never
 * executes anything the confirming user didn't just explicitly ask for by
 * tapping Konfirmasi — args come straight from the parsed+displayed chip.
 */
export async function executeRemindAction(
  supabase: Supa,
  args: { projectId: string; action: RemindActionType },
): Promise<ActionExecResult> {
  const staff = await getCurrentStaff(supabase);
  if (!staff) return { ok: false, error: "Harus masuk untuk mengirim pengingat" };

  const resolved = await resolveRemindRecipients(supabase, args.projectId, {
    recipientRole: args.action.recipientRole,
    staffName: args.action.staffName,
  });
  if (!resolved.ok) return resolved;

  const link = args.action.link && args.action.link.trim() ? args.action.link : "/brief";

  const rows = resolved.staffIds.map((recipientStaffId) => ({
    recipient_staff_id: recipientStaffId,
    kind: "readiness_reminder" as const,
    project_id: args.projectId,
    actor_staff_id: staff.id,
    summary: args.action.message,
    link,
  }));

  const { error } = await supabase.from("notifications").insert(rows);
  if (error) return { ok: false, error: error.message };

  await sendExpoPush(resolved.staffIds, {
    title: "Pengingat dari asisten",
    body: args.action.message,
    data: { link },
  });

  return { ok: true };
}

// ─── update_step ────────────────────────────────────────────────────────────

/**
 * Resolve one area_step id by (areaName, stepName) within a project —
 * case-insensitive exact match against `getRoomStepViews`'s in-memory step
 * list (same source the Rooms page and the assistant's PM-context retrieval
 * already use — no bespoke query). Ambiguous (>1 match) or not-found both
 * return an error rather than guessing.
 */
export async function resolveAreaStepByName(
  supabase: Supa,
  projectId: string,
  args: { areaName: string; stepName: string },
): Promise<{ ok: true; areaStepId: string } | { ok: false; error: string }> {
  const { data: areas, error } = await supabase
    .from("areas")
    .select("id, area_name, area_type")
    .eq("project_id", projectId);
  if (error) return { ok: false, error: error.message };

  const areaNeedle = args.areaName.trim().toLowerCase();
  const matchedAreas = (areas ?? []).filter(
    (a) => a.area_name.trim().toLowerCase() === areaNeedle,
  );
  if (matchedAreas.length === 0) {
    return { ok: false, error: `Ruangan "${args.areaName}" tidak ditemukan` };
  }
  if (matchedAreas.length > 1) {
    return { ok: false, error: `Ada lebih dari satu ruangan bernama "${args.areaName}"` };
  }
  const area = matchedAreas[0]!;

  const views = await getRoomStepViews(supabase, projectId, [
    { areaId: area.id, areaType: area.area_type },
  ]);
  const view = views.get(area.id);
  if (!view) return { ok: false, error: `Langkah untuk "${args.areaName}" tidak ditemukan` };

  const stepNeedle = args.stepName.trim().toLowerCase();
  const matchedSteps = view.steps.filter(
    (s) => (s.name ?? "").trim().toLowerCase() === stepNeedle,
  );
  if (matchedSteps.length === 0) {
    return { ok: false, error: `Langkah "${args.stepName}" tidak ditemukan di ${args.areaName}` };
  }
  if (matchedSteps.length > 1) {
    return { ok: false, error: `Ada lebih dari satu langkah bernama "${args.stepName}" di ${args.areaName}` };
  }
  return { ok: true, areaStepId: matchedSteps[0]!.id };
}

/**
 * Execute a confirmed `update_step` action. Mirrors submitStepUpdate
 * (apps/web/lib/steps/actions.ts) exactly — auth via getCurrentStaff, the
 * caller's session client, loggedByStaffId = the confirming user (human-
 * sourced: area_step_events has no 'source' column so it defaults to human
 * via updateAreaStep, same as any manual step update). The note is tagged
 * "(via asisten)" for provenance without a schema change.
 */
export async function executeUpdateStepAction(
  supabase: Supa,
  args: { projectId: string; action: UpdateStepActionType },
): Promise<ActionExecResult> {
  const staff = await getCurrentStaff(supabase);
  if (!staff) return { ok: false, error: "Harus masuk untuk mengubah langkah" };

  const resolved = await resolveAreaStepByName(supabase, args.projectId, {
    areaName: args.action.areaName,
    stepName: args.action.stepName,
  });
  if (!resolved.ok) return resolved;

  const note = args.action.note
    ? `${args.action.note} (via asisten)`
    : "(via asisten)";

  try {
    await updateAreaStep(supabase, {
      areaStepId: resolved.areaStepId,
      status: args.action.status,
      note,
      loggedByStaffId: staff.id,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ─── record_decision ────────────────────────────────────────────────────────

/**
 * Locate the open (needs_decision) decision card_event for a card, matching
 * fetchOpenDecisionEvents's shape (apps/web/lib/assistant/retrieval.ts).
 * cardSlug-scoped when given; otherwise falls back to matching the payload's
 * `topic` against the free-text `question`. Ambiguous/not-found → error.
 */
export async function resolveOpenDecisionEvent(
  supabase: Supa,
  projectId: string,
  args: { cardSlug?: string; question?: string },
): Promise<{ ok: true; eventId: string; cardSlug: string; projectCode: string } | { ok: false; error: string }> {
  if (!args.cardSlug && !args.question) {
    return { ok: false, error: "Perlu cardSlug atau pertanyaan untuk menemukan keputusan" };
  }

  let cardQuery = supabase
    .from("cards")
    .select("id, slug, title, project_id, projects:project_id (project_code)")
    .eq("project_id", projectId);
  if (args.cardSlug) cardQuery = cardQuery.eq("slug", args.cardSlug);

  const { data: cards, error: cardErr } = await cardQuery;
  if (cardErr) return { ok: false, error: cardErr.message };
  if (!cards || cards.length === 0) {
    return { ok: false, error: args.cardSlug ? `Kartu "${args.cardSlug}" tidak ditemukan` : "Kartu tidak ditemukan" };
  }

  const cardIds = cards.map((c) => c.id);
  const { data: events, error: evErr } = await supabase
    .from("card_events")
    .select("id, card_id, payload")
    .in("card_id", cardIds)
    .eq("event_kind", "decision")
    .contains("payload", { status: "needs_decision" });
  if (evErr) return { ok: false, error: evErr.message };

  let candidates = events ?? [];
  if (!args.cardSlug && args.question) {
    const needle = args.question.trim().toLowerCase();
    const filtered = candidates.filter((e) => {
      const topic = ((e.payload as { topic?: string })?.topic ?? "").trim().toLowerCase();
      return topic && (topic.includes(needle) || needle.includes(topic));
    });
    if (filtered.length > 0) candidates = filtered;
  }

  if (candidates.length === 0) {
    return { ok: false, error: "Tidak ada keputusan terbuka yang cocok ditemukan" };
  }
  if (candidates.length > 1) {
    return { ok: false, error: "Ada lebih dari satu keputusan terbuka yang cocok — sebutkan kartu spesifik" };
  }

  const ev = candidates[0]!;
  const card = cards.find((c) => c.id === ev.card_id)!;
  const projectCode = (card.projects as unknown as { project_code: string } | null)?.project_code ?? "";
  return { ok: true, eventId: ev.id, cardSlug: card.slug, projectCode };
}

/**
 * Execute a confirmed `record_decision` action via the existing
 * resolve_card_event RPC wrapper (packages/core/src/cards/events/resolve.ts)
 * — same mutation P2-T6's "Tandai diputuskan" flow uses, called directly
 * (not through the FormData server action) since args here come from the
 * parsed+confirmed action, not a form. newStatus is fixed to "decided".
 */
export async function executeRecordDecisionAction(
  supabase: Supa,
  args: { projectId: string; action: RecordDecisionActionType },
): Promise<ActionExecResult> {
  const staff = await getCurrentStaff(supabase);
  if (!staff) return { ok: false, error: "Harus masuk untuk mencatat keputusan" };

  const resolved = await resolveOpenDecisionEvent(supabase, args.projectId, {
    cardSlug: args.action.cardSlug,
    question: args.action.question,
  });
  if (!resolved.ok) return resolved;

  const result = await resolveCardEvent(supabase, {
    eventId: resolved.eventId,
    newStatus: "decided",
    outcome: args.action.outcome,
  });
  if (!result.ok) return result;
  return { ok: true };
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * Execute a confirmed action proposal. This is the ONLY entry point that
 * performs a write — it is only ever called from the server action wired to
 * the chip's Konfirmasi tap (see ChatDock.tsx), never automatically after a
 * stream completes. `action` must be the exact proposal the user saw in the
 * chip (re-validated by ActionProposal in the caller).
 */
export async function executeAction(
  supabase: Supa,
  args: { projectId: string; action: ActionProposalType },
): Promise<ActionExecResult> {
  switch (args.action.type) {
    case "remind":
      return executeRemindAction(supabase, { projectId: args.projectId, action: args.action });
    case "update_step":
      return executeUpdateStepAction(supabase, { projectId: args.projectId, action: args.action });
    case "record_decision":
      return executeRecordDecisionAction(supabase, { projectId: args.projectId, action: args.action });
  }
}
