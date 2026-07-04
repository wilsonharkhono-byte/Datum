-- 20260704000002_scope_notifications_insert.sql
-- SECURITY FIX (AUDIT_SECURITY.md Finding 2).
--
-- notifications_insert (20260601000014_notifications.sql:52) was
--     with check (auth.uid() is not null)
-- i.e. ANY authenticated user could insert a notification into ANY other
-- staff member's queue, spoofing `actor_staff_id` and supplying an
-- attacker-controlled free-text `summary` + `link` (rendered in-app as a
-- clickable target). Vector for internal phishing and queue flooding.
--
-- Every legitimate session-client producer (packages/core/src/notifications/
-- producers.ts: notifyMentions / notifyWatchersOfEvent / notifyCardStatusChange
-- / notifyDraftApproved / notifyDraftRejected / notifyDraftPending) already:
--   * sets actor_staff_id = the caller, and
--   * sets project_id to a project the caller belongs to, and
--   * uses an in-app "/…" link.
-- Service-role producers (notifyPrincipalsOfHighRiskEvent, the cron) bypass RLS
-- entirely, so they are unaffected.
--
-- New policy therefore requires: the row is attributed to the caller, concerns
-- a project the caller can read, and the link is an in-app absolute path (not a
-- protocol-relative //host or an external URL).

begin;

drop policy if exists notifications_insert on public.notifications;

create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (
    actor_staff_id = public.current_staff_id()
    and (project_id is null or public.current_can_read_project(project_id))
    and link like '/%'
    and link not like '//%'
  );

commit;
