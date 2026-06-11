"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Board as BoardData, BoardColumn } from "@/lib/cards/queries";
import { Column } from "./Column";
import { BoardFilter, type StatusFilter, type LabelFilter } from "./BoardFilter";
import { subscribeToProjectChanges } from "@/lib/cards/realtime";

export function Board({ board }: { board: BoardData }) {
  const router = useRouter();
  useEffect(() => {
    return subscribeToProjectChanges(board.project.id, () => router.refresh());
  }, [board.project.id, router]);
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<StatusFilter>(new Set(["active"]));
  const [labelFilter, setLabelFilter] = useState<LabelFilter>(new Set());

  const filteredColumns = useMemo(() => {
    const q = query.trim().toLowerCase();
    const includeAllColumns = q === "" && labelFilter.size === 0;
    const cols: BoardColumn[] = [];
    for (const col of board.columns) {
      const matchedCards = col.cards.filter((c) => {
        if (!statuses.has(c.status as "active" | "dormant" | "closed")) return false;
        if (labelFilter.size > 0) {
          const overdueMatch =
            labelFilter.has("overdue") &&
            c.deadline != null &&
            new Date(c.deadline.targetEndDate).getTime() < Date.now();
          const labelMatch = c.labels.some(
            (l) => labelFilter.has(l.kind as "needs_decision" | "blocked" | "awaiting"),
          );
          if (!overdueMatch && !labelMatch) return false;
        }
        if (!q) return true;
        const hay = `${c.title} ${c.current_summary ?? ""}`.toLowerCase();
        return hay.includes(q);
      });
      if (includeAllColumns || matchedCards.length > 0) {
        cols.push({ topic: col.topic, cards: matchedCards });
      }
    }
    return cols;
  }, [board.columns, query, statuses, labelFilter]);

  const totalCards = board.columns.reduce((n, c) => n + c.cards.length, 0);
  const matchedTotal = filteredColumns.reduce((n, c) => n + c.cards.length, 0);

  return (
    <div className="flex h-full flex-col">
      <BoardFilter
        query={query}
        onQueryChange={setQuery}
        statuses={statuses}
        onStatusesChange={setStatuses}
        labelFilter={labelFilter}
        onLabelFilterChange={setLabelFilter}
        matched={matchedTotal}
        total={totalCards}
      />
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-[var(--surface-alt)] p-3 md:flex-row md:gap-2 md:overflow-x-auto md:overflow-y-hidden">
        {filteredColumns.length === 0 ? (
          <div className="m-auto text-sm italic text-[var(--text-muted)]">
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
