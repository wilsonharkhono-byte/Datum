import type { Board as BoardData } from "@/lib/cards/queries";
import { Column } from "./Column";

export function Board({ board }: { board: BoardData }) {
  return (
    <div className="flex flex-1 gap-2 overflow-x-auto overflow-y-hidden bg-stone-100 p-3">
      {board.columns.map((col) => (
        <Column key={col.topic.id} column={col} projectCode={board.project.project_code} />
      ))}
    </div>
  );
}
