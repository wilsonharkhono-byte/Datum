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
      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[#B5AFA8] p-6">
          <p className="italic text-sm text-[#524E49]">Tidak ada notifikasi.</p>
          <p className="mt-1 text-xs text-[#847E78]">
            Notifikasi muncul saat ada @mention, draft yang menunggu approval, atau aktivitas di kartu yang Anda tonton.
          </p>
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[#524E49]">{unread} belum dibaca dari {items.length} terbaru</p>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAll}
              disabled={busy}
              aria-label="Tandai semua notifikasi sebagai dibaca"
              className="inline-flex min-h-11 items-center justify-center rounded border border-[#B5AFA8] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#524E49] hover:border-[#7A6B56] disabled:opacity-50 md:min-h-0"
            >
              tandai semua dibaca
            </button>
          ) : null}
        </div>
      ) : null}
      <ol className="space-y-2">
        {items.map((n) => {
          const isUnread = n.read_at === null;
          return (
            <li
              key={n.id}
              className={
                "flex items-start gap-3 rounded border p-3 text-sm " +
                (isUnread ? "border-[var(--sand)] bg-[var(--sand-tint)]" : "border-[var(--border)] bg-[var(--surface)]")
              }
            >
              <span className="rounded bg-[var(--surface-alt)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                {KIND_LABEL[n.kind] ?? n.kind}
              </span>
              <div className="flex-1">
                <Link href={n.link} className="text-[#141210] hover:underline">{n.summary}</Link>
                <div className="mt-1 text-[10px] text-[#847E78]">
                  {new Date(n.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              </div>
              {isUnread ? (
                <button
                  type="button"
                  onClick={() => markOne(n.id)}
                  aria-label="Tandai notifikasi ini sebagai dibaca"
                  className="inline-flex min-h-11 shrink-0 items-center px-2 py-1 text-xs text-[#7A6B56] hover:underline md:min-h-0"
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
