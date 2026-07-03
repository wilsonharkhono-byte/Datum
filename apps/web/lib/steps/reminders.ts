/**
 * Readiness reminder builder — Phase 2 Part B automation.
 *
 * Enumerates active projects, runs `getProjectStepSignals` for each,
 * resolves the responsible staff member(s) per signal's trade_role, and
 * returns `ReminderIntent[]` (no DB writes — keeps this unit-testable).
 *
 * The cron route (`/api/cron/readiness-reminders`) calls this function
 * and then deduplicates + persists the intents as `notifications` rows.
 *
 * NOTE ON KIND: Uses the dedicated `readiness_reminder` notification_kind
 * (DB enum value added via migration 20260623000002). Task 4's grouped daily
 * digest (`groupIntentsByRecipient` / `DAILY_BRIEF_KIND` below) reuses the
 * SAME kind — it is still, mechanically, a readiness reminder; only the
 * cardinality (one row per person per day instead of one per signal) and the
 * message (composed via `composePersonalBrief`) differ. No migration needed.
 *
 * NOTE ON PUSH: The cron route fans out Expo push notifications via
 * sendExpoPush for each newly-inserted (non-deduped) intent.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getProjectStepSignals } from "@/lib/steps/queries";
import type { StepSignalSeverity } from "@/lib/steps/signals";
import { composePersonalBrief, roleLabel } from "@/lib/assistant/daily-brief";

type Supa = SupabaseClient<Database>;

// ─── Types ───────────────────────────────────────────────────────────────────

/** The dedicated DB notification_kind for readiness reminders (migration 20260623000002). */
export const READINESS_REMINDER_KIND = "readiness_reminder" as const;

export type ReminderIntent = {
  recipientStaffId: string;
  kind: typeof READINESS_REMINDER_KIND;
  /** Short Bahasa-Indonesia summary (maps to notifications.summary). */
  message: string;
  /** Deep-link into the project schedule, e.g. /project/{code}/schedule. */
  link: string;
  projectId: string;
  /**
   * Deterministic dedup key: one intent per (recipient, project, area, stepCode, signalKind).
   * The cron route uses this to skip INSERT if a matching unread notification
   * exists in the last 7 days.
   */
  dedupeKey: string;
  /** The originating signal's severity — feeds the daily-brief escalation line. */
  severity: StepSignalSeverity;
  /**
   * Roles this SAME signal was also escalated to beyond this recipient's base
   * resolution (e.g. "high"/"critical" widened the ladder to site_supervisor/
   * pic/principal — see `escalateRecipients`). Empty when the signal did not
   * escalate. Per-item audience by staff id isn't cheaply retrievable here
   * (the base vs. escalated split is role-shaped, not id-shaped, once
   * de-duped across signals) — see `groupIntentsByRecipient` for how this
   * feeds the digest's "juga dikirim ke" line.
   *
   * NOTE: this is the SAME array for every recipient of this signal — it is
   * NOT pre-filtered to exclude the recipient's own role (an escalated
   * site_supervisor's own role can appear here). `recipientStaffRole` below
   * exists precisely so a consumer can filter it per-recipient before
   * display — see `groupIntentsByRecipient`.
   */
  escalatedRoles: string[];
  /**
   * This recipient's own `staff.role` on the project, resolved from
   * `members` (null when the recipient came from `project.principal_id` /
   * `pic_id` fallback and isn't present in `members`). Used to filter this
   * recipient's own role out of `escalatedRoles` before it's shown to them —
   * see `groupIntentsByRecipient`.
   */
  recipientStaffRole: string | null;
};

// ─── Active-project enumerator ────────────────────────────────────────────────

export type ActiveProject = {
  id: string;
  project_code: string;
  project_name: string;
  principal_id: string | null;
  pic_id: string | null;
};

/**
 * Returns all projects that are NOT closed (status != 'closed').
 * Entry point for the cron — we scan every active project.
 */
