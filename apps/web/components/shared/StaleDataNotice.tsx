"use client";

/** Thin warning strip shown when the data on screen may be stale — either the
    realtime channel is down (reconnecting in the background) or a background
    refetch failed. Renders nothing when everything is healthy. */
export function StaleDataNotice({
  realtimeDown,
  refetchFailed,
}: {
  realtimeDown?: boolean;
  refetchFailed?: boolean;
}) {
  if (!realtimeDown && !refetchFailed) return null;
  const message = refetchFailed
    ? "Gagal memuat pembaruan — data mungkin usang."
    : "Koneksi pembaruan terputus — menyambung ulang…";
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--flag-warning-bg)] px-3 py-1.5 text-[11px] font-semibold text-[var(--flag-warning)]"
    >
      <span aria-hidden="true">⟳</span>
      {message}
    </div>
  );
}
