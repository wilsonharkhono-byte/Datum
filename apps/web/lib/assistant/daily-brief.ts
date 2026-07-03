/**
 * Daily personal brief — deterministic compose, NO model call.
 *
 * Phase 3 Task 4: the readiness-reminder cron already assembles, per active
 * project, a flat list of `ReminderIntent`s (one per signal x recipient —
 * see `lib/steps/reminders.ts`). Historically the cron wrote N separate
 * `notifications` rows per recipient (one per signal). This module composes
 * those N items for a single recipient into ONE short Bahasa digest —
 * "one personal digest per person per day" — so the cron can write a single
 * notification instead of a flood.
 *
 * Pure string composition only: no Supabase, no Date.now(), no React. The
 * cron route feeds it pre-grouped `DailyBriefItem[]` (see
 * `groupIntentsByRecipient` in reminders.ts) and writes the result as the
 * `notifications.summary` for a `readiness_reminder` row.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** One line item in a recipient's digest — derived from a `ReminderIntent`. */
export type DailyBriefItem = {
  /** Short Bahasa-Indonesia signal message, e.g. "[Kamar Mandi A] Screed terlambat dari rencana." */
  message: string;
};

/**
 * Bahasa-Indonesia labels for the escalation ladder's staff_role vocabulary.
 * Mirrors `tradeRoleToStaffRole`'s target roles (lib/steps/reminders.ts).
 * Used only for the "juga dikirim ke" transparency line — not persisted.
 */
const ROLE_LABEL: Record<string, string> = {
  principal: "principal",
  designer: "desainer",
  pic: "PIC",
  site_supervisor: "mandor",
  admin: "admin",
  estimator: "estimator",
};

/** Renders a staff_role to its Bahasa label, falling back to the raw string. */
export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

const MAX_CHARS = 600;
const MAX_LISTED_ITEMS = 3;
const BRIEF_LINK = "/brief";

export type ComposePersonalBriefArgs = {
  /** Recipient's display name (staff.full_name). */
  name: string;
  /** This recipient's grouped signal items for today, any order — highest severity first is typical. */
  items: DailyBriefItem[];
  /**
   * Escalation transparency: the roles (or names) this recipient's items were
   * ALSO escalated to (e.g. because the highest-severity item hit "high"/
   * "critical" and widened the ladder — see `escalateRecipients`). Omit or
   * pass an empty array when nothing escalated. Simplification: this names
   * the ROLES from the escalation ladder for the highest-severity item, not
   * the literal set of other people notified for every item — see
   * `groupIntentsByRecipient` for how the caller derives this.
   */
  escalatedTo?: string[];
};

/**
 * Composes a short Bahasa personal digest:
 *   "Pagi {name} — {n} hal hari ini: 1) … 2) … 3) … +N lainnya. Lihat: /brief"
 *   (+ optional trailing "Juga dikirim ke: {roles}." line)
 *
 * - Returns `null` when there are no items (nothing to send — the caller
 *   should skip writing a notification for this recipient today).
 * - Caps the listed items at 3; any remainder is summarized as "+N lainnya".
 * - Hard-caps the final string at 600 chars: if the escalation line would
 *   push the message over the limit, the escalation line is dropped first
 *   (transparency is a nice-to-have; the digest itself must fit); if it's
 *   still over, the item list is truncated with an ellipsis as a last resort.
 */
