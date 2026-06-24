// Generic route skeleton: header silhouette + content rows. Every leaf route
// needs its own loading.tsx — a page that inherits an ancestor segment's
// boundary never gets its streamed content swapped in (observed on Next
// 16.2.6 dev/Turbopack), rendering blank instead.
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="skeleton mb-3 h-3 w-24" />
      <div className="skeleton h-8 w-full max-w-md" />
      <div className="skeleton mt-2 h-4 w-full max-w-sm" />
      <div className="mt-6 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <ul className="divide-y divide-[var(--border)]/70">
          {Array.from({ length: rows }).map((_, i) => (
            <li key={i} className="px-4 py-3">
              <div className="skeleton h-4 w-2/3 max-w-xs" />
              <div className="skeleton mt-2 h-3.5 w-1/2 max-w-[220px]" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
