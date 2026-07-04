"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { subscribeToOwnNotifications } from "@/lib/notifications/realtime";
import { BellIcon } from "@/components/icons/Icon";

export function NotificationBadgeClient({
  staffId,
  initialCount,
}: {
  staffId: string | null;
  initialCount: number;
}) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  useEffect(() => {
    if (!staffId) return;
    let refreshing = false;
    // Refetch the canonical count via a tiny route that returns just { count }.
    async function refreshCount() {
      if (refreshing) return;
      refreshing = true;
      try {
        const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (typeof data?.count === "number") setCount(data.count);
        }
      } finally {
        refreshing = false;
      }
    }
    const unsubscribe = subscribeToOwnNotifications(
      staffId,
      (delta) => {
        if (delta.kind === "insert") {
          setCount((c) => c + 1);
        } else {
          // Any update (mark-read) → resync with the server.
          void refreshCount();
        }
      },
      (h) => {
        // Inserts during a channel outage were missed — resync on recovery.
        if (h === "recovered") void refreshCount();
      },
    );
    return unsubscribe;
  }, [staffId]);

  const ariaLabel = count > 0
    ? `Notifikasi (${count} belum dibaca)`
    : "Notifikasi";

  return (
    <Link
      href="/notifications"
      aria-label={ariaLabel}
      className="relative inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--sand-dark)]"
    >
      <BellIcon size={13} />
      {count > 0 ? (
        <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--flag-warning)] px-1 text-[10px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