export function composePersonalBrief({ name, items, escalatedTo }: ComposePersonalBriefArgs): string | null {
  if (items.length === 0) return null;

  const n = items.length;
  const listed = items.slice(0, MAX_LISTED_ITEMS);
  const overflow = n - listed.length;

  const numbered = listed.map((item, i) => `${i + 1}) ${item.message}`).join(" ");
  const overflowSuffix = overflow > 0 ? ` +${overflow} lainnya.` : "";

  const base = `Pagi ${name} — ${n} hal hari ini: ${numbered}${overflowSuffix} Lihat: ${BRIEF_LINK}`;

  const roles = [...new Set((escalatedTo ?? []).filter(Boolean))];
  const escalationLine = roles.length > 0 ? ` Juga dikirim ke: ${roles.join(", ")}.` : "";

  const withEscalation = base + escalationLine;
  if (withEscalation.length <= MAX_CHARS) return withEscalation;

  // Over budget — drop the escalation line first (transparency is secondary
  // to the digest fitting in a push-notification-sized body).
  if (base.length <= MAX_CHARS) return base;

  // Still over (very long item messages) — hard-truncate as a last resort,
  // preserving the deep link so the recipient can always open /brief.
  const suffix = ` … Lihat: ${BRIEF_LINK}`;
  return base.slice(0, MAX_CHARS - suffix.length) + suffix;
}

// ─── Digest-seed presence (Phase 3 Task 5 — completes T4's deferred wiring) ──

/**
 * A row shape the /brief page needs to decide whether to seed the dock with
 * today's digest as an assistant-authored first message. Deliberately a
 * narrow subset of `Notification` (not the full DB row) so this stays pure
 * and testable without pulling in @datum/db types here.
 */
export type DigestNotificationCandidate = {
  id: string;
  kind: string;
  link: string;
  summary: string;
  read_at: string | null;
  created_at: string;
};

/** What `findTodaysUnreadDigest` hands back: the notification's id (so the
 * caller can mark it read once it's been seeded) alongside its seed text. */
export type UnreadDigest = { id: string; summary: string };

/** The notification_kind + link the cron writes a daily digest under (mirrors DAILY_BRIEF_KIND / "/brief" in lib/steps/reminders.ts). */
export const DIGEST_NOTIFICATION_KIND = "readiness_reminder" as const;
export const DIGEST_LINK = "/brief";

/**
 * Pure decision: does this list of the user's recent notifications contain
 * today's still-unread digest, and if so what's its seed text?
 *
 * Picks the newest matching (kind=readiness_reminder, link=/brief,
 * created_at falls within [todayStartIso, tomorrowStartIso)) row that is
 * still unread (`read_at === null`) — a read digest has already been seen,
 * so it should not re-seed the dock on every subsequent /brief visit that
 * day. Returns `null` when there is nothing to seed (no digest today, or
 * today's digest was already read).
 *
 * The page is responsible for fetching `notifications` (RLS-scoped to the
 * caller) and computing the Jakarta-local day boundaries; this function does
 * no I/O and no clock reads, so it's directly unit-testable.
 *
 * Returns the notification `id` alongside the seed text — the caller marks
 * that row read once it has actually been seeded into the dock (see
 * BriefDigestSeed.tsx), which is what stops every subsequent /brief load
 * from re-seeding the same digest as a fresh chat bubble.
 */
export function findTodaysUnreadDigest(
  notifications: DigestNotificationCandidate[],
  todayStartIso: string,
  tomorrowStartIso: string,
): UnreadDigest | null {
  const candidates = notifications
    .filter((n) => n.kind === DIGEST_NOTIFICATION_KIND)
    .filter((n) => n.link === DIGEST_LINK)
    .filter((n) => n.read_at === null)
    .filter((n) => n.created_at >= todayStartIso && n.created_at < tomorrowStartIso)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // newest first

  const top = candidates[0];
  return top ? { id: top.id, summary: top.summary } : null;
}

/**
 * Post-hydration duplicate guard for ChatDock's pendingSeed effect.
 *
 * `BriefDigestSeed` fires `openWithMessage(digestText)` once per mount, but
 * ChatDock also hydrates any previously-persisted messages (localStorage)
 * for the same dock on that same mount. If today's digest was already
 * seeded into the conversation on an earlier /brief visit (before the
 * notification row's markNotificationRead round-trip lands, or if that
 * round-trip failed), hydration + a fresh seed would append the identical
 * assistant bubble a second time. Pure string-equality check against the
 * already-hydrated messages — no I/O, directly unit-testable.
 */
export function isDuplicateSeed(existingContents: string[], seedText: string): boolean {
  return existingContents.includes(seedText);
}