export async function getActiveProjects(admin: Supa): Promise<ActiveProject[]> {
  const { data, error } = await admin
    .from("projects")
    .select("id, project_code, project_name, principal_id, pic_id")
    .neq("status", "closed");
  if (error) throw error;
  return (data ?? []) as ActiveProject[];
}

// ─── Recipient resolution ─────────────────────────────────────────────────────

export type ProjectMember = {
  staff_id: string;
  role_on_project: string;
  staff_role: string;
};

/**
 * Maps a `trade_role` string (from trade_steps template) to a `staff_role`
 * enum value. The `trade_role` column uses the same vocabulary as `staff_role`
 * by convention. Falls back to heuristic partial matching.
 */
export function tradeRoleToStaffRole(tradeRole: string | null): string | null {
  if (!tradeRole) return null;
  const KNOWN_ROLES = new Set([
    "principal",
    "designer",
    "pic",
    "site_supervisor",
    "admin",
    "estimator",
  ]);
  const normalized = tradeRole.trim().toLowerCase();
  if (KNOWN_ROLES.has(normalized)) return normalized;
  // Heuristic fallbacks
  if (normalized.includes("site") || normalized.includes("supervisor")) return "site_supervisor";
  if (normalized.includes("design")) return "designer";
  if (normalized.includes("estimat")) return "estimator";
  if (normalized.includes("pic")) return "pic";
  return null;
}

/**
 * Loads all ACTIVE staff members assigned to a project, joined to staff.role.
 * Pure DB reads, no writes.
 */
export async function getProjectMembers(
  admin: Supa,
  projectId: string,
): Promise<ProjectMember[]> {
  const { data, error } = await admin
    .from("project_staff")
    .select("staff_id, role_on_project, staff:staff_id(role, active)")
    .eq("project_id", projectId);
  if (error) throw error;

  return (data ?? [])
    .filter((row) => {
      const staffRow = row.staff as { role: string; active: boolean } | null;
      return staffRow?.active === true;
    })
    .map((row) => {
      const staffRow = row.staff as { role: string; active: boolean } | null;
      return {
        staff_id: row.staff_id,
        role_on_project: row.role_on_project,
        staff_role: staffRow?.role ?? "",
      };
    });
}

/**
 * Resolves recipient staff IDs for a signal's trade_role.
 *
 * Resolution order:
 * 1. Project members whose `staff.role` matches the signal's `tradeRole`.
 * 2. FALLBACK: project members with role `principal` or `admin`.
 * 3. FINAL FALLBACK: project.principal_id / project.pic_id from projects row.
 *
 * Pure function over pre-loaded data — no DB calls — fully testable.
 */
export function resolveRecipients(
  tradeRole: string | null,
  members: ProjectMember[],
  project: Pick<ActiveProject, "principal_id" | "pic_id">,
): string[] {
  const staffRole = tradeRoleToStaffRole(tradeRole);

  // 1. Primary: members whose staff.role matches the trade role.
  if (staffRole) {
    const matched = members
      .filter((m) => m.staff_role === staffRole)
      .map((m) => m.staff_id);
    if (matched.length > 0) return [...new Set(matched)];
  }

  // 2. Fallback: principals and admins on the project.
  const fallback = members
    .filter((m) => m.staff_role === "principal" || m.staff_role === "admin")
    .map((m) => m.staff_id);
  if (fallback.length > 0) return [...new Set(fallback)];

  // 3. Final fallback: principal_id / pic_id from the project row.
  const finals: string[] = [];
  if (project.principal_id) finals.push(project.principal_id);
  if (project.pic_id) finals.push(project.pic_id);
  return [...new Set(finals)];
}

/**
 * Widen the recipient set by signal severity (escalation ladder):
 *  - info/warning: base only
 *  - high:     + supervision tier (site_supervisor, pic) + project.pic_id
 *  - critical: + that tier + principals + project.principal_id
 * De-dupes by staff id (first-seen order), drops null/empty.
 */
