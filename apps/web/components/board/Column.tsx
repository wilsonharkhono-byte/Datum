import type { BoardColumn } from "@/lib/cards/queries";
import { MiniCard } from "./MiniCard";
import { AddCardForm } from "./AddCardForm";

export function Column({
  column,
  projectId,
  projectCode,
}: {
  column: BoardColumn;
  projectId: string;
  projectCode: string;
}) {
  return (
    <div className="flex h-full w-56 flex-shrink-0 flex-col rounded bg-[var(--oat-deep)]/40 p-2">
      <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
        {column.topic.name}
      </h2>
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {column.cards.length === 0 ? (
          <p className="px-1 text-[11px] italic text-[var(--text-muted)]">Belum ada kartu</p>
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
