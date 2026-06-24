// Route-level skeleton for the morning brief — header block plus the
// 2-column grid of section cards, each with a title row and list rows.
export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="skeleton h-3 w-20" />
      <header className="mt-2 mb-6">
        <div className="skeleton h-3 w-28" />
        <div className="skeleton mt-2 h-8 w-full max-w-lg" />
        <div className="skeleton mt-2 h-4 w-full max-w-xl" />
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <section
            key={i}
            className="rounded border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <div className="flex items-center justify-between">
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-5 w-8 rounded-full" />
            </div>
            <div className="mt-3 space-y-2">
              <div className="skeleton h-9 w-full" />
              <div className="skeleton h-9 w-full" />
              <div className="skeleton h-9 w-2/3" />
            </div>
          </section>
        ))}
      </div>

      <section className="mt-6 rounded border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="skeleton h-4 w-48" />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="skeleton h-12 w-full" />
          <div className="skeleton h-12 w-full" />
        </div>
      </section>
    </div>
  );
}
