import type { BoardColumn } from "@/lib/cards/queries";
import { MiniCard } from "./MiniCard";
import { AddCardForm } from "./AddCardForm";

export function Column({
  column,
  projectId,
  projectCode,
  containerRef,
}: {
  column: BoardColumn;
  projectId: string;
  projectCode: string;
  // Board attaches this to track the column in its mobile carousel
  // (IntersectionObserver + jump-to-column from the BoardTabs strip).
  containerRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={containerRef}
      data-topic-id={column.topic.id}
      className="flex h-full min-h-0 w-[86vw] max-w-[22rem] flex-shrink-0 snap-center flex-col rounded bg-[var(--oat-deep)]/40 p-2 md:h-full md:w-56"
    >
      <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
        {column.topic.name}
      </h2>
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {column.cards.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--border)] p-6">
            <p className="text-[11px] italic text-[var(--text-secondary)]">Belum ada kartu di kolom ini</p>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">Klik &ldquo;+ tambah kartu&rdquo; di bawah untuk membuat.</p>
          </div>
        ) : (
          column.cards.map((card) => (
            <MiniCard key={card.id} card={card} projectCode={projectCode} />
          ))
        )}
        <AddCardForm projectId={projectId} topicId={column.topic.id} projectCode={projectCode} />
      </div>
    </div>
  );
}
