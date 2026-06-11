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
    const unsubscribe = subscribeToOwnNotifications(staffId, async (delta) => {
      if (delta.kind === "insert") {
        setCount((c) => c + 1);
      } else {
        // On any update (mark-read), refetch the canonical count via the API.
        // Use a tiny route that returns just { count }.
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
    });
    return unsubscribe;
  }, [staffId]);

  const ariaLabel = count > 0
    ? `Notifikasi (${count} belum dibaca)`
    : "Notifikasi";

  return (
    <Link
      href="/notifications"
      aria-label={ariaLabel}
      className="relative inline-flex items-center gap-1.5 rounded border border-[#B5AFA8] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#524E49] hover:border-[#7A6B56]"
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
