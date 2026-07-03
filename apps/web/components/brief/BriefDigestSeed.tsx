"use client";

import { useEffect, useRef } from "react";
import { useAssistant } from "@/components/chat/AssistantProvider";
import { markNotificationRead } from "@/lib/notifications/mutations";

/**
 * Completes Task 4's deferred wiring: when today's daily-digest notification
 * (written by the readiness-reminders cron, kind=readiness_reminder,
 * link=/brief) is unread, the /brief layout server-fetches its id + text
 * (see layout.tsx + lib/assistant/daily-brief.ts's findTodaysUnreadDigest)
 * and passes both here. On mount, this seeds the portfolio dock with the
 * text as an ASSISTANT-authored first message via `openWithMessage` (Task
 * 4's pendingSeed mechanism) — the same "tap the notification, land on
 * /brief, see the digest as a chat bubble" experience the daily-brief report
 * documented as pending on T5.
 *
 * Fix 1 (reseed duplicates): immediately after seeding, marks the
 * notification row read via the existing `markNotificationRead` server
 * action (same FormData invocation NotificationList.tsx uses) — best-effort,
 * fire-and-forget, matching this file's existing "seed is best-effort" tone.
 * Without this, the notification stays unread and every subsequent /brief
 * load re-seeds the identical digest as a fresh duplicate chat bubble (only
 * ChatDock's own post-hydration dedup guard would then be catching it).
 *
 * Renders nothing. Fires at most once per page load (guarded by a ref, since
 * `digestText`/`notificationId` are static server-computed props that don't
 * change across client re-renders of the same navigation).
 */
export function BriefDigestSeed({
  notificationId,
  digestText,
}: {
  notificationId: string | null;
  digestText: string | null;
}) {
  const { openWithMessage } = useAssistant();
  const seeded = useRef(false);

  useEffect(() => {
    if (!digestText || seeded.current) return;
    seeded.current = true;
    openWithMessage(digestText);
    if (notificationId) {
      const fd = new FormData();
      fd.set("notificationId", notificationId);
      void markNotificationRead(fd);
    }
    // Fire once per mount for a given digestText — openWithMessage identity
    // is stable (useCallback in AssistantProvider) so this only needs to
    // re-arm if the digest text itself changes (new navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digestText, notificationId]);

  return null;
}
