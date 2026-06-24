// Route-level skeleton for the Ruangan view. Mirrors the header and a stack
// of room rows so the streamed content swaps in place without layout shift.
export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto w-full max-w-2xl p-4">
      <div className="skeleton mb-3 h-3 w-28" />
      <div className="mb-4">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton mt-2 h-6 w-56 max-w-full" />
        <div className="skeleton mt-2 h-3 w-40" />
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex min-h-[56px] items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="skeleton h-3.5 w-32" />
              <div className="skeleton mt-2 h-5 w-44 rounded" />
              <div className="skeleton mt-1.5 h-2.5 w-48" />
            </div>
            <div className="skeleton h-3 w-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
