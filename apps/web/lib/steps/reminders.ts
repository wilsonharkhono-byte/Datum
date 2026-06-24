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
 * NOTE ON PUSH: Expo sendExpoPush lives on the mobile branch (not yet
 * merged). Once it merges, the cron can fan-out push notifications by
 * calling sendExpoPush on each written intent.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getProjectStepSignals } from "@/lib/steps/queries";

type Supa = SupabaseClient<Database>;

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The DB notification_kind for readiness reminders.
 * MIGRATION DEPENDENCY: migration 20260623000001_notification_kind_readiness_reminder.sql
 * must be applied to the database before this cron deploys, otherwise inserts will fail
 * with an invalid enum value error (best-effort: reminders won't write until applied).
 */
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
      const recipients = resolveRecipients(row.tradeRole, members, project);

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
        });
      }
    }
  }

  return { intents, projectsScanned: projects.length, signalsFound };
}
