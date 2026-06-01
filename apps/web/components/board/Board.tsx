"use client";
import { useMemo, useState } from "react";
import type { Board as BoardData, BoardColumn } from "@/lib/cards/queries";
import { Column } from "./Column";
import { BoardFilter, type StatusFilter } from "./BoardFilter";

export function Board({ board }: { board: BoardData }) {
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<StatusFilter>(new Set(["active"]));

  const filteredColumns = useMemo(() => {
    const q = query.trim().toLowerCase();
    const includeAllColumns = q === "";
    const cols: BoardColumn[] = [];
    for (const col of board.columns) {
      const matchedCards = col.cards.filter((c) => {
        if (!statuses.has(c.status as "active" | "dormant" | "closed")) return false;
        if (!q) return true;
        const hay = `${c.title} ${c.current_summary ?? ""}`.toLowerCase();
        return hay.includes(q);
      });
      if (includeAllColumns || matchedCards.length > 0) {
        cols.push({ topic: col.topic, cards: matchedCards });
      }
    }
    return cols;
  }, [board.columns, query, statuses]);

  const totalCards = board.columns.reduce((n, c) => n + c.cards.length, 0);
  const matchedTotal = filteredColumns.reduce((n, c) => n + c.cards.length, 0);

  return (
    <div className="flex h-full flex-col">
      <BoardFilter
        query={query}
        onQueryChange={setQuery}
        statuses={statuses}
        onStatusesChange={setStatuses}
        matched={matchedTotal}
        total={totalCards}
      />
      <div className="flex flex-1 gap-2 overflow-x-auto overflow-y-hidden bg-stone-100 p-3">
        {filteredColumns.length === 0 ? (
          <div className="m-auto text-sm italic text-stone-500">
            Tidak ada kartu cocok. Coba ubah filter atau kata kunci.
          </div>
        ) : (
          filteredColumns.map((col) => (
            <Column
              key={col.topic.id}
              column={col}
              projectId={board.project.id}
              projectCode={board.project.project_code}
            />
          ))
        )}
      </div>
    </div>
  );
}
