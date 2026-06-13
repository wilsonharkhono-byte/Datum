// Route-level skeleton for the card detail "modal shell" — dark signature
// header bar, 1fr/280px two-column body on desktop, stacked on mobile.
export default function Loading() {
  return (
    <div aria-busy="true" className="bg-[var(--background)] py-4 md:py-6">
      <div className="mx-auto max-w-6xl px-3 md:px-4">
        <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_24px_-12px_rgba(122,107,86,0.35)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--foreground)] bg-[var(--foreground)] px-4 py-3 md:px-6">
            <div className="h-3 w-16 rounded bg-[var(--text-inverse)]/20" />
            <div className="h-3 w-32 rounded bg-[var(--text-inverse)]/20" />
          </div>

          <div className="grid gap-0 md:grid-cols-[1fr_280px]">
            {/* Main column — title, summary, add-event block, timeline rows */}
            <div className="border-b border-[var(--border)] px-4 py-4 md:border-b-0 md:border-r md:px-6 md:py-5">
              <div className="skeleton h-6 w-3/4 max-w-md" />
              <div className="mt-2 flex gap-2">
                <div className="skeleton h-5 w-20 rounded-full" />
                <div className="skeleton h-5 w-24 rounded-full" />
              </div>
              <div className="skeleton mt-4 h-4 w-full" />
              <div className="skeleton mt-2 h-4 w-5/6" />

              <div className="mt-6">
                <div className="skeleton h-3 w-28" />
                <div className="skeleton mt-2 h-20 w-full" />
              </div>

              <div className="mt-6 border-t border-[var(--border)] pt-4">
                <div className="skeleton h-3 w-32" />
                <div className="mt-3 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i}>
                      <div className="skeleton h-3 w-40" />
                      <div className="skeleton mt-1.5 h-3.5 w-full" />
                      <div className="skeleton mt-1.5 h-3.5 w-2/3" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar — move / members / areas panels */}
            <aside className="bg-[var(--surface-alt)] px-4 py-4 md:py-5">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton mt-2 h-9 w-full" />
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <div className="skeleton h-3 w-28" />
                <div className="skeleton mt-2 h-9 w-full" />
              </div>
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <div className="skeleton h-3 w-24" />
                <div className="skeleton mt-2 h-9 w-full" />
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
