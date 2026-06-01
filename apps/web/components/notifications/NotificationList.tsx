"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import type { Notification } from "@datum/db";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/notifications/mutations";

const KIND_LABEL: Record<string, string> = {
  mention:         "Mention",
  watcher_event:   "Aktivitas",
  card_status:     "Status kartu",
  draft_pending:   "Draft menunggu",
  draft_approved:  "Draft disetujui",
  draft_rejected:  "Draft ditolak",
  review_assigned: "Review ditugaskan",
};

export function NotificationList({ items }: { items: Notification[] }) {
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  function markOne(id: string) {
    const fd = new FormData();
    fd.set("notificationId", id);
    startTransition(() => { void markNotificationRead(fd); });
  }

  function markAll() {
    setBusy(true);
    startTransition(async () => {
      await markAllNotificationsRead();
      setBusy(false);
    });
  }

  const unread = items.filter((i) => i.read_at === null).length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-[#524E49]">
          {items.length === 0 ? "Tidak ada notifikasi." : `${unread} belum dibaca dari ${items.length} terbaru`}
        </p>
        {unread > 0 ? (
          <button
            type="button"
            onClick={markAll}
            disabled={busy}
            className="rounded border border-[#B5AFA8] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#524E49] hover:border-[#7A6B56] disabled:opacity-50"
          >
            tandai semua dibaca
          </button>
        ) : null}
      </div>
      <ol className="space-y-2">
        {items.map((n) => {
          const unread = n.read_at === null;
          return (
            <li
              key={n.id}
              className={
                "flex items-start gap-3 rounded border p-3 text-sm " +
                (unread ? "border-amber-300 bg-amber-50" : "border-[#B5AFA8] bg-white")
              }
            >
              <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-700">
                {KIND_LABEL[n.kind] ?? n.kind}
              </span>
              <div className="flex-1">
                <Link href={n.link} className="text-[#141210] hover:underline">{n.summary}</Link>
                <div className="mt-1 text-[10px] text-[#847E78]">
                  {new Date(n.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              </div>
              {unread ? (
                <button
                  type="button"
                  onClick={() => markOne(n.id)}
                  className="text-[10px] text-[#7A6B56] hover:underline"
                >
                  tandai dibaca
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
