// Route-level skeleton for the project board. Mirrors the page header,
// the filter strip, and the Trello-style columns (md:w-56 ghosts on
// desktop, stacked on mobile).
export default function Loading() {
  return (
    <div aria-busy="true" className="flex h-full flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="skeleton h-3 w-16" />
          <div className="flex items-center gap-2">
            <div className="skeleton h-3 w-14" />
            <div className="skeleton hidden h-3 w-28 sm:block" />
            <div className="skeleton h-6 w-24" />
          </div>
        </div>
        <div className="skeleton mt-1.5 h-5 w-64 max-w-full" />
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="skeleton h-9 w-full sm:w-56" />
        <div className="skeleton h-9 w-16 rounded-full" />
        <div className="skeleton h-9 w-20 rounded-full" />
        <div className="skeleton hidden h-9 w-20 rounded-full sm:block" />
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-hidden bg-[var(--surface-alt)] p-3 md:flex-row md:gap-2">
        <GhostColumn cards={3} />
        <GhostColumn cards={2} />
        <GhostColumn cards={3} hideBelow="sm" />
        <GhostColumn cards={2} hideBelow="md" />
      </div>
    </div>
  );
}

function GhostColumn({
  cards,
  hideBelow,
}: {
  cards: number;
  hideBelow?: "sm" | "md";
}) {
  const display =
    hideBelow === "sm" ? "hidden sm:flex" : hideBelow === "md" ? "hidden md:flex" : "flex";
  return (
    <div
      className={`${display} flex-shrink-0 flex-col rounded bg-[var(--oat-deep)]/40 p-2 md:h-full md:w-56`}
    >
      <div className="skeleton mb-2 h-3 w-24" />
      <div className="space-y-1.5">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-2"
          >
            <div className="skeleton h-3 w-3/4" />
            <div className="skeleton mt-1.5 h-2.5 w-full" />
            <div className="skeleton mt-1.5 h-2.5 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
