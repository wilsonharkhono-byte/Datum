-- 20260623000001_notification_kind_readiness_reminder.sql
-- Add a distinct kind for schedule-aware readiness reminders (was reusing watcher_event).
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so NO begin/commit here.
alter type public.notification_kind add value if not exists 'readiness_reminder';
