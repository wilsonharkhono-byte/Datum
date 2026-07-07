"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/** Route error boundary for the whole (app) group. Without this, any uncaught
    error rendered Next.js's default English "Application error" page with no
    way to retry. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sand-dark)]">
          Terjadi kesalahan
        </p>
        <h1 className="mt-2 text-xl font-semibold text-[var(--foreground)]">
          Halaman ini gagal dimuat
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Kesalahan sudah tercatat otomatis. Coba muat ulang — jika masih gagal,
          kabari Wilson.
        </p>
        {error.digest ? (
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            Kode: {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-4 min-h-11 rounded border border-[var(--border)] bg-[var(--foreground)] px-4 text-sm font-semibold uppercase tracking-wide text-[var(--text-inverse)] hover:bg-[var(--sand-darker)]"
        >
          Coba lagi
        </button>
      </div>
    </div>
  );
}
