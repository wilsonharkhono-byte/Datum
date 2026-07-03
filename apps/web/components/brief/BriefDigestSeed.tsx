"use client";

import { useEffect, useRef } from "react";
import { useAssistant } from "@/components/chat/AssistantProvider";

/**
 * Completes Task 4's deferred wiring: when today's daily-digest notification
 * (written by the readiness-reminders cron, kind=readiness_reminder,
 * link=/brief) is unread, the /brief layout server-fetches its text (see
 * layout.tsx + lib/assistant/daily-brief.ts's findTodaysUnreadDigest) and
 * passes it here. On mount, this seeds the portfolio dock with that text as
 * an ASSISTANT-authored first message via `openWithMessage` (Task 4's
 * pendingSeed mechanism) — the same "tap the notification, land on /brief,
 * see the digest as a chat bubble" experience the daily-brief report
 * documented as pending on T5.
 *
 * Renders nothing. Fires at most once per page load (guarded by a ref, since
 * `digestText` is a static server-computed prop that doesn't change across
 * client re-renders of the same navigation).
 */
export function BriefDigestSeed({ digestText }: { digestText: string | null }) {
  const { openWithMessage } = useAssistant();
  const seeded = useRef(false);

  useEffect(() => {
    if (!digestText || seeded.current) return;
    seeded.current = true;
    openWithMessage(digestText);
    // Fire once per mount for a given digestText — openWithMessage identity
    // is stable (useCallback in AssistantProvider) so this only needs to
    // re-arm if the digest text itself changes (new navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digestText]);

  return null;
}
