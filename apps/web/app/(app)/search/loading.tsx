// Route-level skeleton for global search — header, search box, and a
// short list of ghost result rows.
export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto max-w-3xl p-6">
      <div className="skeleton h-3 w-20" />
      <div className="skeleton mt-2 h-7 w-24" />
      <div className="skeleton mt-2 h-4 w-full max-w-md" />

      <div className="skeleton mt-4 h-11 w-full" />

      <div className="mt-8 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded border border-[var(--border)] bg-[var(--surface)] p-3"
          >
            <div className="flex items-center justify-between">
              <div className="skeleton h-4 w-16" />
              <div className="skeleton h-3 w-12" />
            </div>
            <div className="skeleton mt-2 h-4 w-2/3" />
            <div className="skeleton mt-1.5 h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