export function escalateRecipients(
  severity: StepSignalSeverity,
  base: string[],
  members: ProjectMember[],
  project: Pick<ActiveProject, "principal_id" | "pic_id">,
): string[] {
  const out = [...base];
  const add = (ids: (string | null | undefined)[]) => {
    for (const id of ids) if (id && !out.includes(id)) out.push(id);
  };
  if (severity === "high" || severity === "critical") {
    add(members.filter((m) => m.staff_role === "site_supervisor" || m.staff_role === "pic").map((m) => m.staff_id));
    add([project.pic_id]);
  }
  if (severity === "critical") {
    add(members.filter((m) => m.staff_role === "principal").map((m) => m.staff_id));
    add([project.principal_id]);
  }
  return out;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * For each active project, compute step signals and produce `ReminderIntent[]`.
 *
 * `today` is YYYY-MM-DD (Asia/Jakarta local date, injected by the caller).
 * `now` is an ISO timestamp used for silence-detection math.
 *
 * Returns intents only — the caller (cron route) is responsible for dedup +
 * INSERT into the `notifications` table.
 *
 * Throws (re-throws) if area_steps / trade_steps tables are missing so the
 * cron route can detect migration_pending and return gracefully.
 */
export async function buildReadinessReminders(
  admin: Supa,
  today: string,
  now: string,
): Promise<{ intents: ReminderIntent[]; projectsScanned: number; signalsFound: number }> {
  const projects = await getActiveProjects(admin);
  const intents: ReminderIntent[] = [];
  let signalsFound = 0;

  for (const project of projects) {
    const signals = await getProjectStepSignals(admin, project.id, today, now);
    signalsFound += signals.length;

    if (signals.length === 0) continue;

    // Load project members once per project (one round-trip per active project).
    const members = await getProjectMembers(admin, project.id);
    const link = `/project/${project.project_code}/schedule`;

    for (const row of signals) {
      // Use the trade_role from the signal row (added to ProjectStepSignalRow).
      const base = resolveRecipients(row.tradeRole, members, project);
      const recipients = escalateRecipients(row.signal.severity, base, members, project);

      // Roles this signal's escalation ladder ADDED beyond the base resolution
      // (id -> staff_role via `members`; falls back to skip if the id is a
      // project.principal_id/pic_id not present in `members`). Used only for
      // the digest's "juga dikirim ke" transparency line — see
      // `ReminderIntent.escalatedRoles` for why this is role-shaped, not id-shaped.
      const escalatedRoles = recipients.length > base.length
        ? [...new Set(
            recipients
              .filter((id) => !base.includes(id))
              .map((id) => members.find((m) => m.staff_id === id)?.staff_role)
              .filter((role): role is string => Boolean(role)),
          )]
        : [];

      for (const recipientStaffId of recipients) {
        const dedupeKey = [
          recipientStaffId,
          project.id,
          row.areaId,
          row.stepCode,
          row.signal.kind,
        ].join("|");

        intents.push({
          recipientStaffId,
          kind: READINESS_REMINDER_KIND,
          message: `[${row.areaName}] ${row.signal.message}`,
          link,
          projectId: project.id,
          dedupeKey,
          severity: row.signal.severity,
          escalatedRoles,
          recipientStaffRole: members.find((m) => m.staff_id === recipientStaffId)?.staff_role ?? null,
        });
      }
    }
  }

  return { intents, projectsScanned: projects.length, signalsFound };
}

// ─── Per-recipient digest grouping (Task 4: daily brief) ─────────────────────

/** The dedicated notification_kind for a grouped daily digest (reuses READINESS_REMINDER_KIND — see module docstring below). */
export const DAILY_BRIEF_KIND = READINESS_REMINDER_KIND;

export type DailyDigestIntent = {
  recipientStaffId: string;
  kind: typeof DAILY_BRIEF_KIND;
  /** Composed via `composePersonalBrief` — the notifications.summary. */
  message: string;
  /** Always /brief — the digest is cross-project, unlike a single-signal intent's project link. */
  link: string;
  /** Dedup key: one digest per (recipient, date) — see cron route's isAlreadyNotified call site for this kind. */
  dedupeKey: string;
  /** How many source signals this digest folds together — the cron uses this to pick digest vs. single-row delivery. */
  itemCount: number;
};

/**
 * Groups `ReminderIntent[]` by recipient and composes one digest per person
 * via `composePersonalBrief` (pure — from `lib/assistant/daily-brief.ts`).
 *
 * `staffNames` maps staff id -> full_name (the cron route loads this once
 * from the `staff` table before calling this function — keeps this function
 * itself DB-free and unit-testable).
 *
 * `today` (YYYY-MM-DD) is folded into the dedup key so digests naturally
 * roll over at midnight without a separate cleanup pass.
 *
 * Escalation transparency: for each recipient, the digest's "juga dikirim
 * ke" line names the roles from the HIGHEST-SEVERITY item's escalation
 * ladder (`escalatedRoles` on that item) — see `ReminderIntent.escalatedRoles`
 * docstring for why this is a simplification (role-shaped, not a literal
 * per-item audience list). `escalatedRoles` is the SAME array for every
 * recipient of a signal, so an escalated recipient (e.g. the mandor added by
 * a "high"-severity signal) would otherwise see their OWN role named in
 * their own digest ("Juga dikirim ke: mandor, PIC"). We filter the
 * recipient's own `recipientStaffRole` out of the escalation line before
 * composing — they already know they were notified; the line is meant to
 * tell them who ELSE was.
 *
 * Delivery-count policy (documented per Task 4 requirement #2): recipients
 * with exactly ONE item keep their original single-signal `ReminderIntent`
 * (no grouping benefit, and the specific project link is more useful than
 * the generic /brief link) — this function only returns entries for
 * recipients with 2+ items. The cron route is responsible for writing the
 * single-item recipients' original rows unchanged.
 */
export function groupIntentsByRecipient(
  intents: ReminderIntent[],
  staffNames: Map<string, string>,
  today: string,
): DailyDigestIntent[] {
  const byRecipient = new Map<string, ReminderIntent[]>();
  for (const intent of intents) {
    const list = byRecipient.get(intent.recipientStaffId) ?? [];
    list.push(intent);
    byRecipient.set(intent.recipientStaffId, list);
  }

  const SEVERITY_ORDER: Record<StepSignalSeverity, number> = {
    critical: 0,
    high: 1,
    warning: 2,
    info: 3,
  };

  const out: DailyDigestIntent[] = [];
  for (const [recipientStaffId, items] of byRecipient) {
    if (items.length <= 1) continue; // single-item recipients keep their original row (see docstring)

    const sorted = [...items].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    const ownRole = sorted[0]!.recipientStaffRole;
    const escalatedTo = sorted[0]!.escalatedRoles
      .filter((role) => role !== ownRole)
      .map(roleLabel);
    const name = staffNames.get(recipientStaffId) ?? "Tim";

    const message = composePersonalBrief({
      name,
      items: sorted.map((i) => ({ message: i.message })),
      escalatedTo,
    });
    if (!message) continue; // defensive — sorted is never empty here

    out.push({
      recipientStaffId,
      kind: DAILY_BRIEF_KIND,
      message,
      link: "/brief",
      dedupeKey: [recipientStaffId, today].join("|"),
      itemCount: items.length,
    });
  }

  return out;
}

// ─── Unconfirmed AI block notification (confirm-gate, Task 3) ────────────────

/**
 * A hallucinated AI "blocked" must never page the principal on its own — the
 * projection layer (`projectStepStatus` in status.ts) already keeps it from
 * escalating into `blocking_timeline`. But the *possible* block still needs
 * to be loudly visible so a human confirms (or corrects) it quickly. This
 * builds the notification intent(s) for that: reuses the same trade-role
 * recipient resolution as readiness reminders, plus the card's watchers
 * (`card_members`) since the AI event originated from a card note/photo/etc.
 */

/** Reuses the readiness-reminder kind — it's the one purpose-built for
 * "review this and act" notifications and already renders on both web and
 * mobile inboxes (falls back to the raw kind string if unlabeled, same as
 * every other kind). A dedicated kind isn't worth a migration for this. */
export const UNCONFIRMED_BLOCK_KIND = READINESS_REMINDER_KIND;

export type UnconfirmedBlockContext = {
  areaStepId: string;
  cardEventId: string;
  projectId: string;
  projectCode: string;
  stepName: string;
  stepTradeRole: string | null;
  areaName: string;
};

export type UnconfirmedBlockIntent = {
  recipientStaffId: string;
  kind: typeof UNCONFIRMED_BLOCK_KIND;
  message: string;
  link: string;
  projectId: string;
  cardEventId: string;
  areaStepId: string;
  /** Deterministic dedup key: one notification per (recipient, area_step, card_event). */
  dedupeKey: string;
};

/**
 * Pure: union of trade-role recipients (same resolution as readiness
 * reminders) and the card's watcher staff ids, deduped. No escalation ladder
 * here — this already fires only for a specific possible block, not a
 * severity-scored signal, so the base set is the whole point.
 */
export function resolveUnconfirmedBlockRecipients(
  tradeRole: string | null,
  members: ProjectMember[],
  project: Pick<ActiveProject, "principal_id" | "pic_id">,
  cardWatcherIds: string[],
): string[] {
  const base = resolveRecipients(tradeRole, members, project);
  return [...new Set([...base, ...cardWatcherIds])];
}

/** Pure: builds one intent per recipient for a possible AI block awaiting confirmation. */
export function buildUnconfirmedBlockIntents(
  ctx: UnconfirmedBlockContext,
  recipients: string[],
): UnconfirmedBlockIntent[] {
  const message = `AI mendeteksi kemungkinan terblokir: ${ctx.stepName} (${ctx.areaName}) — buka untuk konfirmasi`;
  // `notifications` has no area_step_id column (see 20260601000014_notifications.sql)
  // and no follow-up migration adds one. Encode the area_step id into the `link`
  // query string instead — it's the same mechanism the readiness cron's own
  // dedup (`isAlreadyNotified` in the cron route) already keys on, so the fix
  // stays consistent with the existing dedup contract without a migration.
  const link = `/project/${ctx.projectCode}/rooms?areaStep=${ctx.areaStepId}`;
  return recipients.map((recipientStaffId) => ({
    recipientStaffId,
    kind: UNCONFIRMED_BLOCK_KIND,
    message,
    link,
    projectId: ctx.projectId,
    cardEventId: ctx.cardEventId,
    areaStepId: ctx.areaStepId,
    dedupeKey: [recipientStaffId, ctx.areaStepId, ctx.cardEventId].join("|"),
  }));
}

/**
 * Loads the context an unconfirmed AI block notification needs (step name +
 * trade role, area name, project code, card watchers) and returns
 * ready-to-insert intents. Pure DB reads only — no writes, no dedup check
 * (that's the caller's job, mirroring the cron's `isAlreadyNotified` split
 * of concerns) so this stays easy to unit test.
 *
 * Returns `[]` (best-effort) if the area_step/card_event can't be resolved —
 * this must never throw and block the inference write that triggered it.
 */
export async function loadUnconfirmedBlockIntents(
  admin: Supa,
  args: { areaStepId: string; cardEventId: string; projectId: string },
): Promise<UnconfirmedBlockIntent[]> {
  const [stepRes, cardEventRes, projectRes] = await Promise.all([
    admin
      .from("area_steps")
      .select("area_id, trade_steps:step_code (name, trade_role), areas:area_id (area_name)")
      .eq("id", args.areaStepId)
      .maybeSingle(),
    admin.from("card_events").select("card_id").eq("id", args.cardEventId).maybeSingle(),
    admin.from("projects").select("id, project_code, project_name, principal_id, pic_id").eq("id", args.projectId).maybeSingle(),
  ]);

  const step = stepRes.data as {
    area_id: string;
    trade_steps: { name: string; trade_role: string | null } | null;
    areas: { area_name: string } | null;
  } | null;
  const project = projectRes.data as ActiveProject | null;
  const cardId = (cardEventRes.data as { card_id: string } | null)?.card_id ?? null;

  if (!step || !project) return [];

  const [members, watchers] = await Promise.all([
    getProjectMembers(admin, args.projectId),
    cardId
      ? admin.from("card_members").select("staff_id").eq("card_id", cardId).is("removed_at", null)
      : Promise.resolve({ data: [] as { staff_id: string }[] }),
  ]);
  const cardWatcherIds = ((watchers as { data: { staff_id: string }[] | null }).data ?? []).map((w) => w.staff_id);

  const ctx: UnconfirmedBlockContext = {
    areaStepId: args.areaStepId,
    cardEventId: args.cardEventId,
    projectId: args.projectId,
    projectCode: project.project_code,
    stepName: step.trade_steps?.name ?? args.areaStepId,
    stepTradeRole: step.trade_steps?.trade_role ?? null,
    areaName: step.areas?.area_name ?? step.area_id,
  };

  const recipients = resolveUnconfirmedBlockRecipients(ctx.stepTradeRole, members, project, cardWatcherIds);
  return buildUnconfirmedBlockIntents(ctx, recipients);
}

/**
 * Checks dedup (skip if an unread matching notification already exists for
 * this recipient+areaStep+cardEvent — no time window needed since
 * `card_event_id` is a stable dedup key unlike the readiness cron's
 * recompute-daily signals) then inserts. Best-effort: never throws.
 *
 * `notifications` carries no `area_step_id` column, so matching on
 * `card_event_id` alone under-dedups: one card event can write blocked
 * events for TWO different area_steps (e.g. a single note blocking two
 * bathroom steps), and both intents share the same recipient + card_event_id
 * + kind — the second notification would look like a dup of the first and
 * get dropped. `link` carries the area_step id (see `buildUnconfirmedBlockIntents`),
 * so matching on `link` too makes the dedup per (recipient, area_step,
 * card_event) — mirroring `dedupeKey`'s intent without a schema change.
 */
export async function isUnconfirmedBlockAlreadyNotified(
  admin: Supa,
  intent: Pick<UnconfirmedBlockIntent, "recipientStaffId" | "areaStepId" | "cardEventId" | "kind" | "link">,
): Promise<boolean> {
  const { data, error } = await admin
    .from("notifications")
    .select("id")
    .eq("recipient_staff_id", intent.recipientStaffId)
    .eq("card_event_id", intent.cardEventId)
    .eq("link", intent.link)
    .eq("kind", intent.kind)
    .limit(1);
  if (error) {
    console.warn("[unconfirmed-block] dedup check failed:", error.message);
    return true; // err on the side of not duplicating
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Full pipeline: load context, resolve recipients, dedup, and write
 * `notifications` rows for a possible AI block awaiting human confirmation.
 * Best-effort — swallows errors so it never blocks the inference write that
 * triggered it (same contract as the other notification producers).
 */
export async function notifyUnconfirmedAiBlock(
  admin: Supa,
  args: { areaStepId: string; cardEventId: string; projectId: string },
): Promise<void> {
  try {
    const intents = await loadUnconfirmedBlockIntents(admin, args);
    for (const intent of intents) {
      const already = await isUnconfirmedBlockAlreadyNotified(admin, intent);
      if (already) continue;
      const { error } = await admin.from("notifications").insert({
        recipient_staff_id: intent.recipientStaffId,
        kind: intent.kind,
        project_id: intent.projectId,
        card_event_id: intent.cardEventId,
        summary: intent.message,
        link: intent.link,
      });
      if (error) console.warn(`[unconfirmed-block] insert failed for ${intent.dedupeKey}:`, error.message);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[unconfirmed-block] notify failed:", msg);
  }
}
