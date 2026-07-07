"use client";
import { useMutationState } from "@tanstack/react-query";

/** Counts paused mutations (TanStack networkMode 'online' parks mutations
    while the browser is offline and auto-fires them on reconnect). Without
    this strip the queued change is invisible — the optimistic ghost looks
    saved, and a supervisor in a dead zone has no idea it hasn't synced.
    In-memory only: a full reload while offline drops the queue (the chat
    dock's persisted queue is the offline-first surface; board edits are not). */
export function PendingSyncNotice() {
  const pausedCount = useMutationState({
    filters: { status: "pending" },
    select: (m) => m.state.isPaused,
  }).filter(Boolean).length;

  if (pausedCount === 0) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--flag-warning-bg)] px-3 py-1.5 text-[11px] font-semibold text-[var(--flag-warning)]"
    >
      <span aria-hidden="true">⏸</span>
      {pausedCount} perubahan menunggu koneksi — akan terkirim otomatis. Jangan tutup halaman.
    </div>
  );
}
