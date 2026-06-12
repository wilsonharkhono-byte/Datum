// Route-level skeleton for the home / project list. Mirrors the hero
// section + dark-headed "Proyek Aktif" panel so the swap-in feels stable.
export default function Loading() {
  return (
    <div aria-busy="true" className="grid gap-6">
      <section>
        <div className="skeleton mb-2 h-3 w-16" />
        <div className="skeleton h-9 w-full max-w-2xl" />
        <div className="skeleton mt-2 h-4 w-full max-w-xl" />
        <div className="mt-3 flex flex-wrap gap-2">
          <div className="skeleton h-7 w-28" />
          <div className="skeleton h-7 w-36" />
          <div className="skeleton h-7 w-32" />
          <div className="skeleton h-7 w-20" />
        </div>
      </section>

      <section>
        <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] bg-[var(--foreground)] px-4 py-3">
            <div className="h-3 w-24 rounded bg-[var(--text-inverse)]/20" />
          </div>
          <ul className="divide-y divide-[var(--border)]/70">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="skeleton h-4 w-2/3 max-w-xs" />
                    <div className="skeleton mt-2 h-3.5 w-1/2 max-w-[220px]" />
                  </div>
                  <div className="skeleton h-6 w-20 rounded-[5px]" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
