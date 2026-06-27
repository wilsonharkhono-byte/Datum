# Readiness Escalation Ladder + Push Delivery — Design

**Date:** 2026-06-27
**Status:** Design (autonomous build); spec → plan → implementation.
**Module:** Readiness system, Phase 2. Builds on the existing reminder engine.

## Goal

Make readiness reminders **escalate** as a step's silence/lateness worsens — pulling in supervision and then the principal — and actually **reach people** via push, not just in-app. The detection + reminder engine already exists; this adds the escalation tiering and delivery.

## Context — what already exists on main (so this is a focused delta)

- **Silence/lateness detection:** `lib/steps/signals.ts` `computeStepSignals` emits `StepSignal` with `kind` (`silent`, `behind_plan`, …) and `severity` (`info | warning | high | critical`); severity already rises with days of silence.
- **Reminder engine:** `lib/steps/reminders.ts` `buildReadinessReminders` scans active projects, resolves recipients per signal's `trade_role` (`resolveRecipients`: trade-role match → fallback principal/admin → fallback project principal/pic), emits `ReminderIntent[]`.
- **Cron:** `app/api/cron/readiness-reminders/route.ts` dedups (per recipient+link+kind, unread, 7 days) and inserts `notifications`.
- **Push:** `lib/notifications/push-send.ts` `sendExpoPush(staffIds, { title, body, data? })` — self-fetches `push_tokens`, never throws, no-ops when empty.
- **Enum:** migration `20260623000002_notification_kind_readiness_reminder.sql` adds `readiness_reminder` to `notification_kind` (on prod + main) — but the **committed `types.generated.ts` is stale** (doesn't list it), and `reminders.ts` still uses the `"watcher_event"` placeholder.

**The three gaps:** (1) every signal notifies the *same* trade-role recipients regardless of severity — no escalation; (2) the placeholder kind; (3) no push fan-out.

## Decisions

1. **Escalation = severity-tiered, additive recipients** on top of the base trade-role recipients:
   - `info` / `warning` → base recipients only (the responsible person).
   - `high` → base **+ supervision tier** (project members with role `site_supervisor` or `pic`, and `project.pic_id`).
   - `critical` → base + supervision tier **+ principal** (members with role `principal`, and `project.principal_id`).
   As severity rises with silence, more senior people are pulled in. Deduped by staff id (a person already in the base set isn't doubled).
2. **Use the real `readiness_reminder` kind** — flip `READINESS_REMINDER_KIND` and add the (already-migrated) enum value to the committed types.
3. **Push delivery in the cron** — when (and only when) an intent is actually inserted (passes dedup), fan out `sendExpoPush` to that recipient. Dedup therefore also throttles push (no daily re-push of the same reminder).

## §1 · Escalation ladder (pure, tested)

In `lib/steps/reminders.ts`, add a pure function:
```
escalateRecipients(
  severity: StepSignalSeverity,
  base: string[],                 // from resolveRecipients
  members: ProjectMember[],
  project: Pick<ActiveProject, "principal_id" | "pic_id">,
): string[]
```
- Returns `base` for `info`/`warning`.
- For `high`, appends supervision-tier ids: members with `staff_role` in `{site_supervisor, pic}` + `project.pic_id`.
- For `critical`, also appends principal ids: members with `staff_role === "principal"` + `project.principal_id`.
- De-dupes (preserve first-seen order), drops null/empty.

`buildReadinessReminders` calls `resolveRecipients` as today, then wraps the result in `escalateRecipients(row.signal.severity, base, members, project)` before emitting intents. (Recipient set per signal now depends on its severity.) The per-recipient dedupeKey is unchanged.

## §2 · Real notification kind

- Change `READINESS_REMINDER_KIND` from `"watcher_event"` to `"readiness_reminder"`.
- Add `"readiness_reminder"` to the `notification_kind` enum array in `types.generated.ts` (it is already a real DB value via `20260623000002`; this just unsticks the stale committed types). No new migration.
- The cron's dedup query already matches on `kind`, so reminders dedup against prior `readiness_reminder` rows (cleaner than the shared `watcher_event` bucket).

## §3 · Push delivery

In `app/api/cron/readiness-reminders/route.ts`, after a successful `notifications` INSERT for an intent, call:
```
await sendExpoPush([intent.recipientStaffId], {
  title: "Pengingat kesiapan",
  body: intent.message,
  data: { link: intent.link },
});
```
`sendExpoPush` never throws and no-ops without tokens, so it's safe inside the loop. Only inserted (non-deduped) intents push — so a reminder pushes once, not every cron run. (Optional later: batch per project; not needed at current volume.)

## §4 · Scope & boundaries

- **Escalation is by signal severity**, which already encodes days-of-silence — we don't add a separate time ladder.
- Recipient sourcing reuses `ProjectMember`/`getProjectMembers`/`getActiveProjects` — no new queries.
- **Out of scope:** per-tier message wording (all tiers get the same `message` for v1); WhatsApp/email delivery; a configurable escalation policy; quiet-hours. Push uses the existing Expo path only.
- **No prod-data risk:** the cron writes in-app notifications + best-effort push; no schema change beyond the (already-applied) enum.

## Testing

- `escalateRecipients` unit-tested: `info`/`warning` = base unchanged; `high` adds supervisors+pic, dedupes someone already in base; `critical` adds principal too; null `pic_id`/`principal_id` skipped; ordering stable.
- `buildReadinessReminders` test (extend existing): a `critical` signal yields intents for base + supervision + principal; an `info` signal yields only base.
- Cron push: verify `sendExpoPush` is called once per inserted intent and **not** for deduped ones (mock `sendExpoPush`, assert call count). Existing cron tests stay green with the new kind.
